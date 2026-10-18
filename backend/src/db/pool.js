
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";

// DATE/DATETIME columns return as strings to avoid timezone surprises.
export function createDb(dbConfig) {
  const pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
    timezone: "Z",
    ...(dbConfig.ssl
      ? {
          ssl: {
            minVersion: "TLSv1.2",
            ca: fs.readFileSync(
              path.resolve(
                process.cwd(),
                "certs",
                "isrgrootx1.pem"
              ),
              "utf8"
            ),
            rejectUnauthorized: true,
          },
        }
      : {}),
  });

  return {
    // Parameterized queries help prevent SQL injection.
    async query(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return rows;
    },

    // Run queries inside a transaction.
    async transaction(fn) {
      const conn = await pool.getConnection();

      try {
        await conn.beginTransaction();

        const result = await fn({
          query: async (sql, params = []) => {
            const [rows] = await conn.execute(sql, params);
            return rows;
          },
        });

        await conn.commit();
        return result;
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          // Connection may already be broken.
        }

        throw err;
      } finally {
        conn.release();
      }
    },

    close: () => pool.end(),
  };
}
