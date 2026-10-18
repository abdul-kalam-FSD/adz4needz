// Integration tests for Interviews: the REAL Express app talking to a REAL MySQL database over HTTP.
// NOT part of `npm test` (which needs no database). Run with: npm run test:db
// Needs backend/.env pointing at a database where migrations 001-006 are applied.
// The test creates its own temporary users, leads and interviews (employee IDs starting "itest-") and removes them
// afterwards. Use a development database, not production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
import { createInterviewRepository } from '../src/modules/interviews/interviews.repository.js';
import { createInterviewService } from '../src/modules/interviews/interviews.service.js';

const TODAY = '2026-06-15'; // fixed "browser today" so date buckets are deterministic
const PASSWORD = 'itest-' + randomBytes(9).toString('hex'); // random per run, never stored anywhere
const tag = randomBytes(3).toString('hex');

let db, server, base, statusId;
const ids = {};
const emp = Object.fromEntries(['bde1', 'bde2', 'bde3', 'admin'].map((k) => [k, 'itest-' + randomBytes(4).toString('hex')]));
const jars = {};

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(base + '/api' + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data, res };
}
const usedPhones = new Set();
function uniquePhone() {
  let p;
  do { p = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'); } while (usedPhones.has(p));
  usedPhones.add(p);
  return p;
}
async function makeLead(who, name, course = 'Itest Course') {
  const r = await call(who, 'POST', '/leads', { candidateName: name, phone: uniquePhone(), courseOrInternship: course, leadStatusId: statusId });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.lead.id;
}
const iv = (leadId, over = {}) => ({ leadId, scheduledAt: '2026-06-20T10:00', attendance: 'pending', outcome: 'pending', interestedInJoining: null, ...over });
async function makeInterview(who, leadId, over) {
  const r = await call(who, 'POST', '/interviews', iv(leadId, over));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.interview;
}
// MySQL reports a rejected foreign-key insert as errno 1216 (parent row missing) or 1452 (constraint failed), depending on the case.
const isForeignKeyError = (e) => e.errno === 1216 || e.errno === 1452;
// Phase 6: "payment confirmed" is derived from payment records. A payment record is created directly in the database here.
const addPaymentRecord = (leadId, userId) => db.query("INSERT INTO payments (lead_id, user_id, course_or_internship, amount_committed, commitment_date, created_at, updated_at) VALUES (?, ?, 'Itest', 1000.00, '2026-06-01', UTC_TIMESTAMP(), UTC_TIMESTAMP())", [leadId, userId]);
const dbRow = async (id) => (await db.query('SELECT * FROM interviews WHERE id = ?', [id]))[0];

before(async () => {
  const config = loadConfig();
  db = createDb(config.db);
  const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const reportRepo = createDailyReportRepository(db);
  const app = createApp({
    config: { ...config, loginRateLimitMax: 1000 }, authService,
    reportService: createDailyReportService({ repo: reportRepo }),
    adminService: createAdminService({ adminRepo: createAdminRepository(db), reportRepo }),
    leadService: createLeadService({ repo: createLeadRepository(db) }),
    interviewService: createInterviewService({ repo: createInterviewRepository(db) }),
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
  statusId = (await db.query('SELECT id FROM lead_statuses WHERE is_active = 1 ORDER BY sort_order LIMIT 1'))[0].id;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) {
    const userIds = Object.values(ids);
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await db.query(`DELETE FROM payment_receipts WHERE user_id IN (${marks})`, userIds); // children first (foreign keys)
      await db.query(`DELETE FROM payment_instalments WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM payments WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM interviews WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM leads WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM sessions WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await db.close();
  }
});

test('unauthenticated access is rejected; admin cannot write; BDE cannot use admin routes', async () => {
  for (const [m, p] of [['GET', '/interviews'], ['GET', '/interviews/1'], ['POST', '/interviews'], ['PUT', '/interviews/1'], ['GET', '/interviews/summary?today=' + TODAY],
    ['GET', '/admin/interviews'], ['GET', '/admin/interviews/overview'], ['GET', '/admin/interviews/1']]) {
    assert.equal((await call(null, m, p, {})).status, 401, `${m} ${p}`);
  }
  const leadId = await makeLead('bde1', 'Itest Authz ' + tag);
  const mine = await makeInterview('bde1', leadId);
  assert.equal((await call('admin', 'POST', '/interviews', iv(leadId))).status, 403);
  assert.equal((await call('admin', 'PUT', `/interviews/${mine.id}`, iv(leadId))).status, 403);
  assert.equal((await call('admin', 'GET', '/interviews')).status, 403, 'admin uses /admin/interviews');
  assert.equal((await call('admin', 'POST', '/admin/interviews', iv(leadId))).status, 404, 'no admin write route');
  assert.equal((await call('admin', 'PUT', `/admin/interviews/${mine.id}`, iv(leadId))).status, 404, 'no admin write route');
  assert.equal((await call('bde1', 'GET', '/admin/interviews')).status, 403);
  assert.equal((await call('bde1', 'GET', '/admin/interviews/overview')).status, 403);
  assert.equal((await call('bde1', 'GET', `/admin/interviews/${mine.id}`)).status, 403);
});

test('create and update persist in MySQL exactly as entered (wall-clock time, flags, lead link, owner)', async () => {
  const leadId = await makeLead('bde1', 'Itest Persist ' + tag);
  const r = await call('bde1', 'POST', '/interviews', iv(leadId, { scheduledAt: '2026-06-20T23:59', userId: ids.bde2, user_id: ids.bde2 }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const created = r.data.interview;
  assert.equal(created.scheduledAt, '2026-06-20T23:59');
  assert.equal(created.lead.id, leadId); assert.equal(created.lead.candidateName, 'Itest Persist ' + tag);
  assert.equal(created.bde, undefined, 'BDE responses carry no admin-only bde block');
  assert.ok(!/user_id|password|hash/i.test(JSON.stringify(r.data)));

  let row = await dbRow(created.id);
  assert.equal(row.scheduled_at, '2026-06-20 23:59:00', 'stored as entered, no timezone shift');
  assert.equal(String(row.lead_id), String(leadId));
  assert.equal(Number(row.user_id), ids.bde1, 'owner from the session; forged body ignored');
  assert.equal(row.attendance, 'pending'); assert.equal(row.outcome, 'pending');
  assert.equal(row.interested_in_joining, null); assert.equal(Number(row.payment_confirmed), 0, 'legacy column is never written');
  assert.equal(created.paymentConfirmed, false, 'no payment record yet');

  const up = await call('bde1', 'PUT', `/interviews/${created.id}`, iv(leadId, { leadId: 99999999, scheduledAt: '2026-06-21T09:05', attendance: 'attended', outcome: 'selected', interestedInJoining: true, paymentConfirmed: true }));
  assert.equal(up.status, 200, JSON.stringify(up.data));
  row = await dbRow(created.id);
  assert.equal(row.scheduled_at, '2026-06-21 09:05:00'); assert.equal(row.attendance, 'attended'); assert.equal(row.outcome, 'selected');
  assert.equal(Number(row.interested_in_joining), 1);
  assert.equal(Number(row.payment_confirmed), 0, 'a paymentConfirmed value in the body is ignored: the legacy column stays 0');
  assert.equal(up.data.interview.paymentConfirmed, false, 'still false: derived from payment records, and there are none');
  await addPaymentRecord(leadId, ids.bde1);
  assert.equal((await call('bde1', 'GET', `/interviews/${created.id}`)).data.interview.paymentConfirmed, true, 'follows the payment record');
  assert.equal(String(row.lead_id), String(leadId), 'leadId in an update body is ignored');

  const back = await call('bde1', 'PUT', `/interviews/${created.id}`, iv(leadId, { attendance: 'did_not_attend', interestedInJoining: false }));
  assert.equal(back.status, 200);
  row = await dbRow(created.id);
  assert.equal(Number(row.interested_in_joining), 0, 'false is stored as 0, not NULL');
  const got = await call('bde1', 'GET', `/interviews/${created.id}`);
  assert.equal(got.data.interview.attendance, 'did_not_attend'); assert.equal(got.data.interview.interestedInJoining, false);
});

test('lead id handling: missing, malformed and other BDE\'s lead are safe and create nothing', async () => {
  const othersLead = await makeLead('bde2', 'Itest Other ' + tag);
  const before = Number((await db.query('SELECT COUNT(*) n FROM interviews WHERE user_id = ?', [ids.bde1]))[0].n);
  const missing = await call('bde1', 'POST', '/interviews', iv(987654321));
  const foreign = await call('bde1', 'POST', '/interviews', iv(othersLead));
  assert.equal(missing.status, 404); assert.equal(foreign.status, 404);
  assert.deepEqual(missing.data, foreign.data, 'identical answers: lead ids cannot be probed');
  for (const bad of ['abc', '0', -5, '1; DROP TABLE leads', null, undefined, '']) {
    const r = await call('bde1', 'POST', '/interviews', iv(bad));
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(r.data.error.fields.leadId);
  }
  const after = Number((await db.query('SELECT COUNT(*) n FROM interviews WHERE user_id = ?', [ids.bde1]))[0].n);
  assert.equal(after, before, 'nothing inserted');
  assert.equal((await db.query('SELECT COUNT(*) n FROM leads'))[0].n > 0, true, 'leads table intact');
});

test('ownership: changing the interview id in the URL never reaches another BDE\'s record', async () => {
  const leadId = await makeLead('bde1', 'Itest Private ' + tag);
  const mine = await makeInterview('bde1', leadId, { interestedInJoining: true });
  assert.equal((await call('bde2', 'GET', `/interviews/${mine.id}`)).status, 404);
  const hijack = await call('bde2', 'PUT', `/interviews/${mine.id}`, iv(leadId, { attendance: 'attended', outcome: 'selected', paymentConfirmed: true }));
  assert.equal(hijack.status, 404);
  const row = await dbRow(mine.id);
  assert.equal(row.attendance, 'pending'); assert.equal(Number(row.payment_confirmed), 0); assert.equal(Number(row.user_id), ids.bde1, 'row untouched');
  assert.equal((await call('bde2', 'GET', `/interviews/${mine.id}`)).data.error.code, 'NOT_FOUND');
  assert.deepEqual((await call('bde2', 'GET', '/interviews/987654321')).data, (await call('bde2', 'GET', `/interviews/${mine.id}`)).data, 'same answer as a non-existent id');

  let r = await call('bde2', 'GET', `/interviews?today=${TODAY}&bdeId=${ids.bde1}&leadId=${leadId}`);
  assert.equal(r.status, 200); assert.equal(r.data.total, 0, 'bdeId / leadId cannot widen a BDE scope');
  r = await call('bde2', 'GET', `/interviews?q=${encodeURIComponent('Itest Private ' + tag)}`);
  assert.equal(r.data.total, 0);

  // Booking an interview on someone else's lead, with the owner forged in the body, is refused too.
  const forged = await call('bde2', 'POST', '/interviews', iv(leadId, { userId: ids.bde1, user_id: ids.bde1 }));
  assert.equal(forged.status, 404);
});

test('the DATABASE itself refuses an interview whose BDE is not the lead\'s owner (composite foreign key)', async () => {
  const leadId = await makeLead('bde1', 'Itest FK ' + tag);
  await assert.rejects(
    db.query(`INSERT INTO interviews (lead_id, user_id, scheduled_at, created_at, updated_at) VALUES (?, ?, '2026-06-20 10:00:00', UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [leadId, ids.bde2]),
    isForeignKeyError
  );
  await assert.rejects(
    db.query(`INSERT INTO interviews (lead_id, user_id, scheduled_at, created_at, updated_at) VALUES (?, ?, '2026-06-20 10:00:00', UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [987654321, ids.bde1]),
    isForeignKeyError
  );
  await assert.rejects(db.query(`INSERT INTO interviews (lead_id, user_id, scheduled_at, attendance, created_at, updated_at) VALUES (?, ?, '2026-06-20 10:00:00', 'bogus', UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [leadId, ids.bde1]));
  await db.query(`INSERT INTO interviews (lead_id, user_id, scheduled_at, created_at, updated_at) VALUES (?, ?, '2026-06-20 10:00:00', UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [leadId, ids.bde1]); // the valid pairing works
});

test('validation: the server rejects bad input and changes nothing', async () => {
  const leadId = await makeLead('bde1', 'Itest Validate ' + tag);
  const bad = async (over) => call('bde1', 'POST', '/interviews', iv(leadId, over));
  for (const over of [{ scheduledAt: '' }, { scheduledAt: '2026-02-30T10:00' }, { scheduledAt: '2026-06-15' }, { scheduledAt: '2026-06-15T25:00' },
    { attendance: 'maybe' }, { outcome: 'won' }, { attendance: 'pending', outcome: 'selected' }, { attendance: 'did_not_attend', outcome: 'not_selected' },
    { interestedInJoining: 'yes' }]) {
    const r = await bad(over);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.data.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(Number((await db.query('SELECT COUNT(*) n FROM interviews WHERE lead_id = ?', [leadId]))[0].n), 0);

  const good = await makeInterview('bde1', leadId);
  const partial = await call('bde1', 'PUT', `/interviews/${good.id}`, { scheduledAt: '2026-06-22T10:00' });
  assert.equal(partial.status, 400, 'an update must send every field (no silent resets)');
  const wrong = await call('bde1', 'PUT', `/interviews/${good.id}`, iv(leadId, { attendance: 'pending', outcome: 'selected' }));
  assert.equal(wrong.status, 400);
  const row = await dbRow(good.id);
  assert.equal(row.scheduled_at, '2026-06-20 10:00:00'); assert.equal(row.outcome, 'pending');
  assert.equal((await call('bde1', 'GET', '/interviews/abc')).status, 400);
  assert.equal((await call('bde1', 'GET', '/interviews/987654321')).status, 404);
  assert.equal((await call('bde1', 'PUT', '/interviews/abc', iv(leadId))).status, 400);
  assert.equal((await call('bde1', 'PUT', '/interviews/987654321', iv(leadId))).status, 404);
});

test('filters, indicators, summary and ordering (real SQL, day boundaries)', async () => {
  const make = async (name, scheduledAt, over = {}, course = 'Itest Course') => {
    const { paymentConfirmed, ...rest } = over; // not an API field any more: it becomes a payment record
    const leadId = await makeLead('bde3', name, course);
    if (paymentConfirmed) await addPaymentRecord(leadId, ids.bde3);
    return makeInterview('bde3', leadId, { scheduledAt, ...rest });
  };
  await make('F Past Pending', '2026-06-10T10:00');                                                       // needs_update
  await make('F Past Attended', '2026-06-11T10:00', { attendance: 'attended', outcome: 'selected', interestedInJoining: true, paymentConfirmed: true });
  await make('F Past Absent', '2026-06-12T10:00', { attendance: 'did_not_attend', interestedInJoining: false });
  await make('F Yesterday Late', '2026-06-14T23:59');                                                      // needs_update (boundary)
  await make('F Today Early', '2026-06-15T00:00');                                                         // today (boundary)
  await make('F Today Late', '2026-06-15T23:59', {}, 'Itest Special Course');                              // today (boundary)
  await make('F Tomorrow', '2026-06-16T00:00');                                                            // upcoming (boundary)
  await make('F Far Future', '2026-08-01T09:30', { attendance: 'attended', outcome: 'not_selected' });

  const names = (r) => r.data.interviews.map((i) => i.lead.candidateName);
  const sorted = (r) => names(r).sort();
  let r = await call('bde3', 'GET', `/interviews?today=${TODAY}&when=needs_update`);
  assert.deepEqual(sorted(r), ['F Past Pending', 'F Yesterday Late']);
  assert.ok(r.data.interviews.every((i) => i.state === 'needs_update'));
  r = await call('bde3', 'GET', `/interviews?today=${TODAY}&when=today`);
  assert.deepEqual(sorted(r), ['F Today Early', 'F Today Late']);
  r = await call('bde3', 'GET', `/interviews?today=${TODAY}&when=upcoming`);
  assert.deepEqual(sorted(r), ['F Far Future', 'F Tomorrow']);
  assert.equal((await call('bde3', 'GET', `/interviews/summary?today=${TODAY}`)).data.counts.needsUpdate, 2);
  assert.deepEqual((await call('bde3', 'GET', `/interviews/summary?today=${TODAY}`)).data.counts, { today: 2, upcoming: 2, needsUpdate: 2 });

  r = await call('bde3', 'GET', `/interviews?today=${TODAY}`);
  assert.equal(r.data.total, 8);
  assert.equal(r.data.interviews[0].lead.candidateName, 'F Far Future', 'newest scheduled first');
  assert.equal(r.data.interviews.at(-1).lead.candidateName, 'F Past Pending');
  assert.equal(r.data.interviews.find((i) => i.lead.candidateName === 'F Past Attended').state, null, 'finished interviews carry no indicator');

  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?attendance=attended')), ['F Far Future', 'F Past Attended']);
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?attendance=did_not_attend')), ['F Past Absent']);
  assert.equal((await call('bde3', 'GET', '/interviews?attendance=pending')).data.total, 5);
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?outcome=selected')), ['F Past Attended']);
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?outcome=not_selected')), ['F Far Future']);
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?interested=yes')), ['F Past Attended']);
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?interested=no')), ['F Past Absent']);
  assert.equal((await call('bde3', 'GET', '/interviews?interested=unknown')).data.total, 6);
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?paymentConfirmed=yes')), ['F Past Attended']);
  assert.equal((await call('bde3', 'GET', '/interviews?paymentConfirmed=no')).data.total, 7);

  r = await call('bde3', 'GET', '/interviews?scheduledFrom=2026-06-14&scheduledTo=2026-06-15');
  assert.deepEqual(sorted(r), ['F Today Early', 'F Today Late', 'F Yesterday Late'], 'end date is inclusive of the whole day');
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?q=Special')), ['F Today Late'], 'search matches the lead\'s course');
  assert.deepEqual(sorted(await call('bde3', 'GET', '/interviews?q=F%20Tomorrow')), ['F Tomorrow']);
  assert.equal((await call('bde3', 'GET', `/interviews?q=${encodeURIComponent("' OR 1=1 --")}`)).data.total, 0);
  assert.equal((await call('bde3', 'GET', '/interviews?q=%25')).data.total, 0, '% is literal');
  r = await call('bde3', 'GET', '/interviews?pageSize=3&page=3');
  assert.equal(r.data.interviews.length, 2); assert.equal(r.data.total, 8);

  for (const q of ['when=today', 'when=soon&today=' + TODAY, 'attendance=present', 'outcome=won', 'interested=maybe', 'paymentConfirmed=partial', 'scheduledFrom=2026-07-01&scheduledTo=2026-06-01', 'pageSize=1000', 'attendance=attended&attendance=pending', 'leadId=abc']) {
    assert.equal((await call('bde3', 'GET', '/interviews?' + q)).status, 400, q);
  }
});

test('admin: team-wide read-only view with the responsible BDE, filters, detail and per-BDE overview', async () => {
  const L = await makeLead('bde1', 'Itest AdminView ' + tag);
  const mine = await makeInterview('bde1', L, { scheduledAt: '2026-06-18T11:00' });

  let r = await call('admin', 'GET', `/admin/interviews?today=${TODAY}&q=${encodeURIComponent('Itest AdminView ' + tag)}`);
  assert.equal(r.status, 200); assert.equal(r.data.total, 1);
  assert.equal(r.data.interviews[0].bde.employeeId, emp.bde1); assert.equal(r.data.interviews[0].bde.name, 'Itest bde1');
  assert.equal(r.data.interviews[0].state, 'upcoming');

  r = await call('admin', 'GET', `/admin/interviews?bdeId=${ids.bde3}`);
  assert.equal(r.data.total, 8); assert.ok(r.data.interviews.every((i) => i.bde.employeeId === emp.bde3));
  assert.equal((await call('admin', 'GET', '/admin/interviews?bdeId=987654321')).data.total, 0);
  assert.equal((await call('admin', 'GET', '/admin/interviews?bdeId=abc')).status, 400);
  r = await call('admin', 'GET', `/admin/interviews/${mine.id}`);
  assert.equal(r.data.interview.bde.employeeId, emp.bde1);
  assert.equal((await call('admin', 'GET', '/admin/interviews/987654321')).status, 404);
  assert.equal((await call('admin', 'GET', '/admin/interviews/abc')).status, 400);
  const sum = await call('admin', 'GET', `/admin/interviews/summary?today=${TODAY}`);
  assert.equal(sum.status, 200); assert.ok(sum.data.counts.needsUpdate >= 2);

  // Overview: exact numbers for the BDEs created by this test (other rows may exist in a shared dev database).
  const o = await call('admin', 'GET', '/admin/interviews/overview');
  assert.equal(o.status, 200);
  const row = (e) => o.data.bdes.find((b) => b.employeeId === e);
  assert.deepEqual({ ...row(emp.bde3), id: undefined, name: undefined, employeeId: undefined, isActive: undefined },
    { id: undefined, name: undefined, employeeId: undefined, isActive: undefined, scheduled: 8, attended: 2, didNotAttend: 1, attendancePending: 5, selected: 1, notSelected: 1, interestedInJoining: 1, paymentConfirmed: 1 });
  assert.equal(row(emp.bde1).scheduled >= 1, true);
  const zero = row(emp.bde2);
  assert.ok(zero, 'a BDE with no interviews still appears');
  assert.equal(zero.scheduled, 0); assert.equal(typeof zero.scheduled, 'number');
  const sumOf = (k) => o.data.bdes.reduce((a, b) => a + b[k], 0);
  for (const k of Object.keys(o.data.totals)) assert.equal(o.data.totals[k], sumOf(k), `total ${k}`);

  // Overview with a date range (inclusive end date)
  const ranged = await call('admin', 'GET', '/admin/interviews/overview?scheduledFrom=2026-06-14&scheduledTo=2026-06-15');
  const rr = ranged.data.bdes.find((b) => b.employeeId === emp.bde3);
  assert.equal(rr.scheduled, 3); assert.equal(rr.attendancePending, 3);
  assert.equal((await call('admin', 'GET', '/admin/interviews/overview?scheduledFrom=2026-07-01&scheduledTo=2026-06-01')).status, 400);
  assert.equal((await call('admin', 'GET', '/admin/interviews/overview?scheduledFrom=nope')).status, 400);
});
