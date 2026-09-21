class FirestorePhotoStore {
  constructor(db, bucket, siteId) {
    this.db = db;
    this.bucket = bucket;
    this.siteId = siteId;
    this.collection = db.collection('employeePhotoSites').doc(siteId).collection('photos');
  }

  objectPath(employeeId) {
    return `employee-photos/${this.siteId}/${employeeId}/portrait.webp`;
  }

  async list() {
    const snapshot = await this.collection.get();
    const result = new Map();
    snapshot.forEach((document) => result.set(document.id, document.data()));
    return result;
  }

  async save(employeeId, bytes, metadata) {
    const objectPath = this.objectPath(employeeId);
    await this.bucket.file(objectPath).save(bytes, {
      resumable: false,
      contentType: 'image/webp',
      metadata: {
        cacheControl: 'private, max-age=31536000, immutable',
        metadata: { siteId: this.siteId, employeeId, version: String(metadata.version) },
      },
    });
    const record = { schemaVersion: 1, objectPath, version: metadata.version, updatedAt: metadata.updatedAt };
    await this.collection.doc(employeeId).set(record);
    return record;
  }

  async read(record) {
    if (!record?.objectPath?.startsWith(`employee-photos/${this.siteId}/`)) return null;
    const [bytes] = await this.bucket.file(record.objectPath).download();
    return bytes;
  }

  async remove(employeeId, record, deletedAt) {
    if (record?.objectPath === this.objectPath(employeeId)) {
      await this.bucket.file(record.objectPath).delete({ ignoreNotFound: true });
    }
    const tombstone = {
      schemaVersion: 1,
      version: Number.isInteger(record?.version) ? record.version : 0,
      deletedAt,
    };
    await this.collection.doc(employeeId).set(tombstone);
    return tombstone;
  }
}

module.exports = { FirestorePhotoStore };