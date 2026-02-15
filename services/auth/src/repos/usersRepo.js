function toPublicUser(userRow) {
  return {
    id: userRow.id,
    email: userRow.email,
    name: null
  };
}

function buildUsersRepo(pool) {
  return {
    async createUser({ id, email, passwordHash }) {
      const result = await pool.query(
        `
          INSERT INTO users (id, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id, email, password_hash, created_at, updated_at
        `,
        [id, email, passwordHash]
      );
      return result.rows[0];
    },

    async findByEmail(email) {
      const result = await pool.query(
        "SELECT id, email, password_hash, created_at, updated_at FROM users WHERE email = $1 LIMIT 1",
        [email]
      );
      return result.rows[0] || null;
    },

    async findById(id) {
      const result = await pool.query(
        "SELECT id, email, password_hash, created_at, updated_at FROM users WHERE id = $1 LIMIT 1",
        [id]
      );
      return result.rows[0] || null;
    },

    toPublicUser
  };
}

module.exports = {
  buildUsersRepo,
  toPublicUser
};
