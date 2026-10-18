
import { loadConfig } from "../src/config/env.js";
import { createDb } from "../src/db/pool.js";

const config = loadConfig();
const db = createDb(config.db);

try {
  const result = await db.query("SELECT 1 AS ok");
  const database = await db.query("SELECT DATABASE() AS selected_db");

  console.log("DB connection successful:", result[0]?.ok === 1);
  console.log("Database selected:", database[0]?.selected_db);
} catch (err) {
  console.error(
    "DB connection failed:",
    err.code || err.name,
    err.message
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
