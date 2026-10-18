import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  applyMigrations, compatibilityNotes, duplicatePrefixes, expectationsOf, expectationsOfFile, orderMigrations, parseTidbVersion,
  planMigrations, recordOnly, splitStatements, MigrationError,
} from '../src/lib/migrations.js';

const dir = new URL('../db/migrations/', import.meta.url);
const realFiles = readdirSync(dir).filter((f) => f.endsWith('.sql'));
const read = async (n) => readFileSync(new URL(n, dir), 'utf8');

// In-memory stand-in for the database. It answers the exact read-only catalog queries the engine uses and applies DDL by the same
// expectation parser, so these tests prove the runner's ORDER / RECORDING / REFUSAL logic. They do NOT prove TiDB accepts the SQL.
function fakeDb({ failWhen } = {}) {
  const st = { tables: new Set(), columns: new Set(), indexes: new Set(), fks: new Set(), comments: new Map(), rows: new Map(), migrations: [], writes: [], tracking: false };
  const conn = {
    st,
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^SELECT DATABASE\(\)/i.test(s)) return [[{ db: 'bde_test' }]];
      if (/FROM information_schema.tables/i.test(s) && /schema_migrations/.test(s)) return [st.tracking ? [{ x: 1 }] : []];
      if (/FROM information_schema.tables/i.test(s)) return [st.tables.has(p[1]) ? [{ x: 1 }] : []];
      if (/FROM information_schema.columns/i.test(s) && /column_comment/i.test(s)) return [st.comments.has(`${p[1]}.${p[2]}`) ? [{ c: st.comments.get(`${p[1]}.${p[2]}`) }] : st.columns.has(`${p[1]}.${p[2]}`) ? [{ c: '' }] : []];
      if (/FROM information_schema.columns/i.test(s)) return [st.columns.has(`${p[1]}.${p[2]}`) ? [{ x: 1 }] : []];
      if (/FROM information_schema.statistics/i.test(s)) return [st.indexes.has(`${p[1]}.${p[2]}`) ? [{ x: 1 }] : []];
      if (/FROM information_schema.table_constraints/i.test(s)) return [st.fks.has(`${p[1]}.${p[2]}`) ? [{ x: 1 }] : []];
      if (/^SELECT name FROM `/i.test(s)) { const have = st.rows.get(/`(\w+)`/.exec(s)[1]) || []; return [p.filter((n) => have.includes(n)).map((name) => ({ name }))]; }
      if (/^SELECT filename FROM schema_migrations/i.test(s)) return [st.migrations.map((filename) => ({ filename }))];
      if (/^SELECT 1 AS x FROM schema_migrations WHERE/i.test(s)) return [st.migrations.includes(p[0]) ? [{ x: 1 }] : []];
      st.writes.push(s);
      if (/^CREATE TABLE IF NOT EXISTS schema_migrations/i.test(s)) { st.tracking = true; return [{}]; }
      if (/^INSERT INTO schema_migrations/i.test(s)) { st.migrations.push(p[0]); return [{}]; }
      if (failWhen && failWhen(s)) throw Object.assign(new Error('injected failure'), { code: 'ER_INJECTED' });
      const { expectations } = expectationsOf(s);
      for (const e of expectations) {
        if (e.kind === 'table') { if (st.tables.has(e.table)) throw Object.assign(new Error(`Table '${e.table}' already exists`), { code: 'ER_TABLE_EXISTS_ERROR' }); st.tables.add(e.table); }
        if (e.kind === 'column') st.columns.add(`${e.table}.${e.column}`);
        if (e.kind === 'index') st.indexes.add(`${e.table}.${e.name}`);
        if (e.kind === 'fk') st.fks.add(`${e.table}.${e.name}`);
        if (e.kind === 'comment') st.comments.set(`${e.table}.${e.column}`, e.text);
        if (e.kind === 'rows') st.rows.set(e.table, [...(st.rows.get(e.table) || []), ...e.names]);
      }
      return [{}];
    },
  };
  return conn;
}

test('order: the 20 real files sort by FULL name, so 007_payments precedes 007_users_phone and 008_payment_instalments precedes 008_users_email', () => {
  const o = orderMigrations([...realFiles].reverse());
  assert.equal(o.length, 20);
  assert.deepEqual(o, [...realFiles].sort());
  assert.ok(o.indexOf('007_payments.sql') < o.indexOf('007_users_phone.sql'));
  assert.ok(o.indexOf('008_payment_instalments.sql') < o.indexOf('008_users_email.sql'));
  assert.ok(o.indexOf('006_interviews.sql') < o.indexOf('007_payments.sql') && o.indexOf('010_deprecate_interview_payment_flag.sql') < o.indexOf('011_lead_import_batches.sql'));
  assert.deepEqual(duplicatePrefixes(o).map((d) => d.prefix), ['007', '008']);
});

test('order: badly named files are rejected instead of being sorted somewhere', () => {
  assert.throws(() => orderMigrations(['1_x.sql']), /must look like/);
  assert.throws(() => orderMigrations(['001_Users.sql']), /must look like/);
});

test('splitStatements: ignores comments, keeps ; inside strings and backticks, splits at real ;', () => {
  const r = splitStatements("-- a; b\nCREATE TABLE t (a INT COMMENT 'x;y', `we;ird` INT); /* c; */ INSERT INTO t VALUES ('it''s;ok');\n-- tail");
  assert.equal(r.length, 2);
  assert.match(r[0], /COMMENT 'x;y'/);
  assert.match(r[1], /it''s;ok/);
});

test('every real migration file parses into checkable expectations (nothing unrecognised)', () => {
  for (const f of realFiles) {
    const p = expectationsOfFile(readFileSync(new URL(f, dir), 'utf8'));
    assert.equal(p.unknown, false, f);
    assert.ok(p.expectations.length > 0, f);
  }
  const t = (f) => expectationsOfFile(readFileSync(new URL(f, dir), 'utf8')).expectations;
  assert.deepEqual(t('001_users_sessions.sql').map((e) => e.table), ['users', 'sessions']);
  assert.deepEqual(t('005_leads_id_user_unique_key.sql'), [{ kind: 'index', table: 'leads', name: 'uq_leads_id_user' }]);
  assert.deepEqual(t('007_users_phone.sql'), [{ kind: 'column', table: 'users', column: 'phone' }]);
  assert.equal(t('004_seed_proposed_lead_statuses.sql')[0].names.length, 5);
  assert.equal(t('010_deprecate_interview_payment_flag.sql')[0].kind, 'comment');
  const e14 = t('014_receipt_review.sql');
  assert.equal(e14.filter((e) => e.kind === 'column').length, 4);
  assert.ok(e14.some((e) => e.kind === 'index' && e.name === 'idx_receipts_review') && e14.some((e) => e.kind === 'fk' && e.name === 'fk_receipts_reviewer'));
});

test('plan on an empty database is read-only: every file pending, schema_migrations not created, no writes', async () => {
  const c = fakeDb();
  const plan = await planMigrations(c, realFiles, read);
  assert.equal(plan.items.length, 20);
  assert.ok(plan.items.every((i) => i.status === 'pending'));
  assert.equal(plan.trackingTable, false);
  assert.equal(c.st.tracking, false);
  assert.deepEqual(c.st.writes, []);
});

test('apply on an empty database runs all 20 in deterministic order and records each exact filename', async () => {
  const c = fakeDb();
  const r = await applyMigrations(c, realFiles, read);
  assert.deepEqual(r.applied, [...realFiles].sort());
  assert.deepEqual(c.st.migrations, [...realFiles].sort());
  // 007_payments recorded before 007_users_phone
  assert.ok(c.st.migrations.indexOf('007_payments.sql') < c.st.migrations.indexOf('007_users_phone.sql'));
});

test('rerun is a no-op: nothing applied, no DDL or INSERT sent', async () => {
  const c = fakeDb();
  await applyMigrations(c, realFiles, read);
  c.st.writes.length = 0;
  const r = await applyMigrations(c, realFiles, read);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 20);
  assert.ok(!c.st.writes.some((w) => /^(CREATE TABLE (?!IF NOT EXISTS)|ALTER|INSERT INTO lead|INSERT INTO schema_migrations)/i.test(w)), c.st.writes.join('\n'));
});

test('a failing file is not recorded, later files do not run, and the error says which statement failed', async () => {
  const c = fakeDb({ failWhen: (s) => /ALTER TABLE payment_receipts/.test(s) });
  await assert.rejects(applyMigrations(c, realFiles, read), (e) => e instanceof MigrationError && /014_receipt_review\.sql failed at statement 1 of 3/.test(e.message) && e.details.recorded === false && e.details.code === 'ER_INJECTED');
  assert.ok(!c.st.migrations.includes('014_receipt_review.sql'));
  assert.ok(!c.st.tables.has('call_logs'), '015 must not run after 014 failed');
  assert.ok(c.st.migrations.includes('013_monthly_targets.sql'));
});

test('014 on TiDB-style rejection of a combined ALTER is avoided: three separate statements; a failure at the FK leaves a PARTIAL state that blocks re-runs', async () => {
  const c = fakeDb({ failWhen: (s) => /ADD CONSTRAINT fk_receipts_reviewer/.test(s) });
  await assert.rejects(applyMigrations(c, realFiles, read), (e) => /statement 3 of 3/.test(e.message) && e.details.schemaStateAfterFailure === 'partial' && e.details.missingAfterFailure.join() === 'foreign key payment_receipts.fk_receipts_reviewer');
  assert.ok(c.st.columns.has('payment_receipts.review_note') && !c.st.migrations.includes('014_receipt_review.sql'));
});

test('a file that failed halfway (001: users created, sessions failed) is diagnosed as partial and later runs REFUSE to touch it', async () => {
  const c = fakeDb({ failWhen: (s) => /CREATE TABLE sessions/.test(s) });
  await assert.rejects(applyMigrations(c, realFiles, read), (e) => e.details.schemaStateAfterFailure === 'partial' && e.details.missingAfterFailure.includes('table sessions'));
  assert.ok(c.st.tables.has('users') && !c.st.migrations.includes('001_users_sessions.sql'));
  const c2 = fakeDb();
  c2.st.tables.add('users');
  const plan = await planMigrations(c2, realFiles, read);
  assert.equal(plan.items[0].status, 'partial');
  c2.st.writes.length = 0;
  await assert.rejects(applyMigrations(c2, realFiles, read), /need a human decision/);
  assert.deepEqual(c2.st.writes, [], 'nothing may run when a file is partial');
});

test('objects exist but the file is not recorded: plan says unrecorded-complete, apply refuses, record adopts it only after verifying', async () => {
  const c = fakeDb();
  c.st.tables.add('users'); c.st.tables.add('sessions');
  const plan = await planMigrations(c, realFiles, read);
  assert.equal(plan.items[0].status, 'unrecorded-complete');
  await assert.rejects(applyMigrations(c, realFiles, read), /need a human decision/);
  await assert.rejects(recordOnly(c, '002_daily_reports.sql', read), /not "all"/);
  assert.equal(await recordOnly(c, '001_users_sessions.sql', read), true);
  assert.deepEqual(c.st.migrations, ['001_users_sessions.sql']);
  assert.equal(await recordOnly(c, '001_users_sessions.sql', read), false);
  const r = await applyMigrations(c, realFiles, read);
  assert.equal(r.skipped[0], '001_users_sessions.sql');
  assert.equal(r.applied.length, 19);
});

test('drift: recorded but objects missing is blocking; recorded names with no file are only reported', async () => {
  const c = fakeDb();
  c.st.tracking = true;
  c.st.migrations.push('001_users_sessions.sql', '015_chat_messages.sql');
  const plan = await planMigrations(c, realFiles, read);
  assert.equal(plan.items[0].status, 'drift');
  assert.deepEqual(plan.orphans, ['015_chat_messages.sql']);
  assert.equal(plan.blocking.length, 1);
});

test('seed migration 004 and the comment migration 010 are checked by content, not just by name', async () => {
  const c = fakeDb();
  await applyMigrations(c, realFiles, read);
  assert.deepEqual(c.st.rows.get('lead_statuses').length, 5);
  c.st.rows.set('lead_statuses', ['New']); // somebody deleted four seed rows
  c.st.comments.set('interviews.payment_confirmed', 'something else');
  const plan = await planMigrations(c, realFiles, read);
  const st = Object.fromEntries(plan.items.map((i) => [i.name, i.status]));
  assert.equal(st['004_seed_proposed_lead_statuses.sql'], 'drift');
  assert.equal(st['010_deprecate_interview_payment_flag.sql'], 'drift');
});

test('TiDB version notes', () => {
  assert.deepEqual(parseTidbVersion('8.0.11-TiDB-v7.5.1'), { major: 7, minor: 5, patch: 1 });
  assert.equal(parseTidbVersion('8.0.36'), null);
  assert.deepEqual(compatibilityNotes('8.0.11-TiDB-v8.1.0'), []);
  assert.equal(compatibilityNotes('8.0.11-TiDB-v7.1.0').length, 1);
  assert.equal(compatibilityNotes('8.0.11-TiDB-v6.5.0').length, 2);
  assert.deepEqual(compatibilityNotes('8.0.36'), []);
});
