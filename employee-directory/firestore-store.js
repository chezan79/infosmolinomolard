const crypto = require('crypto');

const REFRESH_LEASE_MS = 30000;

class RefreshAlreadyRunningError extends Error {
  constructor() {
    super('Employee directory refresh is already running');
    this.name = 'RefreshAlreadyRunningError';
  }
}

class FirestoreDirectoryStore {
  constructor(db, siteId) {
    this.db = db;
    this.siteId = siteId;
    this.ref = db.collection('employeeDirectorySnapshots').doc(siteId);
  }

  async load() {
    const snapshot = await this.ref.get();
    return snapshot.exists ? snapshot.data() : null;
  }

  async replaceFromSource(buildSnapshot) {
    const leaseToken = crypto.randomUUID();
    const now = Date.now();
    await this.db.runTransaction(async (transaction) => {
      const document = await transaction.get(this.ref);
      const current = document.exists ? document.data() : {};
      if (current.refreshLease?.expiresAtMs > now) throw new RefreshAlreadyRunningError();
      transaction.set(
        this.ref,
        { refreshLease: { token: leaseToken, expiresAtMs: now + REFRESH_LEASE_MS } },
        { merge: true },
      );
    });

    let committed = false;
    try {
      const candidate = await buildSnapshot();
      const result = await this.db.runTransaction(async (transaction) => {
        const document = await transaction.get(this.ref);
        const current = document.exists ? document.data() : {};
        if (current.refreshLease?.token !== leaseToken) throw new RefreshAlreadyRunningError();
        const next = {
          ...candidate,
          sourceGeneration: Number.isInteger(current.sourceGeneration)
            ? current.sourceGeneration + 1
            : 1,
        };
        transaction.set(this.ref, next);
        return next;
      });
      committed = true;
      return result;
    } finally {
      if (!committed) await this.releaseLease(leaseToken);
    }
  }

  async releaseLease(leaseToken) {
    await this.db.runTransaction(async (transaction) => {
      const document = await transaction.get(this.ref);
      const current = document.exists ? document.data() : {};
      if (current.refreshLease?.token === leaseToken) {
        transaction.set(this.ref, { refreshLease: null }, { merge: true });
      }
    });
  }
}

module.exports = { FirestoreDirectoryStore, REFRESH_LEASE_MS, RefreshAlreadyRunningError };