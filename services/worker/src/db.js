const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

function createPool(databaseUrl) {
  return new Pool({ connectionString: databaseUrl });
}

async function runMigrations(pool) {
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  );

  for (const fileName of migrationFiles) {
    const existing = await pool.query("SELECT filename FROM schema_migrations WHERE filename = $1", [
      fileName
    ]);

    if (existing.rowCount > 0) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [fileName]);
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }
}

module.exports = {
  createPool,
  runMigrations
};
