// Integration tests for Leads: the REAL Express app talking to a REAL MySQL database over HTTP.
// NOT part of `npm test` (which needs no database). Run with: npm run test:db
// Needs backend/.env pointing at a database where migrations 001-004 are applied.
// The test creates its own temporary users/leads (employee IDs starting "itest-") and removes them afterwards.
// Use a development database, not production.
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

const TODAY = '2026-06-15'; // fixed "browser today" so follow-up buckets are deterministic
const PASSWORD = 'itest-' + randomBytes(9).toString('hex'); // random per run, never stored anywhere

let db, server, base;
const ids = {}; // employee id -> user id
const emp = { bde1: 'itest-' + randomBytes(4).toString('hex'), bde2: 'itest-' + randomBytes(4).toString('hex'), admin: 'itest-' + randomBytes(4).toString('hex') };
const jars = {};
let statusIds = {};
let retiredStatusId;

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(base + '/api' + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data, res };
}
async function login(who) {
  const r = await call(null, 'POST', '/auth/login', { employeeId: emp[who], password: PASSWORD });
  assert.equal(r.status, 200, 'login failed for ' + who);
  jars[who] = r.res.headers.get('set-cookie').split(';')[0];
}
const lead = (over = {}) => ({
  candidateName: 'Itest Candidate', phone: '', email: '', courseOrInternship: 'Itest Course',
  leadStatusId: statusIds.New, followUpDate: '', nextAction: '', ...over
});
const usedPhones = new Set();
function uniquePhone() { // 10 digits starting with 9; unique within this run
  let p;
  do { p = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'); } while (usedPhones.has(p));
  usedPhones.add(p);
  return p;
}

before(async () => {
  const config = loadConfig();
  db = createDb(config.db);
  const cfg = { ...config, loginRateLimitMax: 1000 };
  const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const reportRepo = createDailyReportRepository(db);
  const app = createApp({
    config: cfg, authService,
    reportService: createDailyReportService({ repo: reportRepo }),
    adminService: createAdminService({ adminRepo: createAdminRepository(db), reportRepo }),
    leadService: createLeadService({ repo: createLeadRepository(db) }),
    checkDb: () => db.query('SELECT 1')
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const hash = await hashPassword(PASSWORD);
  for (const [who, role] of [['bde1', 'bde'], ['bde2', 'bde'], ['admin', 'admin']]) {
    const r = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', [emp[who], `Itest ${who}`, hash, role]);
    ids[who] = r.insertId;
  }
  const st = await db.query('SELECT id, name FROM lead_statuses WHERE is_active = 1');
  statusIds = Object.fromEntries(st.map((s) => [s.name === 'Not Interested' ? 'Closed' : s.name === 'New' ? 'New' : s.name, s.id]));
  assert.ok(statusIds.New && statusIds.Closed, 'proposed statuses (migration 004) must be present');
  const retired = await db.query("INSERT INTO lead_statuses (name, sort_order, closes_follow_up, is_active, created_at) VALUES (?, 999, 0, 0, UTC_TIMESTAMP())", ['itest-retired-' + randomBytes(3).toString('hex')]);
  retiredStatusId = retired.insertId;
  for (const who of ['bde1', 'bde2', 'admin']) await login(who);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) {
    const userIds = Object.values(ids);
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await db.query(`DELETE FROM leads WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM sessions WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    if (retiredStatusId) await db.query('DELETE FROM lead_statuses WHERE id = ?', [retiredStatusId]);
    await db.close();
  }
});

test('unauthenticated access is rejected; admin cannot write leads', async () => {
  assert.equal((await call(null, 'GET', '/leads?today=' + TODAY)).status, 401);
  assert.equal((await call(null, 'POST', '/leads', lead({ phone: '9876500001' }))).status, 401);
  assert.equal((await call('admin', 'POST', '/leads', lead({ phone: '9876500002' }))).status, 403);
  assert.equal((await call('admin', 'GET', '/leads?today=' + TODAY)).status, 403, 'admin uses /admin/leads, not the BDE route');
  assert.equal((await call('bde1', 'GET', '/admin/leads?today=' + TODAY)).status, 403);
});

test('follow-up buckets, closed-status exclusion, summary counts and filters (real SQL)', async () => {
  const make = async (name, followUpDate, statusKey = 'New') => {
    const r = await call('bde1', 'POST', '/leads', lead({ candidateName: name, phone: uniquePhone(), followUpDate, leadStatusId: statusIds[statusKey] }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.lead;
  };
  const overdue = await make('Itest Overdue', '2026-06-10');
  const dueToday = await make('Itest Today', '2026-06-15');
  const edge7 = await make('Itest Day7', '2026-06-22');     // exactly today + 7 -> upcoming
  const day8 = await make('Itest Day8', '2026-06-23');      // today + 8 -> not upcoming
  const noDate = await make('Itest NoDate', '');
  const closedOverdue = await make('Itest ClosedOverdue', '2026-06-01', 'Closed'); // closes_follow_up = 1

  const names = (r) => r.data.leads.map((l) => l.candidateName).sort();
  let r = await call('bde1', 'GET', `/leads?today=${TODAY}&followUp=overdue`);
  assert.deepEqual(names(r), ['Itest Overdue']);
  assert.equal(r.data.leads[0].followUpState, 'overdue');
  r = await call('bde1', 'GET', `/leads?today=${TODAY}&followUp=today`);
  assert.deepEqual(names(r), ['Itest Today']);
  r = await call('bde1', 'GET', `/leads?today=${TODAY}&followUp=upcoming`);
  assert.deepEqual(names(r), ['Itest Day7']);
  r = await call('bde1', 'GET', `/leads?today=${TODAY}&followUp=none`);
  assert.deepEqual(names(r), ['Itest NoDate']);

  r = await call('bde1', 'GET', `/leads/summary?today=${TODAY}`);
  assert.deepEqual(r.data.counts, { overdue: 1, today: 1, upcoming: 1 });

  r = await call('bde1', 'GET', `/leads?today=${TODAY}&followUpFrom=2026-06-10&followUpTo=2026-06-15`);
  assert.deepEqual(names(r), ['Itest Overdue', 'Itest Today']);

  r = await call('bde1', 'GET', `/leads?today=${TODAY}&statusId=${statusIds.Closed}`);
  assert.deepEqual(names(r), ['Itest ClosedOverdue']);
  assert.equal(r.data.leads[0].followUpState, null, 'closed status is not shown as overdue');

  // Sort order: soonest follow-up first, leads without a date last.
  r = await call('bde1', 'GET', `/leads?today=${TODAY}`);
  assert.equal(r.data.total, 6);
  assert.equal(r.data.leads[0].candidateName, 'Itest ClosedOverdue');
  assert.equal(r.data.leads.at(-1).candidateName, 'Itest NoDate');

  // Pagination
  r = await call('bde1', 'GET', `/leads?today=${TODAY}&pageSize=2&page=3`);
  assert.equal(r.data.leads.length, 2);
  assert.equal(r.data.total, 6);

  // Invalid filters are rejected, not ignored.
  assert.equal((await call('bde1', 'GET', `/leads?followUp=overdue`)).status, 400);
  assert.equal((await call('bde1', 'GET', `/leads?today=${TODAY}&followUp=bogus`)).status, 400);
  assert.equal((await call('bde1', 'GET', `/leads?today=${TODAY}&followUpFrom=2026-07-01&followUpTo=2026-06-01`)).status, 400);
  assert.equal((await call('bde1', 'GET', `/leads?today=${TODAY}&pageSize=1000`)).status, 400);
  assert.equal((await call('bde1', 'GET', `/leads?today=${TODAY}&statusId=1&statusId=2`)).status, 400);
  void overdue; void dueToday; void edge7; void day8; void noDate; void closedOverdue;
});

test('search: name, formatted phone, email, wildcard characters and SQL-looking text are treated as plain text', async () => {
  const phone = '+91 98765 ' + String(40000 + Math.floor(Math.random() * 9999));
  const mark = 'zq' + randomBytes(3).toString('hex');
  let r = await call('bde1', 'POST', '/leads', lead({ candidateName: `Searchable ${mark}`, phone, email: `${mark}@Example.com`, courseOrInternship: 'Data 100% Science_A' }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const found = async (q) => (await call('bde1', 'GET', `/leads?today=${TODAY}&q=${encodeURIComponent(q)}`)).data;
  assert.equal((await found(mark)).total, 1);
  assert.equal((await found(phone.slice(0, 9))).total, 1);
  assert.equal((await found(`${mark}@example.com`)).total, 1, 'email search is case-insensitive');
  assert.equal((await found('100%')).total, 1);
  assert.equal((await found('100_')).total, 0, '_ is literal, not "any character"');
  assert.equal((await found("' OR 1=1 --")).total, 0);
  assert.equal((await found('x'.repeat(101))).error?.code, 'VALIDATION_ERROR');
});

test('ownership: another BDE cannot read, edit, list or widen scope; admin sees everything with the responsible BDE', async () => {
  const created = await call('bde1', 'POST', '/leads', lead({ candidateName: 'Itest Private', phone: uniquePhone() }));
  assert.equal(created.status, 201);
  const leadId = created.data.lead.id;
  assert.equal(created.data.lead.bde, undefined, 'BDE responses do not carry the admin-only bde block');

  assert.equal((await call('bde2', 'GET', `/leads/${leadId}`)).status, 404);
  const edit = await call('bde2', 'PUT', `/leads/${leadId}`, lead({ candidateName: 'Hijacked', phone: uniquePhone() }));
  assert.equal(edit.status, 404);
  const rows = await db.query('SELECT candidate_name, user_id FROM leads WHERE id = ?', [leadId]);
  assert.equal(rows[0].candidate_name, 'Itest Private', 'database row untouched');
  assert.equal(Number(rows[0].user_id), ids.bde1);

  let r = await call('bde2', 'GET', `/leads?today=${TODAY}&bdeId=${ids.bde1}`);
  assert.equal(r.data.total, 0, 'bdeId cannot widen a BDE scope');

  // Owner/user fields in the body are ignored.
  const forged = await call('bde2', 'POST', '/leads', lead({ candidateName: 'Itest Forged', phone: uniquePhone(), userId: ids.bde1, user_id: ids.bde1 }));
  assert.equal(forged.status, 201);
  const forgedRow = await db.query('SELECT user_id FROM leads WHERE id = ?', [forged.data.lead.id]);
  assert.equal(Number(forgedRow[0].user_id), ids.bde2);

  r = await call('admin', 'GET', `/admin/leads?today=${TODAY}&q=Itest%20Private`);
  assert.equal(r.status, 200);
  assert.equal(r.data.leads.length, 1);
  assert.equal(r.data.leads[0].bde.employeeId, emp.bde1);
  r = await call('admin', 'GET', `/admin/leads?today=${TODAY}&bdeId=${ids.bde2}`);
  assert.ok(r.data.leads.length >= 1 && r.data.leads.every((l) => l.bde.employeeId === emp.bde2));
  assert.equal((await call('admin', 'GET', `/admin/leads/${leadId}`)).data.lead.bde.name, 'Itest bde1');
  assert.equal((await call('admin', 'PUT', `/admin/leads/${leadId}`, lead())).status, 404, 'no admin write route');
});

test('duplicates: detected by phone/email across BDEs, never silently merged, details limited to own leads', async () => {
  const phone = uniquePhone();
  const mark = 'dup' + randomBytes(3).toString('hex');
  const first = await call('bde1', 'POST', '/leads', lead({ candidateName: 'Itest Dup One ' + mark, phone, email: `${mark}@Example.com` }));
  assert.equal(first.status, 201);

  // Same phone in a different format -> warning with own details.
  let r = await call('bde1', 'POST', '/leads', lead({ candidateName: 'Itest Dup Two', phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` }));
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'POSSIBLE_DUPLICATE');
  assert.equal(r.data.error.details.own.length, 1);
  assert.equal(r.data.error.details.own[0].id, first.data.lead.id);

  // Same email, different letter case.
  r = await call('bde1', 'POST', '/leads', lead({ candidateName: 'Itest Dup Three', email: `${mark.toUpperCase()}@EXAMPLE.COM` }));
  assert.equal(r.status, 409);

  // Another BDE: only a count, no names or contact details of the first BDE's lead.
  r = await call('bde2', 'POST', '/leads', lead({ candidateName: 'Itest Dup Other', phone }));
  assert.equal(r.status, 409);
  assert.equal(r.data.error.details.own.length, 0);
  assert.ok(r.data.error.details.otherBdeMatches >= 1);
  assert.ok(!JSON.stringify(r.data).includes(mark));

  // Explicit confirmation creates a separate record; the original is unchanged.
  r = await call('bde1', 'POST', '/leads', lead({ candidateName: 'Itest Dup Confirmed', phone, confirmDuplicate: true }));
  assert.equal(r.status, 201);
  assert.notEqual(r.data.lead.id, first.data.lead.id);
  const rows = await db.query('SELECT COUNT(*) AS n FROM leads WHERE user_id = ? AND phone_key = ?', [ids.bde1, phone.slice(-10)]);
  assert.equal(Number(rows[0].n), 2, 'two separate rows, nothing merged');
  assert.equal((await call('bde1', 'GET', `/leads/${first.data.lead.id}`)).data.lead.candidateName, 'Itest Dup One ' + mark);

  // Editing: unchanged contact details do not trigger a warning; changing to an existing phone does.
  const other = await call('bde1', 'POST', '/leads', lead({ candidateName: 'Itest Edit Me', phone: uniquePhone() }));
  const id = other.data.lead.id;
  r = await call('bde1', 'PUT', `/leads/${id}`, lead({ candidateName: 'Itest Edit Me 2', phone: other.data.lead.phone, nextAction: 'Call back' }));
  assert.equal(r.status, 200);
  assert.equal(r.data.lead.nextAction, 'Call back');
  r = await call('bde1', 'PUT', `/leads/${id}`, lead({ candidateName: 'Itest Edit Me 2', phone }));
  assert.equal(r.status, 409);
  r = await call('bde1', 'PUT', `/leads/${id}`, lead({ candidateName: 'Itest Edit Me 2', phone, confirmDuplicate: true }));
  assert.equal(r.status, 200);
});

test('validation and status rules enforced by the server against the database', async () => {
  const bad = async (over) => (await call('bde1', 'POST', '/leads', lead({ phone: uniquePhone(), ...over })));
  assert.equal((await bad({ candidateName: '  ' })).status, 400);
  assert.equal((await bad({ phone: '', email: '' })).status, 400, 'at least one contact detail');
  assert.equal((await bad({ phone: 'abc' })).status, 400);
  assert.equal((await bad({ email: 'not-an-email', phone: '' })).status, 400);
  assert.equal((await bad({ courseOrInternship: '' })).status, 400);
  assert.equal((await bad({ followUpDate: '2026-02-30' })).status, 400);
  assert.equal((await bad({ leadStatusId: 999999 })).status, 400, 'unknown status');
  const r = await bad({ leadStatusId: retiredStatusId });
  assert.equal(r.status, 400, 'retired (inactive) status cannot be chosen for new leads');
  assert.ok(r.data.error.fields.leadStatusId);
  assert.equal((await call('bde1', 'GET', '/leads/abc')).status, 400);
  assert.equal((await call('bde1', 'GET', '/leads/999999999')).status, 404);

  // A lead that already uses a status keeps working after the status is retired.
  const ok = await call('bde1', 'POST', '/leads', lead({ candidateName: 'Itest Retire', phone: uniquePhone() }));
  const phone = ok.data.lead.phone;
  await db.query('UPDATE leads SET lead_status_id = ? WHERE id = ?', [retiredStatusId, ok.data.lead.id]);
  const upd = await call('bde1', 'PUT', `/leads/${ok.data.lead.id}`, lead({ candidateName: 'Itest Retire', phone, leadStatusId: retiredStatusId, nextAction: 'still editable' }));
  assert.equal(upd.status, 200);
  const moved = await call('bde1', 'PUT', `/leads/${ok.data.lead.id}`, lead({ candidateName: 'Itest Retire', phone, leadStatusId: statusIds.New }));
  assert.equal(moved.status, 200, 'can move away from a retired status');
});
