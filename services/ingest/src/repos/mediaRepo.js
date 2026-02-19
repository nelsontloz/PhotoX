function buildMediaRepo(db) {
  function queryable(executor) {
    return executor || db;
  }

  return {
    async create({ id, ownerId, relativePath, mimeType, status, checksumSha256 }, executor) {
      const result = await queryable(executor).query(
        `
          INSERT INTO media (id, owner_id, relative_path, mime_type, status, checksum_sha256, sort_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          RETURNING id, owner_id, relative_path, mime_type, status, checksum_sha256, sort_at, created_at, updated_at
        `,
        [id, ownerId, relativePath, mimeType, status, checksumSha256]
      );
      return result.rows[0];
    },

    async findById(id, executor) {
      const result = await queryable(executor).query(
        `
          SELECT id, owner_id, relative_path, mime_type, status, checksum_sha256, created_at, updated_at
          FROM media
          WHERE id = $1
        `,
        [id]
      );
      return result.rows[0] || null;
    },

    async findActiveByOwnerAndChecksum({ ownerId, checksumSha256 }, executor) {
      const result = await queryable(executor).query(
        `
          SELECT m.id, m.owner_id, m.relative_path, m.mime_type, m.status, m.checksum_sha256, m.created_at, m.updated_at
          FROM media m
          LEFT JOIN media_flags mf ON mf.media_id = m.id
          WHERE m.owner_id = $1
            AND m.checksum_sha256 = $2
            AND COALESCE(mf.deleted_soft, false) = false
          ORDER BY m.created_at DESC
          LIMIT 1
        `,
        [ownerId, checksumSha256]
      );

      return result.rows[0] || null;
    }
  };
}

module.exports = {
  buildMediaRepo
};
