function buildUploadPartsRepo(db) {
  return {
    async upsertPart({ uploadId, partNumber, byteSize, checksumSha256, relativePartPath }) {
      const result = await db.query(
        `
          INSERT INTO upload_parts (upload_id, part_number, byte_size, checksum_sha256, relative_part_path)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (upload_id, part_number)
          DO UPDATE SET
            byte_size = EXCLUDED.byte_size,
            checksum_sha256 = EXCLUDED.checksum_sha256,
            relative_part_path = EXCLUDED.relative_part_path,
            created_at = NOW()
          RETURNING upload_id, part_number, byte_size, checksum_sha256, relative_part_path, created_at
        `,
        [uploadId, partNumber, byteSize, checksumSha256, relativePartPath]
      );
      return result.rows[0];
    },

    async listParts(uploadId) {
      const result = await db.query(
        `
          SELECT upload_id, part_number, byte_size, checksum_sha256, relative_part_path, created_at
          FROM upload_parts
          WHERE upload_id = $1
          ORDER BY part_number ASC
        `,
        [uploadId]
      );
      return result.rows;
    },

    async getUploadedBytes(uploadId) {
      const result = await db.query(
        `
          SELECT COALESCE(SUM(byte_size), 0)::BIGINT AS uploaded_bytes
          FROM upload_parts
          WHERE upload_id = $1
        `,
        [uploadId]
      );
      return Number(result.rows[0].uploaded_bytes || 0);
    }
  };
}

module.exports = {
  buildUploadPartsRepo
};
