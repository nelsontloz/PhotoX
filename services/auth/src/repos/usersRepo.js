function toPublicUser(userRow) {
  return {
    id: userRow.id,
    email: userRow.email,
    name: null,
    isAdmin: Boolean(userRow.is_admin),
    isActive: Boolean(userRow.is_active)
  };
}

function buildUsersRepo(pool) {
  function queryable(executor) {
    return executor || pool;
  }

  return {
    async createUserForRegistration({ id, email, passwordHash }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [947311]);
        const result = await client.query(
          `
            INSERT INTO users (id, email, password_hash, is_admin, is_active)
            VALUES (
              $1,
              $2,
              $3,
              NOT EXISTS (SELECT 1 FROM users WHERE is_admin = true),
              true
            )
            RETURNING id, email, password_hash, is_admin, is_active, created_at, updated_at
          `,
          [id, email, passwordHash]
        );
        await client.query("COMMIT");
        return result.rows[0];
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async createUserByAdmin({ id, email, passwordHash, isAdmin }) {
      const result = await pool.query(
        `
          INSERT INTO users (id, email, password_hash, is_admin, is_active)
          VALUES ($1, $2, $3, $4, true)
          RETURNING id, email, password_hash, is_admin, is_active, created_at, updated_at
        `,
        [id, email, passwordHash, isAdmin]
      );
      return result.rows[0];
    },

    async findByEmail(email) {
      const result = await pool.query(
        "SELECT id, email, password_hash, is_admin, is_active, created_at, updated_at FROM users WHERE email = $1 LIMIT 1",
        [email]
      );
      return result.rows[0] || null;
    },

    async findById(id) {
      const result = await pool.query(
        "SELECT id, email, password_hash, is_admin, is_active, created_at, updated_at FROM users WHERE id = $1 LIMIT 1",
        [id]
      );
      return result.rows[0] || null;
    },

    async updateUser({ id, email, passwordHash, isAdmin, isActive }, executor) {
      const values = [id];
      const updates = [];

      if (email !== undefined) {
        values.push(email);
        updates.push(`email = $${values.length}`);
      }

      if (passwordHash !== undefined) {
        values.push(passwordHash);
        updates.push(`password_hash = $${values.length}`);
      }

      if (isAdmin !== undefined) {
        values.push(isAdmin);
        updates.push(`is_admin = $${values.length}`);
      }

      if (isActive !== undefined) {
        values.push(isActive);
        updates.push(`is_active = $${values.length}`);
      }

      if (updates.length === 0) {
        return this.findById(id);
      }

      updates.push("updated_at = NOW()");

      const result = await queryable(executor).query(
        `
          UPDATE users
          SET ${updates.join(", ")}
          WHERE id = $1
          RETURNING id, email, password_hash, is_admin, is_active, created_at, updated_at
        `,
        values
      );

      return result.rows[0] || null;
    },

    async countActiveAdmins(executor) {
      const result = await queryable(executor).query(
        "SELECT COUNT(*)::INT AS count FROM users WHERE is_admin = true AND is_active = true"
      );
      return result.rows[0].count;
    },

    async listUsersWithStats({ limit, offset }, executor) {
      const db = queryable(executor);
      const relationResult = await db.query(
        "SELECT to_regclass('public.media') AS media_table, to_regclass('public.media_flags') AS media_flags_table"
      );
      const hasMediaTable = Boolean(relationResult.rows[0].media_table);
      const hasMediaFlagsTable = Boolean(relationResult.rows[0].media_flags_table);

      let query = `
        SELECT
          u.id,
          u.email,
          u.password_hash,
          u.is_admin,
          u.is_active,
          u.created_at,
          u.updated_at,
          0::INT AS upload_count
        FROM users u
        ORDER BY u.created_at ASC, u.id ASC
        LIMIT $1 OFFSET $2
      `;

      if (hasMediaTable) {
        const countExpr = hasMediaFlagsTable
          ? "COUNT(*) FILTER (WHERE COALESCE(mf.deleted_soft, false) = false)::INT"
          : "COUNT(*)::INT";
        const flagsJoin = hasMediaFlagsTable ? "LEFT JOIN media_flags mf ON mf.media_id = m.id" : "";

        query = `
          SELECT
            u.id,
            u.email,
            u.password_hash,
            u.is_admin,
            u.is_active,
            u.created_at,
            u.updated_at,
            COALESCE(mu.upload_count, 0)::INT AS upload_count
          FROM users u
          LEFT JOIN (
            SELECT m.owner_id, ${countExpr} AS upload_count
            FROM media m
            ${flagsJoin}
            GROUP BY m.owner_id
          ) mu ON mu.owner_id = u.id
          ORDER BY u.created_at ASC, u.id ASC
          LIMIT $1 OFFSET $2
        `;
      }

      const [usersResult, totalResult] = await Promise.all([
        db.query(query, [limit, offset]),
        db.query("SELECT COUNT(*)::INT AS total_users FROM users")
      ]);

      return {
        users: usersResult.rows,
        totalUsers: totalResult.rows[0].total_users
      };
    },

    toPublicUser
  };
}

module.exports = {
  buildUsersRepo,
  toPublicUser
};
