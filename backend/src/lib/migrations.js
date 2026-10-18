// Migration engine used by scripts/migrate.js.
//
// Rules (see docs/migration-map.md):
//  - Files are identified and recorded by their FULL filename in schema_migrations(filename, applied_at). Numeric prefixes are NOT
//    unique (two files start with 007, two with 008), so a prefix is never used as an identifier.
//  - Order is deterministic: plain code-unit comparison of the full filename (no locale), so every machine gets the same order:
//    007_payments.sql, 007_users_phone.sql, 008_payment_instalments.sql, 008_users_email.sql, ...
//  - A file is recorded ONLY after every statement in it succeeded.
//  - Before a pending file is run, the live schema is inspected. If some or all of the objects the file creates already exist
//    although the file is not recorded, the file is NOT run: that is a partial or out-of-band application and needs a human decision.
//  - Nothing here drops, truncates or deletes anything.
//
// Everything below takes a `conn` with `query(sql, params) -> [rows]` (mysql2 shape) so it can be tested without a database.

export const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

// Plain comparison, never localeCompare: locale-dependent ordering could differ between machines.
export const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function orderMigrations(fileNames) {
  const sql = fileNames.filter((f) => f.endsWith('.sql'));
  const bad = sql.filter((f) => !MIGRATION_NAME.test(f));
  if (bad.length) throw new Error(`Migration file names must look like 001_name.sql (lower case): ${bad.join(', ')}`);
  return [...sql].sort(byName);
}

// Prefixes used by more than one file, for information only (they are allowed; the full name is the identity).
export function duplicatePrefixes(names) {
  const seen = new Map();
  for (const n of names) {
    const p = n.slice(0, 3);
    seen.set(p, [...(seen.get(p) || []), n]);
  }
  return [...seen.entries()].filter(([, list]) => list.length > 1).map(([prefix, files]) => ({ prefix, files }));
}

// Splits SQL text into statements. Understands -- line comments, /* */ comments, '...' and "..." strings (with \ and doubled-quote
// escapes) and `identifiers`. A ';' inside any of those does not end a statement. Comments are removed.
export function splitStatements(text) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = text.length;
  const push = () => {
    const s = cur.trim();
    if (s) out.push(s);
    cur = '';
  };
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '-' && d === '-' && (i + 2 >= n || /\s/.test(text[i + 2]))) {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      cur += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i++;
      while (i < n) {
        const ch = text[i];
        cur += ch;
        i++;
        if (ch === '\\' && q !== '`' && i < n) {
          cur += text[i];
          i++;
          continue;
        }
        if (ch === q) {
          if (text[i] === q) {
            cur += text[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (c === ';') {
      push();
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  push();
  return out;
}

const ident = '`?([A-Za-z0-9_]+)`?';

// Splits on commas that are not inside parentheses or quotes (the clauses of one ALTER TABLE).
function topLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      q = c;
      cur += c;
    } else if (c === '(') {
      depth++;
      cur += c;
    } else if (c === ')') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// What a statement leaves behind, as checkable expectations:
//   { kind: 'table', table } | { kind: 'column', table, column } | { kind: 'index', table, name }
//   { kind: 'fk', table, name } | { kind: 'comment', table, column, text } | { kind: 'rows', table, names: [...] }
// Anything the parser does not recognise is returned in `unknown` so the caller can refuse to guess.
export function expectationsOf(statement) {
  const s = statement.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${ident}`, 'i').exec(s))) {
    const table = m[1];
    const exp = [{ kind: 'table', table }];
    return { expectations: exp, unknown: false };
  }
  if ((m = new RegExp(`^ALTER TABLE ${ident} (.*)$`, 'is').exec(s))) {
    const table = m[1];
    const out = [];
    let unknown = false;
    for (const clause of topLevelCommas(m[2])) {
      let c;
      if ((c = new RegExp(`^ADD COLUMN ${ident}`, 'i').exec(clause))) out.push({ kind: 'column', table, column: c[1] });
      else if ((c = new RegExp(`^ADD (?:UNIQUE )?(?:KEY|INDEX) ${ident}`, 'i').exec(clause))) out.push({ kind: 'index', table, name: c[1] });
      else if ((c = new RegExp(`^ADD CONSTRAINT ${ident} FOREIGN KEY`, 'i').exec(clause))) out.push({ kind: 'fk', table, name: c[1] });
      else if ((c = new RegExp(`^MODIFY (?:COLUMN )?${ident} .* COMMENT '((?:[^'\\\\]|\\\\.|'')*)'$`, 'i').exec(clause)))
        out.push({ kind: 'comment', table, column: c[1], text: c[2].replace(/''/g, "'") });
      else unknown = true;
    }
    return { expectations: out, unknown };
  }
  if ((m = new RegExp(`^INSERT INTO ${ident} .*? VALUES (.*)$`, 'is').exec(s))) {
    const names = [...m[2].matchAll(/\(\s*'((?:[^'\\]|\\.|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
    return { expectations: names.length ? [{ kind: 'rows', table: m[1], names }] : [], unknown: names.length === 0 };
  }
  return { expectations: [], unknown: true };
}

export function expectationsOfFile(sqlText) {
  const statements = splitStatements(sqlText);
  const expectations = [];
  let unknown = false;
  for (const st of statements) {
    const r = expectationsOf(st);
    expectations.push(...r.expectations);
    if (r.unknown) unknown = true;
  }
  return { statements, expectations, unknown };
}

// ---- live schema checks (read-only) ----

const dbName = async (conn) => (await conn.query('SELECT DATABASE() AS db'))[0][0].db;

export async function checkExpectation(conn, e) {
  const db = await dbName(conn);
  const q = async (sql, params) => (await conn.query(sql, params))[0];
  if (e.kind === 'table') {
    const r = await q('SELECT 1 AS x FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [db, e.table]);
    return r.length > 0;
  }
  if (e.kind === 'column') {
    const r = await q('SELECT 1 AS x FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?', [db, e.table, e.column]);
    return r.length > 0;
  }
  if (e.kind === 'index') {
    const r = await q('SELECT 1 AS x FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?', [db, e.table, e.name]);
    return r.length > 0;
  }
  if (e.kind === 'fk') {
    const r = await q('SELECT 1 AS x FROM information_schema.table_constraints WHERE table_schema = ? AND table_name = ? AND constraint_name = ? AND constraint_type = ?', [db, e.table, e.name, 'FOREIGN KEY']);
    return r.length > 0;
  }
  if (e.kind === 'comment') {
    const r = await q('SELECT column_comment AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?', [db, e.table, e.column]);
    return r.length > 0 && r[0].c === e.text;
  }
  if (e.kind === 'rows') {
    // The table name comes from our own migration files, not from user input; it is validated by the identifier regex above.
    const tableExists = await checkExpectation(conn, { kind: 'table', table: e.table });
    if (!tableExists) return false;
    const r = await q(`SELECT name FROM \`${e.table}\` WHERE name IN (${e.names.map(() => '?').join(',')})`, e.names);
    return r.length === e.names.length;
  }
  throw new Error(`Unknown expectation kind: ${e.kind}`);
}

// 'none' = nothing from this file exists yet; 'all' = everything exists; 'partial' = mixed; 'unparsed' = parser could not tell.
export async function schemaState(conn, parsed) {
  if (parsed.unknown || parsed.expectations.length === 0) return { state: 'unparsed', found: [], missing: [] };
  const found = [];
  const missing = [];
  for (const e of parsed.expectations) ((await checkExpectation(conn, e)) ? found : missing).push(e);
  const state = missing.length === 0 ? 'all' : found.length === 0 ? 'none' : 'partial';
  return { state, found, missing };
}

export const describe = (e) =>
  e.kind === 'table' ? `table ${e.table}`
  : e.kind === 'column' ? `column ${e.table}.${e.column}`
  : e.kind === 'index' ? `index ${e.table}.${e.name}`
  : e.kind === 'fk' ? `foreign key ${e.table}.${e.name}`
  : e.kind === 'comment' ? `comment of ${e.table}.${e.column}`
  : `seed rows in ${e.table} (${e.names.length})`;

// TiDB reports e.g. "8.0.11-TiDB-v7.5.0". Returns null for a plain MySQL server.
export function parseTidbVersion(version) {
  const m = /TiDB-v(\d+)\.(\d+)\.(\d+)/i.exec(version || '');
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

// Features the SQL files rely on: composite foreign keys (006-009, 014-018, 005) and CHECK constraints (007, 008, 013).
export function compatibilityNotes(version) {
  const t = parseTidbVersion(version);
  if (!t) return [];
  const ge = (a, b) => t.major > a || (t.major === a && t.minor >= b);
  const notes = [];
  if (!ge(6, 6)) notes.push('TiDB older than v6.6 does not support foreign keys: migrations 003+ would not enforce ownership.');
  if (!ge(7, 2)) notes.push('TiDB older than v7.2 parses CHECK constraints but does not enforce them (007, 008, 013): amounts > 0 would only be enforced by the API.');
  return notes;
}

// ---- plan (read-only) ----

export async function loadApplied(conn) {
  const [t] = await conn.query("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'");
  if (t.length === 0) return { exists: false, names: new Set() };
  const [rows] = await conn.query('SELECT filename FROM schema_migrations');
  return { exists: true, names: new Set(rows.map((r) => r.filename)) };
}

// readFile(name) -> sql text. Never writes.
export async function planMigrations(conn, files, readFile) {
  const ordered = orderMigrations(files);
  const applied = await loadApplied(conn);
  const items = [];
  for (const name of ordered) {
    const parsed = expectationsOfFile(await readFile(name));
    const s = await schemaState(conn, parsed);
    let status;
    if (applied.names.has(name)) status = s.state === 'all' || s.state === 'unparsed' ? 'applied' : 'drift'; // recorded but objects missing
    else if (s.state === 'none') status = 'pending';
    else if (s.state === 'all') status = 'unrecorded-complete'; // objects exist, no record: applied outside the runner
    else if (s.state === 'partial') status = 'partial';
    else status = 'unparsed';
    items.push({ name, status, statements: parsed.statements.length, missing: s.missing, found: s.found });
  }
  const orphans = [...applied.names].filter((n) => !ordered.includes(n)).sort(byName);
  const blocking = items.filter((i) => ['drift', 'partial', 'unparsed'].includes(i.status));
  return { items, orphans, blocking, trackingTable: applied.exists, duplicates: duplicatePrefixes(ordered) };
}

// ---- apply ----

export class MigrationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'MigrationError';
    this.details = details;
  }
}

export async function ensureTrackingTable(conn) {
  await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}

// Runs every pending file in order. Stops at the first problem. Returns { applied: [...], skipped: [...] }.
// Refuses to start if the plan has any blocking item (drift / partial / unparsed) or an unrecorded-complete file (use recordOnly for those).
export async function applyMigrations(conn, files, readFile, log = () => {}) {
  const plan = await planMigrations(conn, files, readFile);
  if (plan.blocking.length || plan.items.some((i) => i.status === 'unrecorded-complete')) {
    throw new MigrationError('The plan has files that need a human decision; nothing was run.', plan.items.filter((i) => !['applied', 'pending'].includes(i.status)));
  }
  await ensureTrackingTable(conn);
  const applied = [];
  const skipped = [];
  for (const item of plan.items) {
    if (item.status === 'applied') {
      skipped.push(item.name);
      continue;
    }
    const parsed = expectationsOfFile(await readFile(item.name));
    log(`APPLY  ${item.name} (${parsed.statements.length} statement${parsed.statements.length === 1 ? '' : 's'})`);
    for (let i = 0; i < parsed.statements.length; i++) {
      try {
        await conn.query(parsed.statements[i]);
      } catch (err) {
        // DDL is not transactional: statements before this one in the SAME file may already have taken effect.
        const after = await schemaState(conn, parsed).catch(() => null);
        throw new MigrationError(`${item.name} failed at statement ${i + 1} of ${parsed.statements.length}: ${err.code || ''} ${err.message}`, {
          file: item.name,
          statementIndex: i + 1,
          statementCount: parsed.statements.length,
          code: err.code,
          schemaStateAfterFailure: after ? after.state : 'unknown',
          missingAfterFailure: after ? after.missing.map(describe) : [],
          recorded: false,
        });
      }
    }
    const post = await schemaState(conn, parsed);
    if (post.state !== 'all') {
      throw new MigrationError(`${item.name} ran without error but the expected objects are not all present; it was NOT recorded.`, { file: item.name, missing: post.missing.map(describe), recorded: false });
    }
    await conn.query('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, UTC_TIMESTAMP())', [item.name]);
    applied.push(item.name);
  }
  return { applied, skipped };
}

// Records a file as applied WITHOUT running it, only when every object it creates is verified to exist.
export async function recordOnly(conn, name, readFile) {
  const parsed = expectationsOfFile(await readFile(name));
  const s = await schemaState(conn, parsed);
  if (s.state !== 'all') throw new MigrationError(`Not recording ${name}: schema state is "${s.state}", not "all".`, { missing: s.missing.map(describe) });
  await ensureTrackingTable(conn);
  const [r] = await conn.query('SELECT 1 AS x FROM schema_migrations WHERE filename = ?', [name]);
  if (r.length) return false;
  await conn.query('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, UTC_TIMESTAMP())', [name]);
  return true;
}
