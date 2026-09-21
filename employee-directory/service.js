const { getCandidates, normalizeDirectory, validatePersistedSnapshot } = require('./contract');

class EmployeeDirectoryService {
  constructor({ source, store, siteId, pepper, allowedPhotoOrigins = [], now = () => new Date() }) {
    this.source = source;
    this.store = store;
    this.siteId = siteId;
    this.pepper = pepper;
    this.allowedPhotoOrigins = allowedPhotoOrigins;
    this.now = now;
    this.snapshot = null;
    this.refreshPromise = null;
    this.sourceHealth = 'not_configured';
    this.lastAttemptAt = null;
    this.lastErrors = [];
  }

  async initialize({ refresh = true } = {}) {
    if (this.store) {
      try {
        const stored = await this.store.load();
        const validation = validatePersistedSnapshot(stored, {
          siteId: this.siteId,
          allowedPhotoOrigins: this.allowedPhotoOrigins,
        });
        if (validation.ok) {
          this.snapshot = stored;
          this.sourceHealth = 'snapshot_loaded';
        } else if (stored) {
          this.sourceHealth = 'snapshot_invalid';
          this.lastErrors = validation.errors;
        }
      } catch {
        this.sourceHealth = 'snapshot_unavailable';
      }
    }
    if (refresh && this.source) {
      try {
        await this.refresh();
      } catch {
        // Last-known-good snapshot remains active. Status exposes the failure safely.
      }
    }
    return this.snapshot;
  }

  async refresh() {
    if (!this.source) throw new Error('Employee directory source is not configured');
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async performRefresh() {
    this.lastAttemptAt = this.now().toISOString();
    if (!this.store) throw new Error('Durable employee directory store is not configured');
    const committedSnapshot = await this.store.replaceFromSource(async () => {
      let values;
      try {
        values = await this.source.load();
      } catch (error) {
        this.sourceHealth = 'unavailable';
        this.lastErrors = [{ code: 'SOURCE_UNAVAILABLE', message: 'Google Sheets source is unavailable' }];
        throw error;
      }
      const result = normalizeDirectory(values, {
        siteId: this.siteId,
        pepper: this.pepper,
        allowedPhotoOrigins: this.allowedPhotoOrigins,
      });
      if (!result.ok) {
        this.sourceHealth = 'invalid';
        this.lastErrors = result.errors;
        const error = new Error('Employee directory validation failed');
        error.validationErrors = result.errors;
        throw error;
      }
      return {
        schemaVersion: 1,
        siteId: this.siteId,
        refreshedAt: this.now().toISOString(),
        employees: result.employees,
        verifierRecords: result.verifierRecords,
        warnings: result.warnings,
      };
    });
    const committedValidation = validatePersistedSnapshot(committedSnapshot, {
      siteId: this.siteId,
      allowedPhotoOrigins: this.allowedPhotoOrigins,
    });
    if (!committedValidation.ok) throw new Error('Committed employee directory snapshot is invalid');
    this.snapshot = committedSnapshot;
    this.sourceHealth = 'healthy';
    this.lastErrors = [];
    return this.getStatus();
  }

  getCandidates() {
    return getCandidates(this.snapshot?.employees || []);
  }

  getStatus() {
    const employees = this.snapshot?.employees || [];
    const candidates = getCandidates(employees);
    return {
      configured: Boolean(this.source),
      sourceHealth: this.sourceHealth,
      refreshInProgress: Boolean(this.refreshPromise),
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessfulRefreshAt: this.snapshot?.refreshedAt || null,
      counts: {
        employees: employees.length,
        active: employees.filter((employee) => employee.active).length,
        voters: employees.filter((employee) => employee.active && employee.canVote).length,
        candidates: candidates.length,
        cuisineCandidates: candidates.filter((employee) => employee.votingGroup === 'CUISINE').length,
        serviceCandidates: candidates.filter((employee) => employee.votingGroup === 'SERVICE').length,
      },
      warnings: (this.snapshot?.warnings || []).map(redactIssue),
      errors: this.lastErrors.map(redactIssue),
    };
  }
}

function redactIssue(issue) {
  return {
    code: issue.code,
    row: Number.isInteger(issue.row) ? issue.row : 0,
    field: issue.field || '',
    message: issue.message,
  };
}

module.exports = { EmployeeDirectoryService, redactIssue };