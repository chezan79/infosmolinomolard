const sharp = require('sharp');
const crypto = require('node:crypto');
const { EMPLOYEE_ID_PATTERN } = require('./contract');

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_DIMENSION = 12000;
const PORTRAIT_SIZE = 512;
const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_URL_TTL_MS = 10 * 60 * 1000;

class PhotoError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

class EmployeePhotoService {
  constructor({ directoryService, store, photoUrlSecret = '', now = () => new Date() }) {
    this.directoryService = directoryService;
    this.store = store;
    this.now = now;
    this.photoUrlSecret = photoUrlSecret;
    this.records = new Map();
  }

  async initialize() {
    if (this.store) this.records = await this.store.list();
  }

  employee(employeeId) {
    if (!EMPLOYEE_ID_PATTERN.test(employeeId || '')) throw new PhotoError('INVALID_EMPLOYEE_ID');
    const employee = this.directoryService.snapshot?.employees?.find((item) => item.employeeId === employeeId);
    if (!employee) throw new PhotoError('EMPLOYEE_NOT_FOUND', 404);
    return employee;
  }

  managedUrl(employeeId, record = this.records.get(employeeId)) {
    if (!record?.objectPath || this.photoUrlSecret.length < 32) return null;
    const expires = Math.floor((this.now().getTime() + PHOTO_URL_TTL_MS) / 1000);
    const signature = this.sign(employeeId, record.version, expires);
    return `/api/v1/employee-photos/${encodeURIComponent(employeeId)}?v=${record.version}&expires=${expires}&signature=${signature}`;
  }

  sign(employeeId, version, expires) {
    return crypto
      .createHmac('sha256', this.photoUrlSecret)
      .update(`employee-photo:v1:${this.directoryService.siteId}:${employeeId}:${version}:${expires}`)
      .digest('base64url');
  }

  validAccess(employeeId, record, query) {
    const version = Number.parseInt(query?.v, 10);
    const expires = Number.parseInt(query?.expires, 10);
    const signature = String(query?.signature || '');
    if (
      !record?.objectPath ||
      !Number.isInteger(version) ||
      version !== record.version ||
      !Number.isInteger(expires) ||
      expires <= Math.floor(this.now().getTime() / 1000) ||
      expires > Math.floor((this.now().getTime() + PHOTO_URL_TTL_MS + 5000) / 1000) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
      this.photoUrlSecret.length < 32
    ) return false;
    const expected = this.sign(employeeId, version, expires);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  resolvePhotoUrl(employeeId, fallback) {
    return this.managedUrl(employeeId) || fallback;
  }

  list() {
    const employees = this.directoryService.snapshot?.employees;
    if (!employees) throw new PhotoError('DIRECTORY_UNAVAILABLE', 503);
    const items = employees.map((employee) => ({
      employeeId: employee.employeeId,
      displayName: employee.displayName,
      jobTitle: employee.jobTitle,
      department: employee.department,
      active: employee.active,
      photoStatus: this.managedUrl(employee.employeeId)
        ? 'managed'
        : employee.photoUrl && !employee.photoUrl.endsWith('/assets/avatar-neutral.svg') ? 'legacy' : 'missing',
      photoUrl: this.managedUrl(employee.employeeId) || employee.photoUrl,
    }));
    return {
      counts: {
        total: items.length,
        managed: items.filter((item) => item.photoStatus === 'managed').length,
        missing: items.filter((item) => item.photoStatus === 'missing').length,
      },
      employees: items,
    };
  }

  async process(bytes, declaredMime) {
    if (!SUPPORTED_MIME.has(declaredMime)) {
      if (/hei[cf]/i.test(declaredMime || '')) throw new PhotoError('HEIC_NOT_SUPPORTED', 415);
      throw new PhotoError('UNSUPPORTED_FORMAT', 415);
    }
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new PhotoError('EMPTY_IMAGE');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new PhotoError('IMAGE_TOO_LARGE', 413);
    try {
      const input = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_DIMENSION ** 2 });
      const info = await input.metadata();
      const expected = declaredMime.replace('image/', '').replace('jpeg', 'jpeg');
      if (!['jpeg', 'png', 'webp'].includes(info.format) || info.format !== expected) {
        throw new PhotoError('MIME_MISMATCH', 415);
      }
      if (!info.width || !info.height || info.width > MAX_INPUT_DIMENSION || info.height > MAX_INPUT_DIMENSION) {
        throw new PhotoError('IMAGE_DIMENSIONS_INVALID');
      }
      return await input
        .rotate()
        .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82, effort: 5 })
        .toBuffer();
    } catch (error) {
      if (error instanceof PhotoError) throw error;
      throw new PhotoError('MALFORMED_IMAGE');
    }
  }

  async upload(employeeId, bytes, declaredMime) {
    this.employee(employeeId);
    if (!this.store) throw new PhotoError('PHOTO_STORAGE_UNAVAILABLE', 503);
    const processed = await this.process(bytes, declaredMime);
    const current = this.records.get(employeeId);
    const record = await this.store.save(employeeId, processed, {
      version: (current?.version || 0) + 1,
      updatedAt: this.now().toISOString(),
    });
    this.records.set(employeeId, record);
    return { employeeId, photoStatus: 'managed', photoUrl: this.managedUrl(employeeId, record), version: record.version };
  }

  async remove(employeeId) {
    const employee = this.employee(employeeId);
    if (!this.store) throw new PhotoError('PHOTO_STORAGE_UNAVAILABLE', 503);
    const record = this.records.get(employeeId);
    if (record?.objectPath) {
      const tombstone = await this.store.remove(employeeId, record, this.now().toISOString());
      this.records.set(employeeId, tombstone);
    }
    return { employeeId, photoStatus: employee.photoUrl.endsWith('/assets/avatar-neutral.svg') ? 'missing' : 'legacy', photoUrl: employee.photoUrl };
  }

  candidate(employee) {
    return { ...employee, photoUrl: this.resolvePhotoUrl(employee.employeeId, employee.photoUrl) };
  }

  async read(employeeId, query) {
    if (!EMPLOYEE_ID_PATTERN.test(employeeId || '')) return null;
    const record = this.records.get(employeeId);
    return record && this.store && this.validAccess(employeeId, record, query) ? this.store.read(record) : null;
  }
}

module.exports = {
  EmployeePhotoService,
  MAX_INPUT_DIMENSION,
  MAX_UPLOAD_BYTES,
  PORTRAIT_SIZE,
  PHOTO_URL_TTL_MS,
  PhotoError,
  SUPPORTED_MIME,
};