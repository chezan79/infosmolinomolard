const crypto = require('node:crypto');
const { publicPublication } = require('./results-contract');

class WinnerPhotos {
  constructor({ bucket, directoryPhotos, binding, store }) {
    Object.assign(this, { bucket, directoryPhotos, binding, store });
  }

  async prepare(month, proof) {
    const photos = {};
    if (!this.bucket || !this.directoryPhotos) return photos;
    for (const category of ['CUISINE', 'SERVICE']) {
      for (const id of proof.results[category].winnerEmployeeIds) {
        const record = this.directoryPhotos.records.get(id);
        if (record?.objectPath !== `employee-photos/${this.binding.siteId}/${id}/portrait.webp`) continue;
        const key = `${month}.${crypto.randomUUID()}`;
        const path = `published-winner-photos/${this.binding.siteId}/${this.binding.environment}/${key}.webp`;
        try {
          // Copy only already-normalized managed portraits; never fetch external URLs.
          await this.bucket.file(record.objectPath).copy(this.bucket.file(path));
          photos[id] = { key, path };
        } catch {
          // Optional image failure never invents a photo or alters the result.
        }
      }
    }
    return photos;
  }

  async read(key, now) {
    if (!this.bucket || !/^\d{4}-(0[1-9]|1[0-2])\.[a-f0-9-]{36}$/.test(key)) return null;
    const publication = await this.store.photoPublication(key.slice(0, 7));
    if (!publication) return null;
    publicPublication(publication, this.binding, now);
    const path = `published-winner-photos/${this.binding.siteId}/${this.binding.environment}/${key}.webp`;
    const allowed = Object.values(publication.categories).some((category) =>
      category.winners.some((winner) => winner.photoKey === key && winner.photoPath === path));
    if (!allowed) return null;
    try {
      const [bytes] = await this.bucket.file(path).download();
      if (bytes.length > 2 * 1024 * 1024) return null;
      return bytes;
    } catch {
      return null;
    }
  }
}

module.exports = { WinnerPhotos };