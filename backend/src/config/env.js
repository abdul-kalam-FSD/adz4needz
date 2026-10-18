import path from "node:path";
import { fileURLToPath } from "node:url";

// Default receipt folder: backend/storage/receipts. It is NOT served by the API (no static files). Production should set
// RECEIPT_STORAGE_DIR to an absolute path outside the application folder (see docs/payments-and-uploads.md).
const DEFAULT_RECEIPT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "storage",
  "receipts",
);

// Reads settings from environment variables and fails early with a clear message.
// Error messages list variable NAMES only, never values.
export function loadConfig(env = process.env) {
  const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
  const missing = required.filter(
    (k) => env[k] === undefined || (env[k] === "" && k !== "DB_PASSWORD"),
  );
  if (missing.length) {
    throw new Error(
      "Missing required environment variables: " +
        missing.join(", ") +
        ". See backend/.env.example",
    );
  }
  const int = (name, fallback, min, max) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(
        `${name} must be a whole number between ${min} and ${max}`,
      );
    }
    return n;
  };
  const nodeEnv = env.NODE_ENV || "development";
  return {
    nodeEnv,
    port: int("PORT", 4000, 1, 65535),

    db: {
      host: env.DB_HOST,
      port: int("DB_PORT", 3306, 1, 65535),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      ssl: env.DB_SSL === "1",
    },
    sessionTtlHours: int("SESSION_TTL_HOURS", 8, 1, 168),
    loginRateLimitMax: int("LOGIN_RATE_LIMIT_MAX", 10, 1, 1000),
    trustProxy: env.TRUST_PROXY === "1",
    cookieSecure: nodeEnv === "production",
    cookieName: "bde_session",
    receiptStorageDir: env.RECEIPT_STORAGE_DIR
      ? path.resolve(env.RECEIPT_STORAGE_DIR)
      : DEFAULT_RECEIPT_DIR,
    receiptDirIsDefault: !env.RECEIPT_STORAGE_DIR,
    importMaxBytes: int(
      "IMPORT_MAX_BYTES",
      5 * 1024 * 1024,
      10 * 1024,
      20 * 1024 * 1024,
    ), // Excel/CSV lead import upload limit
    // Minutes added to UTC to get the company's working date for the call log (default 330 = India, UTC+05:30). TL to confirm.
    // Most chat messages one person may send per minute (flood protection; the limit is per logged-in user, not per address).
    chatSendRateLimitMax: int("CHAT_SEND_RATE_LIMIT_MAX", 20, 1, 1000),
    reportUtcOffsetMinutes: int("REPORT_UTC_OFFSET_MINUTES", 330, -720, 840),
    receiptMaxBytes: int(
      "RECEIPT_MAX_BYTES",
      5 * 1024 * 1024,
      1024,
      20 * 1024 * 1024,
    ), // technical default 5 MB, TL to confirm
  };
}
