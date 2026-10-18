// Integration test: the monthly report, My Month, targets and the Excel/PDF exports on REAL MySQL, with call-log AND manual data.
// NOT part of `npm test`. Run with: npm run test:db   (needs backend/.env, migrations 001-015, `npm install` for exceljs/pdfkit)
// Uses a quiet month (March 2031) and its own temporary users (employee IDs "itest-..."), removed afterwards. Development database only.
//
// STATUS: written but NOT YET RUN by its author (no MySQL, no installed packages in the build environment). Treat a first-run failure
// as a defect to investigate in the test OR the code; this file is not evidence that the SQL works.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createLeadRepository } from '../src/modules/leads/leads.repository.js';
import { createLeadService } from '../src/modules/leads/leads.service.js';
import { createMonthlyReportRepository } from '../src/modules/monthly-reports/monthly-reports.repository.js';
import { createMonthlyReportService } from '../src/modules/monthly-reports/monthly-reports.service.js';

const MONTH = '2031-03';
const PASSWORD = 'itest-' + randomBytes(9).toString('hex');
const emp = Object.fromEntries(['bde1', 'bde2', 'bde3', 'admin'].map((k) => [k, 'itest-' + randomBytes(4).toString('hex')]));
const ids = {}; const jars = {}; const lead = {};
let db, server, base, statusId;

async function call(who, method, path, body, raw) {
  const headers = { 'Content-Type': 'application/json' };
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(base + '/api' + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), res };
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data, res };
}
const usedPhones = new Set();
const uniquePhone = () => { let p; do { p = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'); } while (usedPhones.has(p)); usedPhones.add(p); return p; };
async function makeLead(who, name) {
  const r = await call(who, 'POST', '/leads', { candidateName: name, phone: uniquePhone(), courseOrInternship: 'Itest', leadStatusId: statusId });
  assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.lead.id;
}
const addCall = (user, leadId, outcome, date, time, voided = false) => db.query(
  `INSERT INTO call_logs (user_id, lead_id, outcome, call_date, called_at, client_request_id, voided_at, created_at) VALUES (?, ?, ?, ?, ?, UUID(), ?, UTC_TIMESTAMP())`,
  [user, leadId, outcome, date, `${date} ${time}`, voided ? `${date} ${time}` : null]);
const addManual = (user, date, total, interested, notInterested, followUp, noResponse) => db.query(
  'INSERT INTO daily_reports (user_id, report_date, total_calls, interested, not_interested, follow_up_required, no_response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
  [user, date, total, interested, notInterested, followUp, noResponse]);
const row = (report, who) => report.bdes.find((b) => b.employeeId === emp[who]);

before(async () => {
  const config = loadConfig();
  db = createDb(config.db);
  const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const app = createApp({
    config: { ...config, loginRateLimitMax: 1000 }, authService,
    leadService: createLeadService({ repo: createLeadRepository(db) }),
    monthlyReportService: createMonthlyReportService({ repo: createMonthlyReportRepository(db) }),
    checkDb: () => db.query('SELECT 1')
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const hash = await hashPassword(PASSWORD);
  for (const [who, role] of [['bde1', 'bde'], ['bde2', 'bde'], ['bde3', 'bde'], ['admin', 'admin']]) {
    const r = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', [emp[who], `Itest ${who}`, hash, role]);
    ids[who] = r.insertId;
    const login = await call(null, 'POST', '/auth/login', { employeeId: emp[who], password: PASSWORD });
    assert.equal(login.status, 200, 'login failed for ' + who); jars[who] = login.res.headers.get('set-cookie').split(';')[0];
  }
  statusId = (await db.query('SELECT id FROM lead_statuses WHERE is_active = 1 ORDER BY sort_order LIMIT 1'))[0].id;
  for (const k of ['A', 'B', 'C', 'D', 'E']) lead[k] = await makeLead('bde1', `Itest ${k} ${emp.bde1}`);
  lead.R = await makeLead('bde2', `Itest R ${emp.bde2}`);

  // BDE 1 (mixed month). Expected: 54 calls, 9 interested leads, see the test below.
  await addManual(ids.bde1, '2031-03-05', 30, 5, 10, 5, 10);                                 // manual-only day
  await addCall(ids.bde1, lead.A, 'no_response', '2031-03-06', '09:00:00');                  // call-log day: lead A twice (repeat call)
  await addCall(ids.bde1, lead.A, 'interested', '2031-03-06', '11:00:00');
  await addCall(ids.bde1, lead.B, 'not_interested', '2031-03-06', '12:00:00');
  await addManual(ids.bde1, '2031-03-07', 99, 99, 0, 0, 0);                                  // BOTH sources on this day: the manual 99 must be ignored
  await addCall(ids.bde1, lead.C, 'interested', '2031-03-07', '10:00:00');
  await addCall(ids.bde1, lead.D, 'interested', '2031-03-10', '10:00:00', true);             // undone call: not counted ...
  await addManual(ids.bde1, '2031-03-10', 20, 2, 8, 5, 5);                                   // ... so this day falls back to its manual report
  await addCall(ids.bde1, lead.E, 'interested', '2031-02-28', '10:00:00');                   // outside the month (before)
  await addCall(ids.bde1, lead.E, 'interested', '2031-04-01', '10:00:00');                   // outside the month (after)
  await addManual(ids.bde1, '2031-04-01', 77, 7, 7, 7, 7);                                   // outside the month (after)
  // BDE 2: manual only. BDE 3: nothing at all.
  await addManual(ids.bde2, '2031-03-31', 40, 8, 12, 10, 10);                                // last day of the month: included
  await addCall(ids.bde2, lead.R, 'interested', '2031-04-01', '00:30:00');                   // first day of next month: not included
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) {
    const userIds = Object.values(ids);
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await db.query(`DELETE FROM monthly_targets WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM call_logs WHERE user_id IN (${marks})`, userIds); // children first (foreign keys)
      await db.query(`DELETE FROM daily_reports WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM leads WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM sessions WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await db.close();
  }
});

test('team report on real MySQL: one source per BDE per day, repeat calls, undone calls and month boundaries', async () => {
  const r = await call('admin', 'GET', `/admin/reports/monthly?month=${MONTH}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const a = row(r.data.report, 'bde1').figures.calls;
  assert.equal(a.total, 30 + 3 + 1 + 20, 'manual 03-05 + call log 03-06 (3) + call log 03-07 (1; manual 99 ignored) + manual 03-10 (the only call that day was undone)');
  assert.equal(a.interested, 5 + 2 + 2, 'typed 5 + leads A and C + typed 2'); assert.equal(a.interestedCalls, 9);
  assert.equal(a.notInterested, 10 + 1 + 8); assert.equal(a.followUpRequired, 5 + 5); assert.equal(a.noResponse, 10 + 1 + 5);
  assert.equal(a.interestedCalls + a.notInterested + a.followUpRequired + a.noResponse, a.total, 'outcomes add up to the total');
  assert.equal(a.distinctLeads, 3); assert.equal(a.repeatCalls, 1); assert.equal(a.daysReported, 4);
  assert.deepEqual(a.sources, { callLogDays: 2, manualOnlyDays: 2, mixedDays: 1, callLogCalls: 4, manualCalls: 50, manualIgnoredCalls: 99 });
  assert.equal(row(r.data.report, 'bde1').calculated.interestedPercentOfCalls, 16.7, '9 / 54 = 16.67%');
  const b = row(r.data.report, 'bde2').figures.calls;
  assert.equal(b.total, 40, 'manual 03-31 is in March; the call on 04-01 is not'); assert.equal(b.sources.callLogDays, 0);
  const c = row(r.data.report, 'bde3').figures.calls; assert.equal(c.total, 0); assert.equal(row(r.data.report, 'bde3').calculated.interestedPercentOfCalls, null);
  const sumOf = (k) => r.data.report.bdes.reduce((s, x) => s + x.figures.calls[k], 0);
  assert.equal(r.data.report.total.figures.calls.total, sumOf('total')); // (other BDEs may exist in a shared dev database; the identity still holds)
  // The same data seen from the neighbouring months: each boundary day belongs to exactly one month.
  const feb = (await call('admin', 'GET', '/admin/reports/monthly?month=2031-02')).data.report; const apr = (await call('admin', 'GET', '/admin/reports/monthly?month=2031-04')).data.report;
  assert.equal(row(feb, 'bde1').figures.calls.total, 1, 'the call on 02-28 is February');
  assert.equal(row(apr, 'bde1').figures.calls.total, 1, 'April 01 has one call and a manual report of 77: the call wins'); assert.equal(row(apr, 'bde1').figures.calls.sources.manualIgnoredCalls, 77);
  assert.equal(row(apr, 'bde2').figures.calls.total, 1, 'the 04-01 call of BDE 2 is April, not March');
});

test('My Month equals the team row; targets are measured against the merged figures', async () => {
  assert.equal((await call('admin', 'PUT', '/admin/reports/targets', { month: MONTH, bdeId: String(ids.bde1), targetCalls: 108, targetInterested: 18 })).status, 200);
  const team = (await call('admin', 'GET', `/admin/reports/monthly?month=${MONTH}`)).data.report;
  const mine = (await call('bde1', 'GET', `/reports/monthly?month=${MONTH}`)).data.report;
  assert.deepEqual(mine.bdes[0], row(team, 'bde1'));
  assert.equal(mine.bdes[0].achievement.calls, 50, '54 of 108'); assert.equal(mine.bdes[0].achievement.interested, 50, '9 interested leads of 18');
  assert.equal((await call('bde2', 'GET', `/reports/monthly?month=${MONTH}`)).data.report.bdes[0].employeeId, emp.bde2, 'a BDE only ever sees their own row');
});

test('the Excel file and the PDF come from the same numbers as the screen', async () => {
  const team = (await call('admin', 'GET', `/admin/reports/monthly?month=${MONTH}`)).data.report;
  const x = await call('admin', 'GET', `/admin/reports/monthly.xlsx?month=${MONTH}`, undefined, true);
  assert.equal(x.status, 200); assert.equal(x.buffer.subarray(0, 2).toString(), 'PK', 'an .xlsx is a zip file');
  const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buffer);
  const ws = wb.getWorksheet('Monthly summary'); const headers = ws.getRow(1).values.slice(1); const colOf = (h) => headers.indexOf(h) + 1;
  for (const who of ['bde1', 'bde2', 'bde3']) {
    const rowIdx = team.bdes.findIndex((b) => b.employeeId === emp[who]) + 2; const b = row(team, who); const cell = (h) => ws.getRow(rowIdx).getCell(colOf(h)).value;
    assert.equal(cell('Calls'), b.figures.calls.total, who); assert.equal(cell('Interested'), b.figures.calls.interested, who);
    assert.equal(cell('Distinct leads called'), b.figures.calls.distinctLeads, who); assert.equal(cell('Repeat calls'), b.figures.calls.repeatCalls, who);
    assert.equal(cell('Conversion % (interested / calls, calculated)'), b.calculated.interestedPercentOfCalls, who);
    assert.equal(cell('Calls achieved % (calculated)'), b.achievement.calls, who);
  }
  const lastRow = ws.getRow(team.bdes.length + 2); assert.equal(lastRow.getCell(1).value, 'TEAM TOTAL'); assert.equal(lastRow.getCell(colOf('Calls')).value, team.total.figures.calls.total);
  const p = await call('admin', 'GET', `/admin/reports/monthly.pdf?month=${MONTH}`, undefined, true);
  assert.equal(p.status, 200); assert.equal(p.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal((await call('bde1', 'GET', `/admin/reports/monthly.xlsx?month=${MONTH}`, undefined, true)).status, 403);
});
