function buildSessionsRepo(pool) {
  return {
    async createSession({ id, userId, refreshTokenHash, expiresAt }) {
      const result = await pool.query(
        `
          INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at)
          VALUES ($1, $2, $3, $4)
          RETURNING id, user_id, refresh_token_hash, expires_at, revoked_at, created_at
        `,
        [id, userId, refreshTokenHash, expiresAt]
      );
      return result.rows[0];
    },

    async findById(id) {
      const result = await pool.query(
        `
          SELECT id, user_id, refresh_token_hash, expires_at, revoked_at, created_at
          FROM sessions
          WHERE id = $1
          LIMIT 1
        `,
        [id]
      );
      return result.rows[0] || null;
    },

    async rotateSessionToken({ id, refreshTokenHash, expiresAt }) {
      const result = await pool.query(
        `
          UPDATE sessions
          SET refresh_token_hash = $2,
              expires_at = $3,
              revoked_at = NULL
          WHERE id = $1
          RETURNING id, user_id, refresh_token_hash, expires_at, revoked_at, created_at
        `,
        [id, refreshTokenHash, expiresAt]
      );
      return result.rows[0] || null;
    },

    async revokeById(id) {
      await pool.query(
        `
          UPDATE sessions
          SET revoked_at = NOW()
          WHERE id = $1
            AND revoked_at IS NULL
        `,
        [id]
      );
    }
  };
}

module.exports = {
  buildSessionsRepo
};
