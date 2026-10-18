// Migration runner. Run from backend/.
//   npm run migrate                         plan (default): READ-ONLY. Shows applied / pending / partial / drift. Writes nothing.
//   npm run migrate:apply -- --yes          applies pending files in order; records each file only after all its statements succeed.
//   npm run migrate -- record <file> --yes  records a file as applied WITHOUT running it, only if every object it creates exists.
//
// The plan never creates schema_migrations. Apply refuses to run if any file is partial, drifted or unrecognised.
// This script never drops, truncates or deletes anything.

import fs from 'node:fs';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config/env.js';
import { applyMigrations, compatibilityNotes, describe, MigrationError, planMigrations, recordOnly } from '../src/lib/migrations.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(scriptDir, '..', 'db', 'migrations');
const caPath = path.resolve(scriptDir, '..', 'certs', 'isrgrootx1.pem');

const [command = 'plan', ...rest] = process.argv.slice(2);
const yes = rest.includes('--yes');
const positional = rest.filter((a) => !a.startsWith('--'));

if (!['plan', 'apply', 'record'].includes(command) || (command === 'record' && positional.length !== 1)) {
  console.error('Usage: migrate.js [plan | apply --yes | record <file.sql> --yes]');
  process.exit(1);
}
if ((command === 'apply' || command === 'record') && !yes) {
  console.error(`"${command}" changes the database. Re-run with --yes after reviewing the plan (npm run migrate).`);
  process.exit(1);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error('Configuration error:', err.message);
  process.exit(1);
}
if (config.db.ssl && !fs.existsSync(caPath)) {
  console.error('TLS CA certificate not found:', caPath);
  process.exit(1);
}

let conn;
try {
  conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    ...(config.db.ssl ? { ssl: { minVersion: 'TLSv1.2', ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true } } : {}),
  });
} catch (err) {
  console.error('Cannot connect to database:', err.code || err.message);
  process.exit(1);
}

const read = (name) => readFile(path.join(migrationsDir, name), 'utf8');

try {
  const [[{ v }]] = await conn.query('SELECT VERSION() AS v');
  console.log(`Database: ${config.db.database}   Server: ${v}   Mode: ${command}`);
  for (const note of compatibilityNotes(v)) console.log('WARNING:', note);
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql'));

  if (command === 'record') {
    const done = await recordOnly(conn, positional[0], read);
    console.log(done ? `RECORDED ${positional[0]}` : `${positional[0]} was already recorded`);
  } else {
    if (command === 'apply') {
      const r = await applyMigrations(conn, files, read, console.log);
      console.log(`\nApplied ${r.applied.length}, already applied ${r.skipped.length}.`);
    }
    const plan = await planMigrations(conn, files, read);
    console.log('');
    for (const i of plan.items) {
      const extra = i.status === 'pending' || i.status === 'applied' ? '' : `  <- ${i.missing.length ? 'missing: ' + i.missing.map(describe).join('; ') : 'see docs/migration-map.md'}`;
      console.log(`${i.status.toUpperCase().padEnd(20)} ${i.name}${extra}`);
    }
    if (!plan.trackingTable) console.log('\nschema_migrations does not exist yet (plan mode does not create it).');
    for (const o of plan.orphans) console.log(`NOTE recorded name with no file (ignored): ${o}`);
    for (const d of plan.duplicates) console.log(`NOTE shared prefix ${d.prefix}: ${d.files.join(', ')} (tracked by full name)`);
    const count = (s) => plan.items.filter((i) => i.status === s).length;
    console.log(`\napplied ${count('applied')} | pending ${count('pending')} | needs decision ${plan.blocking.length + count('unrecorded-complete')}`);
    if (command === 'plan') console.log('Plan mode executed no SQL that changes anything.');
    if (plan.blocking.length || count('unrecorded-complete')) process.exitCode = 2;
  }
} catch (err) {
  if (err instanceof MigrationError) {
    console.error('\nMigration stopped:', err.message);
    if (err.details) console.error(JSON.stringify(err.details, (k, v) => (k === 'missing' || k === 'found' ? (Array.isArray(v) ? v.map((e) => (typeof e === 'string' ? e : describe(e))) : v) : v), 2));
  } else console.error('Migration failed:', err.code || '', err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
