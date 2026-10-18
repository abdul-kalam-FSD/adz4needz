// Integration tests for the Profile module: the REAL Express app talking to a REAL MySQL database over HTTP.
// NOT part of `npm test`. Run with: npm run test:db
// Needs backend/.env pointing at a DEVELOPMENT database where ALL 12 migration files are applied: 001-010 plus the two Module 1 files
// (007_users_phone.sql and 008_users_email.sql add users.phone / users.email: without them every profile call fails). See docs/migration-map.md.
// The test creates its own temporary users (employee IDs starting "itest-") and removes them and their sessions afterwards.
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
import { createUserRepository } from '../src/modules/users/users.repository.js';
import { createUserService } from '../src/modules/users/users.service.js';

const rand = () => randomBytes(9).toString('hex');
const PASSWORD = 'itest-' + rand();
const NEW_PASSWORD = 'itest-new-' + rand();

let db, server, base, limited, limitedBase, config;
const ids = {};
const emp = { bde1: 'itest-' + randomBytes(4).toString('hex'), bde2: 'itest-' + randomBytes(4).toString('hex'), admin: 'itest-' + randomBytes(4).toString('hex') };
const jars = {};

function buildApp(cfg) {
  const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const reportRepo = createDailyReportRepository(db);
  return createApp({
    config: cfg, authService,
    reportService: createDailyReportService({ repo: reportRepo }),
    adminService: createAdminService({ adminRepo: createAdminRepository(db), reportRepo }),
    leadService: createLeadService({ repo: createLeadRepository(db) }),
    interviewService: createInterviewService({ repo: createInterviewRepository(db) }),
    userService: createUserService({ repo: createUserRepository(db) }),
    checkDb: () => db.query('SELECT 1')
  });
}
async function call(who, method, path, body, baseUrl = base, jar) {
  const headers = { 'Content-Type': 'application/json' };
  const cookie = jar ?? (who && jars[who]);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + '/api' + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data, res };
}
async function loginRaw(employeeId, password, baseUrl = base) {
  const r = await call(null, 'POST', '/auth/login', { employeeId, password }, baseUrl);
  return { ...r, cookie: r.status === 200 ? r.res.headers.get('set-cookie').split(';')[0] : null };
}
async function login(who) {
  const r = await loginRaw(emp[who], PASSWORD);
  assert.equal(r.status, 200, 'login failed for ' + who);
  jars[who] = r.cookie;
}
const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });

before(async () => {
  config = loadConfig();
  db = createDb(config.db);
  server = await listen(buildApp({ ...config, loginRateLimitMax: 1000 }));
  base = `http://127.0.0.1:${server.address().port}`;
  limited = await listen(buildApp({ ...config, loginRateLimitMax: 3 }));
  limitedBase = `http://127.0.0.1:${limited.address().port}`;
  const hash = await hashPassword(PASSWORD);
  for (const [who, role] of [['bde1', 'bde'], ['bde2', 'bde'], ['admin', 'admin']]) {
    const r = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', [emp[who], `Itest ${who}`, hash, role]);
    ids[who] = r.insertId;
  }
  for (const who of ['bde1', 'bde2', 'admin']) await login(who);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (limited) await new Promise((r) => limited.close(r));
  if (db) {
    const userIds = Object.values(ids);
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await db.query(`DELETE FROM sessions WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await db.close();
  }
});

test('migrations 007_users_phone / 008_users_email are applied: users.phone and users.email are nullable VARCHAR(20) / VARCHAR(254)', async () => {
  const cols = await db.query("SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('phone', 'email')");
  const by = Object.fromEntries(cols.map((c) => [c.name, c]));
  assert.ok(by.phone && by.email, 'run npm run migrate first (007_users_phone.sql and 008_users_email.sql)');
  assert.equal(by.phone.nullable, 'YES'); assert.equal(Number(by.phone.len), 20);
  assert.equal(by.email.nullable, 'YES'); assert.equal(Number(by.email.len), 254);
});

test('authentication is required for every profile route', async () => {
  assert.equal((await call(null, 'GET', '/profile')).status, 401);
  assert.equal((await call(null, 'PATCH', '/profile', { phone: '9876543210' })).status, 401);
  assert.equal((await call(null, 'POST', '/profile/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status, 401);
});

test('GET /profile: own record only, both roles, no hash or token in the response', async () => {
  for (const who of ['bde1', 'admin']) {
    const r = await call(who, 'GET', '/profile');
    assert.equal(r.status, 200);
    assert.equal(r.data.profile.id, ids[who]);
    assert.equal(r.data.profile.employeeId, emp[who]);
    assert.deepEqual(Object.keys(r.data.profile).sort(), ['createdAt', 'email', 'employeeId', 'id', 'name', 'phone', 'role']);
    assert.ok(!/password|hash|token/i.test(JSON.stringify(r.data)));
  }
  assert.equal((await call('bde1', 'GET', '/profile/' + ids.bde2)).status, 404, 'there is no profile-by-id route');
});

test('PATCH /profile: saves phone and email, persists, partial update, clearing', async () => {
  let r = await call('bde1', 'PATCH', '/profile', { phone: ' +91 98765 43210 ', email: 'itest1@example.com' });
  assert.equal(r.status, 200); assert.equal(r.data.profile.phone, '+91 98765 43210'); assert.equal(r.data.profile.email, 'itest1@example.com');
  const row = (await db.query('SELECT phone, email FROM users WHERE id = ?', [ids.bde1]))[0];
  assert.deepEqual(row, { phone: '+91 98765 43210', email: 'itest1@example.com' });
  r = await call('bde1', 'PATCH', '/profile', { phone: '9000011111' });
  assert.equal(r.data.profile.phone, '9000011111'); assert.equal(r.data.profile.email, 'itest1@example.com', 'email unchanged when not sent');
  r = await call('bde1', 'PATCH', '/profile', { email: null });
  assert.equal(r.data.profile.email, null);
  assert.equal((await call('bde2', 'GET', '/profile')).data.profile.phone, null, "another user's profile is untouched");
});

test('PATCH /profile: invalid values and out-of-scope fields are rejected and nothing changes', async () => {
  const before = (await db.query('SELECT employee_id, name, role, is_active, password_hash, phone FROM users WHERE id = ?', [ids.bde1]))[0];
  for (const body of [{ phone: 'abc' }, { email: 'nope' }, {}, { name: 'Hacker', phone: '9876543210' }, { role: 'admin' }, { employeeId: 'x', phone: '9876543210' },
                      { id: ids.bde2, phone: '9876543210' }, { userId: ids.bde2, phone: '9876543210' }, { passwordHash: 'x', phone: '9876543210' }, { isActive: false, phone: '9876543210' }]) {
    const r = await call('bde1', 'PATCH', '/profile', body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.data.error.code, 'VALIDATION_ERROR');
  }
  const after = (await db.query('SELECT employee_id, name, role, is_active, password_hash, phone FROM users WHERE id = ?', [ids.bde1]))[0];
  assert.deepEqual(after, before);
  assert.equal((await call('bde1', 'PATCH', '/profile', { phone: '9876543210' }, base, undefined)).status, 200);
});

test('POST /profile/password: wrong current, same password and weak password are rejected with nothing changed', async () => {
  const hashBefore = (await db.query('SELECT password_hash FROM users WHERE id = ?', [ids.bde2]))[0].password_hash;
  let r = await call('bde2', 'POST', '/profile/password', { currentPassword: 'wrong-password-1', newPassword: NEW_PASSWORD });
  assert.equal(r.status, 400); assert.ok(r.data.error.fields.currentPassword);
  r = await call('bde2', 'POST', '/profile/password', { currentPassword: PASSWORD, newPassword: PASSWORD });
  assert.equal(r.status, 400); assert.ok(r.data.error.fields.newPassword);
  r = await call('bde2', 'POST', '/profile/password', { currentPassword: PASSWORD, newPassword: 'short' });
  assert.equal(r.status, 400);
  r = await call('bde2', 'POST', '/profile/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, role: 'admin' });
  assert.equal(r.status, 400);
  assert.equal((await db.query('SELECT password_hash FROM users WHERE id = ?', [ids.bde2]))[0].password_hash, hashBefore);
  assert.equal((await call('bde2', 'GET', '/auth/me')).status, 200, 'session still valid after rejected attempts');
});

test('POST /profile/password: success keeps this session, signs out the user\'s other sessions, leaves other users alone, swaps the password', async () => {
  const second = await loginRaw(emp.bde1, PASSWORD);   // a second device for the same user
  assert.equal(second.status, 200);
  assert.equal((await call(null, 'GET', '/auth/me', null, base, second.cookie)).status, 200);

  const r = await call('bde1', 'POST', '/profile/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  assert.equal(r.status, 200); assert.equal(r.data.changed, true);
  assert.ok(!JSON.stringify(r.data).includes(NEW_PASSWORD) && !JSON.stringify(r.data).includes(PASSWORD));

  assert.equal((await call('bde1', 'GET', '/auth/me')).status, 200, 'the session that made the change stays signed in');
  assert.equal((await call(null, 'GET', '/auth/me', null, base, second.cookie)).status, 401, 'the other device is signed out');
  assert.equal((await call('bde2', 'GET', '/auth/me')).status, 200, "another user's session is untouched");
  assert.equal((await loginRaw(emp.bde1, PASSWORD)).status, 401, 'old password no longer works');
  assert.equal((await loginRaw(emp.bde1, NEW_PASSWORD)).status, 200, 'new password works');
  const stored = (await db.query('SELECT password_hash FROM users WHERE id = ?', [ids.bde1]))[0].password_hash;
  assert.ok(stored.startsWith('scrypt$') && !stored.includes(NEW_PASSWORD));
});

test('POST /profile/password: attempts are rate limited per user', async () => {
  const hash = await hashPassword(PASSWORD);
  const r0 = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', ['itest-' + randomBytes(4).toString('hex'), 'Itest limited', hash, 'bde']);
  ids.limited = r0.insertId;
  const emp0 = (await db.query('SELECT employee_id FROM users WHERE id = ?', [ids.limited]))[0].employee_id;
  const session = await loginRaw(emp0, PASSWORD, limitedBase);
  assert.equal(session.status, 200);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await call(null, 'POST', '/profile/password', { currentPassword: 'wrong-password-1', newPassword: NEW_PASSWORD }, limitedBase, session.cookie)).status);
  assert.deepEqual(statuses.slice(0, 3), [400, 400, 400]);
  assert.ok(statuses.slice(3).every((s) => s === 429), JSON.stringify(statuses));
});

test('POST /profile/password: two simultaneous changes - at most one wins, never both silently (compare-and-set)', async () => {
  const hash = await hashPassword(PASSWORD);
  const empId = 'itest-' + randomBytes(4).toString('hex');
  const r0 = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', [empId, 'Itest concurrent', hash, 'bde']);
  ids.concurrent = r0.insertId;
  const a = await loginRaw(empId, PASSWORD); const b = await loginRaw(empId, PASSWORD);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const pwA = 'itest-A-' + rand(); const pwB = 'itest-B-' + rand();
  const [ra, rb] = await Promise.all([
    call(null, 'POST', '/profile/password', { currentPassword: PASSWORD, newPassword: pwA }, base, a.cookie),
    call(null, 'POST', '/profile/password', { currentPassword: PASSWORD, newPassword: pwB }, base, b.cookie)
  ]);
  const winners = [ra, rb].filter((r) => r.status === 200);
  assert.equal(winners.length, 1, 'exactly one request may succeed: ' + JSON.stringify([ra.status, rb.status, ra.data, rb.data]));
  const loser = winners[0] === ra ? rb : ra;
  // 409 = lost the compare-and-set; 400 = started after the winner committed (current password already wrong);
  // 401 = its own session was signed out by the winner before it was authenticated.
  assert.ok([409, 400, 401].includes(loser.status), 'unexpected loser answer ' + loser.status + ' ' + JSON.stringify(loser.data));
  const [winPw, losePw] = winners[0] === ra ? [pwA, pwB] : [pwB, pwA];
  assert.equal((await loginRaw(empId, winPw)).status, 200, 'the winner password works');
  assert.equal((await loginRaw(empId, losePw)).status, 401, 'the losing password was never set');
  assert.equal((await loginRaw(empId, PASSWORD)).status, 401, 'the old password no longer works');
  assert.ok(/already open/.test(winners[0].data.message) && !/admin/i.test(winners[0].data.message));
});
