const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();
const MIGRATIONS_DIR = path.join(__dirname, "..", "src", "migrations");
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const { rows } = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [file]);
    if (rows.length > 0) { console.log(`skip (already applied): ${file}`); continue; }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`applying: ${file}`);
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
      await pool.query("COMMIT");
    } catch (err) { await pool.query("ROLLBACK"); throw err; }
  }
  console.log("Migrations complete.");
  await pool.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
