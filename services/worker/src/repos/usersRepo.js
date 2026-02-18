function buildUsersRepo(pool) {
  return {
    async findById(id) {
      const result = await pool.query(
        "SELECT id, is_admin, is_active FROM users WHERE id = $1 LIMIT 1",
        [id]
      );
      return result.rows[0] || null;
    }
  };
}

module.exports = {
  buildUsersRepo
};
