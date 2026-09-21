const crypto = require('crypto');

const REQUIRED_HEADERS = [
  'Employee ID',
  'Salaire-ID',
  'Name',
  'Department',
  'Active',
  'Can Vote',
  'Can Be Elected',
];

const OPTIONAL_HEADERS = ['Job Title', 'Photo URL', 'Site ID'];
const ALLOWED_DEPARTMENTS = new Map([
  ['cuisine', { department: 'Cuisine', votingGroup: 'CUISINE' }],
  ['pizzeria', { department: 'Pizzeria', votingGroup: 'CUISINE' }],
  ['plonge', { department: 'Plonge', votingGroup: 'CUISINE' }],
  ['service', { department: 'Service', votingGroup: 'SERVICE' }],
]);

const DEFAULT_PHOTO = '/assets/avatar-neutral.svg';
const MAX_DIRECTORY_ROWS = 500;
const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const SALAIRE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/;

function normalizeCell(value) {
  return String(value ?? '').trim();
}

function parseBoolean(value, field, rowNumber, errors) {
  const normalized = normalizeCell(value).toLowerCase();
  if (['true', 'yes', 'oui', 'si', '1'].includes(normalized)) return true;
  if (['false', 'no', 'non', '0'].includes(normalized)) return false;
  errors.push(issue('INVALID_FLAG', rowNumber, field, `Invalid ${field} flag`));
  return null;
}

function issue(code, row, field, message) {
  return { code, row, field, message };
}

function validatePhotoReference(value, allowedOrigins) {
  const photo = normalizeCell(value);
  if (!photo) return { value: DEFAULT_PHOTO, warning: 'MISSING_PHOTO' };
  if (photo.startsWith('/')) {
    if (photo.startsWith('//') || photo.includes('\\')) return { value: DEFAULT_PHOTO, warning: 'UNSAFE_PHOTO' };
    return { value: photo };
  }
  try {
    const parsed = new URL(photo);
    if (parsed.protocol !== 'https:' || !allowedOrigins.has(parsed.origin)) {
      return { value: DEFAULT_PHOTO, warning: 'UNAPPROVED_PHOTO_ORIGIN' };
    }
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return { value: parsed.toString() };
  } catch {
    return { value: DEFAULT_PHOTO, warning: 'INVALID_PHOTO_URL' };
  }
}

function createSalaireVerifier(salaireId, pepper) {
  return crypto
    .createHmac('sha256', pepper)
    .update(`employee-directory:v1:${normalizeCell(salaireId)}`)
    .digest('base64url');
}

function validateHeaders(headers) {
  const normalized = headers.map(normalizeCell);
  const missing = REQUIRED_HEADERS.filter((header) => !normalized.includes(header));
  const duplicates = normalized.filter((header, index) => header && normalized.indexOf(header) !== index);
  return {
    headers: normalized,
    errors: [
      ...missing.map((header) => issue('MISSING_HEADER', 1, header, `Missing required header: ${header}`)),
      ...[...new Set(duplicates)].map((header) =>
        issue('DUPLICATE_HEADER', 1, header, `Duplicate header: ${header}`),
      ),
    ],
  };
}

function normalizeDirectory(values, options) {
  const siteId = normalizeCell(options.siteId);
  const pepper = options.pepper;
  const allowedOrigins = new Set(options.allowedPhotoOrigins || []);
  const errors = [];
  const warnings = [];

  if (!Array.isArray(values) || values.length < 2) {
    return { ok: false, employees: [], verifierRecords: [], errors: [issue('EMPTY_SHEET', 1, '', 'Directory has no employee rows')], warnings };
  }
  if (values.length - 1 > MAX_DIRECTORY_ROWS) {
    return {
      ok: false,
      employees: [],
      verifierRecords: [],
      errors: [issue('TOO_MANY_ROWS', 0, '', `Directory exceeds ${MAX_DIRECTORY_ROWS} employees`)],
      warnings,
    };
  }
  if (!pepper) {
    return { ok: false, employees: [], verifierRecords: [], errors: [issue('MISSING_PEPPER', 0, '', 'Salaire-ID verifier is not configured')], warnings };
  }

  const headerResult = validateHeaders(values[0]);
  errors.push(...headerResult.errors);
  if (errors.length) return { ok: false, employees: [], verifierRecords: [], errors, warnings };

  const headerIndex = new Map(headerResult.headers.map((header, index) => [header, index]));
  const getCell = (row, header) => row[headerIndex.get(header)] ?? '';
  const employees = [];
  const verifierRecords = [];
  const seenEmployeeIds = new Set();
  const seenVerifiers = new Set();

  values.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (!Array.isArray(row) || row.every((cell) => !normalizeCell(cell))) return;

    const employeeId = normalizeCell(getCell(row, 'Employee ID'));
    const salaireId = normalizeCell(getCell(row, 'Salaire-ID'));
    const displayName = normalizeCell(getCell(row, 'Name')).replace(/\s+/g, ' ');
    const departmentInput = normalizeCell(getCell(row, 'Department'));
    const departmentInfo = ALLOWED_DEPARTMENTS.get(departmentInput.toLowerCase());
    const rowSiteId = headerIndex.has('Site ID') ? normalizeCell(getCell(row, 'Site ID')) : siteId;
    const jobTitle = headerIndex.has('Job Title') ? normalizeCell(getCell(row, 'Job Title')) : '';
    const active = parseBoolean(getCell(row, 'Active'), 'Active', rowNumber, errors);
    const canVote = parseBoolean(getCell(row, 'Can Vote'), 'Can Vote', rowNumber, errors);
    const canBeElected = parseBoolean(getCell(row, 'Can Be Elected'), 'Can Be Elected', rowNumber, errors);

    if (!EMPLOYEE_ID_PATTERN.test(employeeId)) {
      errors.push(issue('INVALID_EMPLOYEE_ID', rowNumber, 'Employee ID', 'Employee ID is missing or malformed'));
    } else if (seenEmployeeIds.has(employeeId)) {
      errors.push(issue('DUPLICATE_EMPLOYEE_ID', rowNumber, 'Employee ID', 'Duplicate Employee ID'));
    } else {
      seenEmployeeIds.add(employeeId);
    }
    if (!displayName) errors.push(issue('MISSING_NAME', rowNumber, 'Name', 'Employee name is required'));
    if (displayName.length > 160) {
      errors.push(issue('NAME_TOO_LONG', rowNumber, 'Name', 'Employee name exceeds 160 characters'));
    }
    if (jobTitle.length > 160) {
      errors.push(issue('JOB_TITLE_TOO_LONG', rowNumber, 'Job Title', 'Job title exceeds 160 characters'));
    }
    if (!departmentInfo) errors.push(issue('UNKNOWN_DEPARTMENT', rowNumber, 'Department', 'Department is not allowed'));
    if (!rowSiteId || rowSiteId !== siteId) {
      errors.push(issue('SITE_MISMATCH', rowNumber, 'Site ID', 'Row does not belong to the configured site'));
    }
    if (!SALAIRE_ID_PATTERN.test(salaireId)) {
      errors.push(issue('INVALID_SALAIRE_ID', rowNumber, 'Salaire-ID', 'Salaire-ID is missing or malformed'));
    }

    let verifier = null;
    if (SALAIRE_ID_PATTERN.test(salaireId)) {
      verifier = createSalaireVerifier(salaireId, pepper);
      if (seenVerifiers.has(verifier)) {
        errors.push(issue('DUPLICATE_SALAIRE_ID', rowNumber, 'Salaire-ID', 'Duplicate Salaire-ID'));
      } else {
        seenVerifiers.add(verifier);
      }
    }

    const photoResult = validatePhotoReference(
      headerIndex.has('Photo URL') ? getCell(row, 'Photo URL') : '',
      allowedOrigins,
    );
    if (photoResult.warning) {
      warnings.push(issue(photoResult.warning, rowNumber, 'Photo URL', 'Neutral photo fallback will be used'));
    }
    if (!jobTitle) warnings.push(issue('MISSING_JOB_TITLE', rowNumber, 'Job Title', 'Job title is missing'));

    if (
      EMPLOYEE_ID_PATTERN.test(employeeId) &&
      displayName &&
      displayName.length <= 160 &&
      jobTitle.length <= 160 &&
      departmentInfo &&
      rowSiteId === siteId &&
      verifier &&
      active !== null &&
      canVote !== null &&
      canBeElected !== null
    ) {
      employees.push({
        employeeId,
        displayName,
        jobTitle,
        department: departmentInfo.department,
        votingGroup: departmentInfo.votingGroup,
        active,
        canVote,
        canBeElected,
        photoUrl: photoResult.value,
        siteId,
      });
      verifierRecords.push({
        employeeId,
        verifier,
        verifierVersion: 1,
        siteId,
      });
    }
  });

  if (!employees.length) errors.push(issue('NO_VALID_EMPLOYEES', 0, '', 'Directory contains no valid employees'));
  return { ok: errors.length === 0, employees, verifierRecords, errors, warnings };
}

function serializeCandidate(employee) {
  return {
    employeeId: employee.employeeId,
    displayName: employee.displayName,
    jobTitle: employee.jobTitle,
    department: employee.department,
    votingGroup: employee.votingGroup,
    photoUrl: employee.photoUrl || DEFAULT_PHOTO,
  };
}

function getCandidates(employees) {
  return employees
    .filter((employee) => employee.active && employee.canBeElected)
    .map(serializeCandidate)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }));
}

function validatePersistedSnapshot(snapshot, options) {
  const errors = [];
  const allowedOrigins = new Set(options.allowedPhotoOrigins || []);
  if (!snapshot || snapshot.schemaVersion !== 1) {
    return { ok: false, errors: [issue('INVALID_SNAPSHOT_SCHEMA', 0, '', 'Unsupported snapshot schema')] };
  }
  if (snapshot.siteId !== options.siteId || !Array.isArray(snapshot.employees) || !Array.isArray(snapshot.verifierRecords)) {
    return { ok: false, errors: [issue('INVALID_SNAPSHOT_SHAPE', 0, '', 'Snapshot shape or site is invalid')] };
  }
  if (!isExactIsoTimestamp(snapshot.refreshedAt)) {
    errors.push(issue('INVALID_SNAPSHOT_DATE', 0, 'refreshedAt', 'Snapshot refresh date is invalid'));
  }
  if (!Number.isInteger(snapshot.sourceGeneration) || snapshot.sourceGeneration < 1) {
    errors.push(issue('INVALID_SNAPSHOT_GENERATION', 0, 'sourceGeneration', 'Snapshot generation is invalid'));
  }
  if (!Array.isArray(snapshot.warnings) || snapshot.warnings.length > MAX_DIRECTORY_ROWS * 2) {
    errors.push(issue('INVALID_SNAPSHOT_WARNINGS', 0, 'warnings', 'Snapshot warnings are invalid'));
  } else {
    snapshot.warnings.forEach((warning) => {
      if (
        !warning ||
        typeof warning.code !== 'string' ||
        warning.code.length > 64 ||
        !Number.isInteger(warning.row) ||
        warning.row < 0 ||
        typeof warning.field !== 'string' ||
        warning.field.length > 64 ||
        typeof warning.message !== 'string' ||
        warning.message.length > 200
      ) {
        errors.push(issue('INVALID_SNAPSHOT_WARNING', 0, 'warnings', 'Stored warning is invalid'));
      }
    });
  }
  if (snapshot.employees.length > MAX_DIRECTORY_ROWS || snapshot.employees.length !== snapshot.verifierRecords.length) {
    errors.push(issue('INVALID_SNAPSHOT_COUNT', 0, '', 'Snapshot record counts are invalid'));
  }

  const employeeIds = new Set();
  const verifierIds = new Set();
  const verifiers = new Set();
  snapshot.employees.forEach((employee, index) => {
    const row = index + 1;
    const expectedKeys = ['active', 'canBeElected', 'canVote', 'department', 'displayName', 'employeeId', 'jobTitle', 'photoUrl', 'siteId', 'votingGroup'];
    const hasExactKeys =
      employee &&
      Object.keys(employee).sort().join('|') === expectedKeys.sort().join('|');
    const departmentInfo =
      typeof employee?.department === 'string'
        ? ALLOWED_DEPARTMENTS.get(employee.department.trim().toLowerCase())
        : null;
    const photo =
      typeof employee?.photoUrl === 'string'
        ? validatePhotoReference(employee.photoUrl, allowedOrigins)
        : { warning: 'INVALID_PHOTO_URL' };
    if (
      !hasExactKeys ||
      typeof employee.employeeId !== 'string' ||
      !EMPLOYEE_ID_PATTERN.test(employee.employeeId) ||
      employeeIds.has(employee.employeeId) ||
      employee.siteId !== options.siteId ||
      typeof employee.displayName !== 'string' ||
      employee.displayName.trim().length < 1 ||
      employee.displayName.length > 160 ||
      typeof employee.jobTitle !== 'string' ||
      employee.jobTitle.length > 160 ||
      !departmentInfo ||
      employee.votingGroup !== departmentInfo.votingGroup ||
      typeof employee.active !== 'boolean' ||
      typeof employee.canVote !== 'boolean' ||
      typeof employee.canBeElected !== 'boolean' ||
      photo.warning
    ) {
      errors.push(issue('INVALID_SNAPSHOT_EMPLOYEE', row, 'employee', 'Stored employee record is invalid'));
    }
    employeeIds.add(employee.employeeId);
  });
  snapshot.verifierRecords.forEach((record, index) => {
    const row = index + 1;
    const hasExactKeys =
      record &&
      Object.keys(record).sort().join('|') ===
        ['employeeId', 'siteId', 'verifier', 'verifierVersion'].sort().join('|');
    if (
      !hasExactKeys ||
      !employeeIds.has(record.employeeId) ||
      verifierIds.has(record.employeeId) ||
      record.siteId !== options.siteId ||
      record.verifierVersion !== 1 ||
      typeof record.verifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(record.verifier) ||
      verifiers.has(record.verifier)
    ) {
      errors.push(issue('INVALID_SNAPSHOT_VERIFIER', row, 'verifier', 'Stored verifier record is invalid'));
    }
    verifierIds.add(record.employeeId);
    verifiers.add(record.verifier);
  });
  for (const employeeId of employeeIds) {
    if (!verifierIds.has(employeeId)) {
      errors.push(issue('MISSING_SNAPSHOT_VERIFIER', 0, 'verifier', 'Stored employee verifier is missing'));
    }
  }
  return { ok: errors.length === 0, errors };
}

function isExactIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

module.exports = {
  ALLOWED_DEPARTMENTS,
  DEFAULT_PHOTO,
  MAX_DIRECTORY_ROWS,
  OPTIONAL_HEADERS,
  REQUIRED_HEADERS,
  createSalaireVerifier,
  getCandidates,
  normalizeDirectory,
  serializeCandidate,
  validatePersistedSnapshot,
  validatePhotoReference,
};