
import { loadConfig } from "../src/config/env.js";
import { createDb } from "../src/db/pool.js";

const config = loadConfig();
const db = createDb(config.db);

try {
  const tables = await db.query(`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);

  console.log("Tables in selected database:");
  for (const row of tables) {
    console.log("-", row.TABLE_NAME);
  }

  const hasMigrations = tables.some(
    (row) => row.TABLE_NAME === "schema_migrations"
  );

  if (hasMigrations) {
    const applied = await db.query(
      "SELECT filename, applied_at FROM schema_migrations ORDER BY filename"
    );

    console.log("\nRecorded migrations:");
    for (const row of applied) {
      console.log("-", row.filename, "|", row.applied_at);
    }
  } else {
    console.log("\nschema_migrations table does not exist yet.");
  }
} catch (err) {
  console.error(
    "Inspection failed:",
    err.code || err.name,
    err.message
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
