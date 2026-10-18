// Integration tests for the Call desk: the REAL Express app talking to a REAL MySQL database over HTTP.
// NOT part of `npm test`. Run with: npm run test:db
// Needs backend/.env pointing at a DEVELOPMENT database where migrations 001-015 are applied (015 creates call_logs).
// The test creates its own temporary users and leads (employee IDs starting "itest-") and removes them afterwards.
//
// STATUS: written but NOT YET RUN by its author (the build environment had no MySQL and no installed packages).
// If something fails on first run, treat it as a test-or-code defect to investigate, not as proof either way.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createDailyReportRepository } from '../src/modules/daily-reports/daily-reports.repository.js';
import { createDailyReportService } from '../src/modules/daily-reports/daily-reports.service.js';
import { createAdminRepository } from '../src/modules/admin/admin.repository.js';
import { createAdminService } from '../src/modules/admin/admin.service.js';
import { createLeadRepository } from '../src/modules/leads/leads.repository.js';
import { createLeadService } from '../src/modules/leads/leads.service.js';
import { createCallLogRepository } from '../src/modules/call-logs/call-logs.repository.js';
import { createCallLogService } from '../src/modules/call-logs/call-logs.service.js';

const PASSWORD = 'itest-' + randomBytes(9).toString('hex');
const tag = randomBytes(3).toString('hex');
const ids = {};
const jars = {};
const emp = Object.fromEntries(['bde1', 'bde2', 'bde3', 'admin'].map((k) => [k, 'itest-' + randomBytes(4).toString('hex')]));
let db, server, base, statusId, workDate;

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(base + '/api' + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  let data = null; try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data, res };
}
const usedPhones = new Set();
function uniquePhone() { let p; do { p = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'); } while (usedPhones.has(p)); usedPhones.add(p); return p; }
async function makeLead(who, name) {
  const r = await call(who, 'POST', '/leads', { candidateName: name, phone: uniquePhone(), courseOrInternship: 'Itest Course', leadStatusId: statusId });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.lead.id;
}
const outcome = (who, leadId, o, extra = {}) => call(who, 'POST', '/call-logs', { leadId, outcome: o, clientRequestId: randomUUID(), ...extra });
const rowsFor = (userId) => db.query('SELECT * FROM call_logs WHERE user_id = ? ORDER BY id', [userId]);
const leadRow = async (id) => (await db.query('SELECT lead_status_id, follow_up_date FROM leads WHERE id = ?', [id]))[0];
const statusIdByName = async (name) => (await db.query('SELECT id FROM lead_statuses WHERE name = ?', [name]))[0]?.id;
const isForeignKeyError = (e) => e.errno === 1216 || e.errno === 1452;

before(async () => {
  const config = loadConfig();
  db = createDb(config.db);
  const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const reportRepo = createDailyReportRepository(db);
  const adminRepo = createAdminRepository(db);
  const app = createApp({
    config: { ...config, loginRateLimitMax: 1000 }, authService,
    reportService: createDailyReportService({ repo: reportRepo }),
    adminService: createAdminService({ adminRepo, reportRepo }),
    leadService: createLeadService({ repo: createLeadRepository(db) }),
    callLogService: createCallLogService({ repo: createCallLogRepository(db), adminRepo, offsetMinutes: config.reportUtcOffsetMinutes }),
    checkDb: () => db.query('SELECT 1')
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const hash = await hashPassword(PASSWORD);
  for (const [who, role] of [['bde1', 'bde'], ['bde2', 'bde'], ['bde3', 'bde'], ['admin', 'admin']]) {
    const r = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', [emp[who], `Itest ${who}`, hash, role]);
    ids[who] = r.insertId;
    const login = await call(null, 'POST', '/auth/login', { employeeId: emp[who], password: PASSWORD });
    assert.equal(login.status, 200, 'login failed for ' + who);
    jars[who] = login.res.headers.get('set-cookie').split(';')[0];
  }
  statusId = await statusIdByName('New') ?? (await db.query('SELECT id FROM lead_statuses WHERE is_active = 1 ORDER BY sort_order LIMIT 1'))[0].id;
  workDate = (await call('bde1', 'GET', '/call-logs/summary')).data.date; // the server's own idea of "today"
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) {
    const userIds = Object.values(ids);
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await db.query(`DELETE FROM call_logs WHERE user_id IN (${marks})`, userIds); // children first (foreign keys)
      await db.query(`DELETE FROM daily_reports WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM leads WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM sessions WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await db.close();
  }
});

test('unauthenticated -> 401; admin cannot record or open the call desk; BDE cannot read admin statistics', async () => {
  for (const [m, p] of [['POST', '/call-logs'], ['POST', '/call-logs/1/undo'], ['GET', '/call-logs/summary'], ['GET', '/admin/call-stats?date=' + workDate]]) assert.equal((await call(null, m, p, {})).status, 401, `${m} ${p}`);
  const leadId = await makeLead('bde1', 'Itest Authz ' + tag);
  assert.equal((await outcome('admin', leadId, 'interested')).status, 403);
  assert.equal((await call('admin', 'GET', '/call-logs/summary')).status, 403);
  assert.equal((await call('bde1', 'GET', '/admin/call-stats?date=' + workDate)).status, 403);
  assert.equal((await call('admin', 'POST', '/admin/call-stats', {})).status, 404, 'no admin write route');
  assert.equal((await rowsFor(ids.bde1)).length, 0);
});

test('recording persists exactly as designed: owner from the session, working date, UTC time, and the lead moves to the matching status', async () => {
  const leadId = await makeLead('bde1', 'Itest Persist ' + tag);
  const r = await call('bde1', 'POST', '/call-logs', { leadId, outcome: 'interested', clientRequestId: randomUUID(), userId: ids.bde2, user_id: ids.bde2, callDate: '2001-01-01' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [row] = await rowsFor(ids.bde1);
  assert.equal(String(row.lead_id), String(leadId)); assert.equal(row.outcome, 'interested'); assert.equal(row.voided_at, null);
  assert.equal(row.call_date, workDate, 'the server decides the date, the body value is ignored');
  assert.equal((await rowsFor(ids.bde2)).length, 0);
  assert.equal((await leadRow(leadId)).lead_status_id, await statusIdByName('Interested'));
  assert.equal((await outcome('bde1', leadId, 'not_interested')).status, 201);
  assert.equal((await leadRow(leadId)).lead_status_id, await statusIdByName('Not Interested'));
});

test('the real unique key: the same click delivered five times AT ONCE creates exactly one call', async () => {
  const leadId = await makeLead('bde1', 'Itest Race ' + tag);
  const before = (await rowsFor(ids.bde1)).length;
  const body = { leadId, outcome: 'no_response', clientRequestId: randomUUID() };
  const results = await Promise.all(Array.from({ length: 5 }, () => call('bde1', 'POST', '/call-logs', body)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 201], JSON.stringify(results.map((r) => r.data)));
  assert.equal(new Set(results.map((r) => r.data.call.id)).size, 1, 'everyone is told about the same call');
  assert.equal((await rowsFor(ids.bde1)).length, before + 1);
  const reuse = await call('bde1', 'POST', '/call-logs', { ...body, outcome: 'interested' });
  assert.equal(reuse.status, 409); assert.equal(reuse.data.error.code, 'REQUEST_ID_REUSED');
});

test('ownership: another BDE gets 404 and nothing is written; the database itself refuses a call whose BDE does not own the lead', async () => {
  const leadId = await makeLead('bde1', 'Itest Owner ' + tag);
  assert.equal((await outcome('bde2', leadId, 'interested')).status, 404);
  assert.equal((await rowsFor(ids.bde2)).length, 0);
  await assert.rejects(db.query("INSERT INTO call_logs (user_id, lead_id, outcome, call_date, called_at, client_request_id, created_at) VALUES (?, ?, 'interested', ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())", [ids.bde2, leadId, workDate, randomUUID()]), isForeignKeyError);
  assert.equal((await outcome('bde1', 'abc', 'interested')).status, 400);
  assert.equal((await outcome('bde1', '987654321012', 'interested')).status, 404);
});

test('follow-up: the date is saved on the lead; a past date is refused and writes nothing', async () => {
  const leadId = await makeLead('bde1', 'Itest Follow ' + tag);
  const before = (await rowsFor(ids.bde1)).length;
  assert.equal((await outcome('bde1', leadId, 'follow_up', { followUpDate: '2020-01-01' })).status, 400);
  assert.equal((await outcome('bde1', leadId, 'interested', { followUpDate: '2099-01-01' })).status, 400);
  assert.equal((await rowsFor(ids.bde1)).length, before);
  assert.equal((await outcome('bde1', leadId, 'follow_up', { followUpDate: '2099-01-01' })).status, 201);
  const l = await leadRow(leadId); assert.equal(l.follow_up_date, '2099-01-01'); assert.equal(l.lead_status_id, await statusIdByName('Follow-up Required'));
});

test('repeat calls, undo and the numbers: BDE summary and admin statistics agree and exclude undone calls', async () => {
  const a = await makeLead('bde2', 'Itest A ' + tag); const b = await makeLead('bde2', 'Itest B ' + tag); const c = await makeLead('bde2', 'Itest C ' + tag);
  await outcome('bde2', a, 'no_response'); await outcome('bde2', a, 'no_response'); await outcome('bde2', a, 'interested'); // 3 calls, 1 lead, ends interested
  await outcome('bde2', b, 'not_interested');
  const mistake = await outcome('bde2', c, 'interested'); // clicked by mistake
  let s = (await call('bde2', 'GET', '/call-logs/summary')).data.stats;
  assert.equal(s.totalCalls, 5); assert.equal(s.uniqueLeadsCalled, 3); assert.equal(s.repeatCalls, 2); assert.equal(s.interestedLeads, 2);

  assert.equal((await call('bde1', 'POST', `/call-logs/${mistake.data.call.id}/undo`, {})).status, 404, 'not your call');
  assert.equal((await call('bde2', 'POST', `/call-logs/${mistake.data.call.id}/undo`, {})).status, 200);
  assert.equal((await call('bde2', 'POST', `/call-logs/${mistake.data.call.id}/undo`, {})).data.alreadyUndone, true);
  const stored = (await db.query('SELECT voided_at FROM call_logs WHERE id = ?', [mistake.data.call.id]))[0]; assert.ok(stored.voided_at, 'row kept, marked voided');
  s = (await call('bde2', 'GET', '/call-logs/summary')).data.stats;
  assert.equal(s.totalCalls, 4); assert.equal(s.uniqueLeadsCalled, 2); assert.equal(s.interestedLeads, 1); assert.equal(s.conversionRate, 0.25);
  assert.deepEqual(s.outcomes, { interested: 1, notInterested: 1, followUp: 0, noResponse: 2 });

  const admin = await call('admin', 'GET', '/admin/call-stats?date=' + workDate);
  assert.equal(admin.status, 200);
  const row = admin.data.bdes.find((x) => x.employeeId === emp.bde2);
  assert.equal(row.status, 'calls_recorded'); assert.equal(row.source, 'call_log'); assert.equal(row.totalCalls, 4); assert.equal(row.uniqueLeadsCalled, 2); /* lead C's only call was undone, so only A and B remain */ assert.equal(row.uniqueLeadsCalled, s.uniqueLeadsCalled, 'BDE summary and admin statistics must agree'); assert.equal(row.interestedLeads, 1); assert.equal(row.conversionRate, 0.25);
  assert.equal(admin.data.bdes.find((x) => x.employeeId === emp.bde3).status, 'no_activity');
  assert.equal((await call('admin', 'GET', '/admin/call-stats')).status, 400);
});

test('manual report fallback: used only when there are no logged calls, never added to them', async () => {
  const report = { reportDate: workDate, totalCalls: 40, interested: 6, notInterested: 20, followUpRequired: 4, noResponse: 10 };
  assert.equal((await call('bde3', 'POST', '/daily-reports', report)).status, 201);
  assert.equal((await call('bde2', 'POST', '/daily-reports', report)).status, 201); // bde2 also has logged calls today
  const stats = (await call('admin', 'GET', '/admin/call-stats?date=' + workDate)).data;
  const m = stats.bdes.find((x) => x.employeeId === emp.bde3); assert.equal(m.source, 'manual'); assert.equal(m.status, 'manual_report'); assert.equal(m.totalCalls, 40); assert.equal(m.conversionRate, 0.15);
  const both = stats.bdes.find((x) => x.employeeId === emp.bde2); assert.equal(both.source, 'call_log'); assert.equal(both.totalCalls, 4, 'not 44'); assert.equal(both.manualReport.totalCalls, 40);
});
