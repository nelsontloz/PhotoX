function buildIdempotencyRepo(db) {
  return {
    async find(userId, scope, idemKey) {
      const result = await db.query(
        `
          SELECT user_id, scope, idem_key, request_hash, response_body, status_code
          FROM idempotency_keys
          WHERE user_id = $1 AND scope = $2 AND idem_key = $3
        `,
        [userId, scope, idemKey]
      );
      return result.rows[0] || null;
    },

    async insert({ userId, scope, idemKey, requestHash, responseBody, statusCode }) {
      await db.query(
        `
          INSERT INTO idempotency_keys
            (user_id, scope, idem_key, request_hash, response_body, status_code)
          VALUES
            ($1, $2, $3, $4, $5::jsonb, $6)
        `,
        [userId, scope, idemKey, requestHash, JSON.stringify(responseBody), statusCode]
      );
    }
  };
}

module.exports = {
  buildIdempotencyRepo
};
