function buildMediaRepo(db) {
  function queryable(executor) {
    return executor || db;
  }

  return {
    async setStatus(mediaId, status, executor) {
      const result = await queryable(executor).query(
        `
          UPDATE media
          SET status = $2,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, owner_id, status, updated_at
        `,
        [mediaId, status]
      );

      return result.rows[0] || null;
    },

    async findById(mediaId, executor) {
      const result = await queryable(executor).query(
        `
          SELECT id, owner_id, relative_path, mime_type, status, checksum_sha256, created_at, updated_at
          FROM media
          WHERE id = $1
          LIMIT 1
        `,
        [mediaId]
      );

      return result.rows[0] || null;
    }
  };
}

module.exports = {
  buildMediaRepo
};

