const crypto = require("node:crypto");

function buildUploadSessionsRepo(db) {
  return {
    async create({
      userId,
      fileName,
      contentType,
      fileSize,
      checksumSha256,
      partSize,
      expiresAt
    }) {
      const id = crypto.randomUUID();
      const result = await db.query(
        `
          INSERT INTO upload_sessions
            (id, user_id, file_name, content_type, file_size, checksum_sha256, part_size, status, expires_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, 'initiated', $8)
          RETURNING id, user_id, file_name, content_type, file_size, checksum_sha256, part_size, status, expires_at, created_at, updated_at
        `,
        [id, userId, fileName, contentType, fileSize, checksumSha256, partSize, expiresAt]
      );
      return result.rows[0];
    },

    async findByIdForUser(id, userId) {
      const result = await db.query(
        `
          SELECT id, user_id, file_name, content_type, file_size, checksum_sha256, part_size, status, expires_at,
                 media_id, storage_relative_path, created_at, updated_at
          FROM upload_sessions
          WHERE id = $1 AND user_id = $2
        `,
        [id, userId]
      );
      return result.rows[0] || null;
    },

    async setStatus(id, userId, status) {
      const result = await db.query(
        `
          UPDATE upload_sessions
          SET status = $3, updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, file_name, content_type, file_size, checksum_sha256, part_size, status, expires_at,
                    media_id, storage_relative_path, created_at, updated_at
        `,
        [id, userId, status]
      );
      return result.rows[0] || null;
    },

    async markCompleted({ id, userId, mediaId, storageRelativePath }) {
      const result = await db.query(
        `
          UPDATE upload_sessions
          SET status = 'completed',
              media_id = $3,
              storage_relative_path = $4,
              updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, file_name, content_type, file_size, checksum_sha256, part_size, status, expires_at,
                    media_id, storage_relative_path, created_at, updated_at
        `,
        [id, userId, mediaId, storageRelativePath]
      );
      return result.rows[0] || null;
    },

    async markAborted(id, userId) {
      const result = await db.query(
        `
          UPDATE upload_sessions
          SET status = 'aborted',
              updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, file_name, content_type, file_size, checksum_sha256, part_size, status, expires_at,
                    media_id, storage_relative_path, created_at, updated_at
        `,
        [id, userId]
      );
      return result.rows[0] || null;
    }
  };
}

module.exports = {
  buildUploadSessionsRepo
};
