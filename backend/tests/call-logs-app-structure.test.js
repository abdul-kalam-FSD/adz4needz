// Source-level guards for the call-log wiring (no database, no installed packages needed), in the style of payments-app-structure.test.js.
// They read app.js / server.js / the migration as text. Behaviour over real HTTP and real SQL is covered by
// tests-integration/call-logs.db.test.js (needs MySQL; see the README).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config/env.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const app = read('../src/app.js');
const server = read('../src/server.js');
const base = { DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' };

test('every BDE call-log route is authenticated and restricted to the bde role, and runs behind the JSON-only guard', () => {
  const guard = app.indexOf('api.use(requireJsonBody)');
  for (const route of [
    "api.get('/call-logs/summary', authenticate, authorize('bde'), asyncHandler(callLogs.summary))",
    "api.post('/call-logs', authenticate, authorize('bde'), asyncHandler(callLogs.record))",
    "api.post('/call-logs/:id/undo', authenticate, authorize('bde'), asyncHandler(callLogs.undo))"
  ]) { const at = app.indexOf(route); assert.ok(at > guard && guard > 0, route); }
  assert.equal((app.match(/\/call-logs/g) || []).length >= 3, true);
});
test('the admin statistics route is read-only, admin-only, and mounted before the generic /admin router', () => {
  assert.match(app, /callStatsRouter\.get\('\/', asyncHandler\(callLogs\.adminStats\)\)/);
  assert.equal((app.match(/callStatsRouter\.(post|put|patch|delete)\(/g) || []).length, 0);
  assert.match(app, /api\.use\('\/admin\/call-stats', authenticate, authorize\('admin'\), callStatsRouter\)/);
  assert.ok(app.indexOf("api.use('/admin/call-stats'") < app.indexOf("api.use('/admin', authenticate"));
});
test('existing guards still hold: adminRouter gained no routes, no delete routes, only the two original raw-body uploads plus the two admin lead-sheet uploads bypass the JSON guard', () => {
  assert.equal((app.match(/adminRouter\.get\(/g) || []).length, 14);
  assert.equal((app.match(/adminRouter\.(post|put|patch|delete)\(/g) || []).length, 0);
  assert.equal((app.match(/api\.delete\(/g) || []).length, 0);
  const before = app.slice(0, app.indexOf('api.use(requireJsonBody)'));
  assert.equal((before.match(/api\.(post|put|patch|delete)\(/g) || []).length, 4);
  assert.deepEqual((before.match(/api\.post\('[^']+'/g) || []).sort(), ["api.post('/admin/imports'", "api.post('/admin/lead-sheet/apply'", "api.post('/admin/lead-sheet/preview'", "api.post('/payment-instalments/:id/receipts'"]);
});
test('server.js builds the call-log service with the admin repository and the configured offset, and passes it to createApp', () => {
  assert.match(server, /createCallLogService\(\{ repo: createCallLogRepository\(db\), adminRepo, offsetMinutes: config\.reportUtcOffsetMinutes \}\)/);
  assert.match(server, /employeeService, callLogService, chatService, assignmentService, activityService, leadSheetService, checkDb:/);
});
test('the handlers take the user ONLY from the session; no handler reads a user id from the body, query or URL', () => {
  const h = read('../src/modules/call-logs/call-logs.handlers.js');
  assert.ok(!/req\.(body|query|params)\.(userId|user_id|bdeId)/.test(h));
  assert.match(h, /callLogService\.record\(req\.user, req\.body\)/); assert.match(h, /callLogService\.undo\(req\.user, req\.params\.id\)/); assert.match(h, /callLogService\.dailySummary\(req\.user, req\.query\.date\)/);
});
test('the repository is parameterised everywhere (no string-built SQL from input) and writes call and lead status in one transaction', () => {
  const r = read('../src/modules/call-logs/call-logs.repository.js');
  assert.ok(!/\$\{(?!COLUMNS)/.test(r.replace(/`SELECT \$\{COLUMNS\}[^`]*`/g, '')), 'no template interpolation of values in SQL');
  assert.match(r, /db\.transaction\(async \(tx\) =>/);
  assert.match(r, /UPDATE leads SET lead_status_id = \?, follow_up_date = COALESCE\(\?, follow_up_date\)[\s\S]*WHERE id = \? AND user_id = \?/);
  assert.ok(!/DELETE FROM/i.test(r), 'call logs are never deleted; undo only sets voided_at');
  assert.match(r, /voided_at IS NULL/);
  assert.ok(r.indexOf('UPDATE leads SET') < r.indexOf('INSERT INTO call_logs'), 'the lead row is locked first (avoids the lock-upgrade deadlock between duplicate clicks)');
});
test('migration 015: one additive CREATE TABLE, nothing destructive, with the keys the code relies on', () => {
  const raw = read('../db/migrations/015_call_logs.sql');
  const sql = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.equal(sql.split(';').map((s) => s.trim()).filter(Boolean).length, 1);
  assert.match(sql, /^\s*CREATE TABLE call_logs/);
  assert.ok(!/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|RENAME)\b/i.test(sql));
  assert.match(sql, /UNIQUE KEY uq_call_logs_request \(user_id, client_request_id\)/);
  assert.match(sql, /FOREIGN KEY \(lead_id, user_id\) REFERENCES leads \(id, user_id\)/);
  assert.match(sql, /outcome\s+ENUM\('interested','not_interested','follow_up','no_response'\) NOT NULL/);
  assert.match(sql, /voided_at\s+DATETIME NULL/);
});
test('config: REPORT_UTC_OFFSET_MINUTES defaults to India (330), is overridable, and rejects nonsense', () => {
  assert.equal(loadConfig(base).reportUtcOffsetMinutes, 330);
  assert.equal(loadConfig({ ...base, REPORT_UTC_OFFSET_MINUTES: '0' }).reportUtcOffsetMinutes, 0);
  assert.equal(loadConfig({ ...base, REPORT_UTC_OFFSET_MINUTES: '-300' }).reportUtcOffsetMinutes, -300);
  for (const bad of ['abc', '1.5', '841', '-721']) assert.throws(() => loadConfig({ ...base, REPORT_UTC_OFFSET_MINUTES: bad }), /REPORT_UTC_OFFSET_MINUTES/);
  assert.match(read('../.env.example'), /^REPORT_UTC_OFFSET_MINUTES=330$/m);
});
