function buildMediaRepo(db) {
  return {
    async create({ id, ownerId, relativePath, mimeType, status, checksumSha256 }) {
      const result = await db.query(
        `
          INSERT INTO media (id, owner_id, relative_path, mime_type, status, checksum_sha256)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, owner_id, relative_path, mime_type, status, checksum_sha256, created_at, updated_at
        `,
        [id, ownerId, relativePath, mimeType, status, checksumSha256]
      );
      return result.rows[0];
    },

    async findById(id) {
      const result = await db.query(
        `
          SELECT id, owner_id, relative_path, mime_type, status, checksum_sha256, created_at, updated_at
          FROM media
          WHERE id = $1
        `,
        [id]
      );
      return result.rows[0] || null;
    }
  };
}

module.exports = {
  buildMediaRepo
};
