const { FieldPath } = require('firebase-admin/firestore');
const { ElectionResultsService } = require('./results-service');
const { validMonth } = require('./results-contract');

const META_FIELDS = ['schemaVersion', 'siteId', 'dataEnvironment', 'monthKey',
  'timeZone', 'opensAt', 'closesAt', 'eligibleVoterCount'];
const OPERATION_FIELDS = ['state', 'reason', 'leaseUntilMs', 'publishedAt', 'lastAttemptAt', 'retryAt'];
const HEARTBEAT_FIELDS = ['status', 'lastAttemptAt', 'lastSuccessAt'];

function previewResultsBinding(env, db) {
  const binding = {
    projectId: 'infosmolinomoard', databaseId: '(default)',
    siteId: 'molard', environment: 'development',
  };
  let verified = false;
  try {
    verified = Boolean(db && env.NODE_ENV !== 'production' &&
      env.EMPLOYEE_DIRECTORY_SITE_ID === binding.siteId &&
      env.ELECTION_DATA_ENVIRONMENT === binding.environment &&
      env.ELECTION_TIME_ZONE === 'Europe/Zurich' &&
      db.projectId === binding.projectId && db.databaseId === binding.databaseId &&
      !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST);
  } catch { /* An unverified Admin client must never be used for status reads. */ }
  return { binding, verified };
}

const safeDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

// Deliberately not a processing store: no ballot, identity, publication-content,
// authorization-document or write methods exist on this path.
class PreviewResultsStatus {
  constructor({ db, binding, now }) {
    this.db = db;
    this.root = db ? db.collection('electionSites').doc(binding.siteId)
      .collection('dataEnvironments').doc(binding.environment) : null;
    this.viewer = new ElectionResultsService({ binding, now });
  }

  async monitor() {
    const base = { enabled: false, automationEnabled: false, readOnly: true,
      heartbeat: null, months: [] };
    if (!this.root) return { ...base, storageStatus: 'DISABLED' };
    try {
      const snapshot = await this.root.collection('elections')
        .orderBy(FieldPath.documentId(), 'desc').select(...META_FIELDS).limit(60).get();
      const [worker] = await this.db.getAll(
        this.root.collection('publicationState').doc('worker'), { fieldMask: HEARTBEAT_FIELDS });
      const heartbeat = worker.exists ? worker.data() : null;
      const months = await Promise.all(snapshot.docs.filter((doc) => validMonth(doc.id)).map(async (doc) => {
        const [operationDoc] = await this.db.getAll(
          this.root.collection('elections').doc(doc.id).collection('resultOperations').doc('state'),
          { fieldMask: OPERATION_FIELDS });
        const operation = operationDoc.exists ? operationDoc.data() : null;
        // September's production recovery authorization/hold is not Preview metadata.
        // This reports stored status only and never verifies a publication.
        const view = this.viewer.view(doc.id, doc.data(), operation, false);
        return { ...view, publishedAt: safeDate(view.publishedAt),
          lastAttemptAt: safeDate(view.lastAttemptAt), retryAt: safeDate(view.retryAt) };
      }));
      return { ...base, storageStatus: 'AVAILABLE', months,
        heartbeat: heartbeat && safeDate(heartbeat.lastAttemptAt) ? {
          lastAttemptAt: safeDate(heartbeat.lastAttemptAt),
          lastSuccessAt: safeDate(heartbeat.lastSuccessAt),
          status: ['OK', 'ERROR', 'RUNNING', 'VERIFICATION_REQUIRED'].includes(heartbeat.status)
            ? heartbeat.status : 'ERROR',
        } : null };
    } catch {
      return { ...base, storageStatus: 'UNAVAILABLE' };
    }
  }
}

module.exports = { previewResultsBinding, PreviewResultsStatus, META_FIELDS, OPERATION_FIELDS, HEARTBEAT_FIELDS };