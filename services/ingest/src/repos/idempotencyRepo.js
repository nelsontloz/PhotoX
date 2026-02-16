function buildIdempotencyRepo(db) {
  function queryable(executor) {
    return executor || db;
  }

  return {
    async find(userId, scope, idemKey, executor) {
      const result = await queryable(executor).query(
        `
          SELECT user_id, scope, idem_key, request_hash, response_body, status_code
          FROM idempotency_keys
          WHERE user_id = $1 AND scope = $2 AND idem_key = $3
        `,
        [userId, scope, idemKey]
      );
      return result.rows[0] || null;
    },

    async insert({ userId, scope, idemKey, requestHash, responseBody, statusCode }, executor) {
      await queryable(executor).query(
        `
          INSERT INTO idempotency_keys
            (user_id, scope, idem_key, request_hash, response_body, status_code)
          VALUES
            ($1, $2, $3, $4, $5::jsonb, $6)
        `,
        [userId, scope, idemKey, requestHash, JSON.stringify(responseBody), statusCode]
      );
    },

    async insertOrGetExisting({ userId, scope, idemKey, requestHash, responseBody, statusCode }, executor) {
      const result = await queryable(executor).query(
        `
          WITH inserted AS (
            INSERT INTO idempotency_keys
              (user_id, scope, idem_key, request_hash, response_body, status_code)
            VALUES
              ($1, $2, $3, $4, $5::jsonb, $6)
            ON CONFLICT (user_id, scope, idem_key)
            DO NOTHING
            RETURNING user_id, scope, idem_key, request_hash, response_body, status_code
          )
          SELECT TRUE AS inserted,
                 i.user_id,
                 i.scope,
                 i.idem_key,
                 i.request_hash,
                 i.response_body,
                 i.status_code
          FROM inserted i
          UNION ALL
          SELECT FALSE AS inserted,
                 k.user_id,
                 k.scope,
                 k.idem_key,
                 k.request_hash,
                 k.response_body,
                 k.status_code
          FROM idempotency_keys k
          WHERE k.user_id = $1
            AND k.scope = $2
            AND k.idem_key = $3
            AND NOT EXISTS (SELECT 1 FROM inserted)
        `,
        [userId, scope, idemKey, requestHash, JSON.stringify(responseBody), statusCode]
      );

      if (result.rowCount === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        inserted: row.inserted,
        record: {
          user_id: row.user_id,
          scope: row.scope,
          idem_key: row.idem_key,
          request_hash: row.request_hash,
          response_body: row.response_body,
          status_code: row.status_code
        }
      };
    }
  };
}

module.exports = {
  buildIdempotencyRepo
};
