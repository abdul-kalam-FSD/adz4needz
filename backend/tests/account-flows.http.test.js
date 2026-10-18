// Route-level tests of the sign-in and account-creation flows. They start the REAL Express app (real routes, middleware, auth service,
// employee service, scrypt hashing) on a random local port and call it with fetch. Only the database is replaced by in-memory repositories
// (so this is NOT a MySQL test: the real SQL and the UNIQUE index are covered by the text checks and must still be run against MySQL).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createEmployeeService } from '../src/modules/employees/employees.service.js';
import { hashPassword } from '../src/lib/password.js';
import { hashToken } from '../src/lib/session-token.js';

const config = {
  cookieName: 'bde_session', cookieSecure: false, sessionTtlHours: 8, trustProxy: false,
  loginRateLimitMax: 1000, chatSendRateLimitMax: 1000, receiptMaxBytes: 1024 * 1024, importMaxBytes: 1024 * 1024
};

let server; let base; const users = []; const sessions = new Map();
const lower = (s) => String(s).toLowerCase();

before(async () => {
  users.push(
    { id: 1, employee_id: 'ADM-1', name: 'Admin One', role: 'admin', is_active: 1, password_hash: await hashPassword('admin-password-1') },
    { id: 2, employee_id: 'BDE-1', name: 'Bde One', role: 'bde', is_active: 1, password_hash: await hashPassword('bde-password-1') }
  );
  // In-memory repositories. The employee repository emulates the UNIQUE employee_id index, which MySQL compares case-insensitively.
  const authRepo = {
    findUserByEmployeeId: async (id) => users.find((u) => lower(u.employee_id) === lower(id)) || null,
    createSession: async ({ userId, tokenHash }) => { sessions.set(tokenHash, userId); return true; },
    findActiveSessionUser: async (h) => { const u = users.find((x) => x.id === sessions.get(h)); return u && u.is_active ? { id: u.id, employee_id: u.employee_id, name: u.name, role: u.role } : null; },
    deleteSessionByHash: async (h) => { sessions.delete(h); },
    deleteExpiredSessionsForUser: async () => {}
  };
  const employeeRepo = {
    insertBde: async ({ employeeId, name, passwordHash }) => {
      if (users.some((u) => lower(u.employee_id) === lower(employeeId))) return { duplicate: true };
      const id = users.length + 1; users.push({ id, employee_id: employeeId, name, role: 'bde', is_active: 1, password_hash: passwordHash }); return { id };
    }
  };
  const authService = createAuthService({ repo: authRepo, ttlHours: 8 });
  const employeeService = createEmployeeService({ repo: employeeRepo });
  const app = createApp({ config, authService, employeeService, checkDb: async () => {} });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function call(method, path, { body, cookie, contentType = 'application/json' } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': contentType } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const sc = res.headers.get('set-cookie');
  return { status: res.status, json, text, setCookie: sc, cookie: sc ? sc.split(';')[0] : null };
}
const signIn = (employeeId, password, portal) => call('POST', '/api/auth/login', { body: portal === undefined ? { employeeId, password } : { employeeId, password, portal } });
const adminCookie = async () => (await signIn('ADM-1', 'admin-password-1', 'admin')).cookie;
const bdeCookie = async () => (await signIn('BDE-1', 'bde-password-1')).cookie;
const newBde = { employeeId: 'BDE-200', name: 'Asha Kumar', password: 'initial-pass-200' };

test('Employee Sign In: the existing request (employee ID + password, no portal) still works and sets an HttpOnly cookie', async () => {
  const r = await signIn('BDE-1', 'bde-password-1');
  assert.equal(r.status, 200); assert.deepEqual(r.json.user, { id: 2, employeeId: 'BDE-1', name: 'Bde One', role: 'bde' });
  assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Lax/);
  assert.ok(!r.text.includes('password') && !r.text.includes('scrypt'), 'no password data in the response');
  const me = await call('GET', '/api/auth/me', { cookie: r.cookie }); assert.equal(me.status, 200); assert.equal(me.json.user.employeeId, 'BDE-1');
});

test('Employee Sign In: explicit portal "employee" works; wrong password and unknown ID give the same 401', async () => {
  assert.equal((await signIn('BDE-1', 'bde-password-1', 'employee')).status, 200);
  const a = await signIn('BDE-1', 'nope-nope-nope', 'employee'); const b = await signIn('GHOST', 'nope-nope-nope', 'employee');
  assert.equal(a.status, 401); assert.deepEqual(a.json, b.json); assert.equal(a.setCookie, null);
});

test('Admin Sign In: an admin signs in; a BDE with the correct password is refused (401, no cookie, no session)', async () => {
  const ok = await signIn('ADM-1', 'admin-password-1', 'admin');
  assert.equal(ok.status, 200); assert.equal(ok.json.user.role, 'admin');
  const before = sessions.size;
  const bde = await signIn('BDE-1', 'bde-password-1', 'admin');
  assert.equal(bde.status, 401); assert.equal(bde.json.error.code, 'INVALID_CREDENTIALS'); assert.equal(bde.setCookie, null);
  assert.equal(sessions.size, before, 'no session was created for the BDE');
  const wrong = await signIn('BDE-1', 'wrong-password-1', 'admin'); assert.deepEqual(wrong.json, bde.json, 'same body as a plain wrong password: the role is not revealed');
});

test('Admin Sign In: an unknown portal value or a client-supplied role is never honoured', async () => {
  assert.equal((await signIn('ADM-1', 'admin-password-1', 'root')).status, 400);
  const r = await call('POST', '/api/auth/login', { body: { employeeId: 'BDE-1', password: 'bde-password-1', role: 'admin' } });
  assert.equal(r.status, 200); assert.equal(r.json.user.role, 'bde', 'a role in the request body changes nothing');
});

test('Create BDE Account: no session -> 401, BDE session -> 403, and nothing is created either way', async () => {
  const count = users.length;
  assert.equal((await call('POST', '/api/admin/employees', { body: newBde })).status, 401);
  assert.equal((await call('POST', '/api/admin/employees', { body: newBde, cookie: 'bde_session=forged-token' })).status, 401);
  const asBde = await call('POST', '/api/admin/employees', { body: newBde, cookie: await bdeCookie() });
  assert.equal(asBde.status, 403); assert.equal(asBde.json.error.code, 'FORBIDDEN');
  assert.equal(users.length, count);
});

test('Create BDE Account: an admin creates a BDE; the response has no password or hash; the new BDE can sign in with the initial password', async () => {
  const r = await call('POST', '/api/admin/employees', { body: newBde, cookie: await adminCookie() });
  assert.equal(r.status, 201); assert.equal(r.json.employee.employeeId, 'BDE-200'); assert.equal(r.json.employee.role, 'bde');
  assert.ok(!/initial-pass-200|scrypt|password/i.test(r.text), 'no password or hash in the response');
  assert.equal(r.setCookie, null, 'creating an account does not sign anyone in');
  assert.match(users.find((u) => u.employee_id === 'BDE-200').password_hash, /^scrypt\$/, 'stored as a scrypt hash, not plain text');
  assert.ok(!users.some((u) => JSON.stringify(u).includes('initial-pass-200')));
  const login = await signIn('BDE-200', 'initial-pass-200'); assert.equal(login.status, 200); assert.equal(login.json.user.role, 'bde');
  assert.equal((await signIn('BDE-200', 'initial-pass-200', 'admin')).status, 401, 'a freshly created BDE cannot use Admin Sign In');
});

test('Create BDE Account: a duplicate Employee ID (same or different letter case) is a 409 and leaves the existing account untouched', async () => {
  const cookie = await adminCookie(); const count = users.length;
  for (const id of ['BDE-1', 'bde-1', 'Bde-1', 'ADM-1']) {
    const r = await call('POST', '/api/admin/employees', { body: { ...newBde, employeeId: id, password: 'takeover-pass-1' }, cookie });
    assert.equal(r.status, 409, id); assert.equal(r.json.error.code, 'EMPLOYEE_ID_EXISTS'); assert.ok(r.json.error.fields.employeeId);
    assert.ok(!r.text.includes('takeover-pass-1'));
  }
  assert.equal(users.length, count);
  assert.equal((await signIn('BDE-1', 'bde-password-1')).status, 200, 'the original password still works');
  assert.equal((await signIn('BDE-1', 'takeover-pass-1')).status, 401);
});

test('Create BDE Account: invalid input is a 400 with field messages and creates nothing', async () => {
  const cookie = await adminCookie(); const count = users.length;
  const bads = [
    { ...newBde, employeeId: 'has space' }, { ...newBde, employeeId: '' }, { ...newBde, employeeId: 'x'.repeat(33) }, { ...newBde, employeeId: "E1'; DROP TABLE users;--" },
    { ...newBde, name: '   ' }, { ...newBde, name: 'x'.repeat(121) },
    { ...newBde, password: 'short' }, { ...newBde, password: ' '.repeat(12) }, { ...newBde, employeeId: 'SAME-ID-123', password: 'same-id-123' },
    { employeeId: 'NO-PASS-1', name: 'No Password' }
  ];
  for (const body of bads) {
    const r = await call('POST', '/api/admin/employees', { body, cookie });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60)); assert.equal(r.json.error.code, 'VALIDATION_ERROR'); assert.ok(Object.keys(r.json.error.fields).length >= 1);
  }
  assert.equal((await call('POST', '/api/admin/employees', { body: '{not json', cookie, contentType: 'application/json' })).status, 400);
  assert.equal((await call('POST', '/api/admin/employees', { body: JSON.stringify(newBde), cookie, contentType: 'text/plain' })).status, 415, 'must be sent as JSON');
  assert.equal(users.length, count);
});

test('Role escalation: the create-account endpoint refuses role, isActive and every other extra field, and can never create an admin', async () => {
  const cookie = await adminCookie(); const count = users.length;
  for (const extra of [{ role: 'admin' }, { role: 'bde' }, { isActive: false }, { is_active: 1 }, { password_hash: 'x' }, { id: 1 }, { portal: 'admin' }]) {
    const r = await call('POST', '/api/admin/employees', { body: { ...newBde, employeeId: 'ESC-' + Object.keys(extra)[0], ...extra }, cookie });
    assert.equal(r.status, 400, JSON.stringify(extra)); assert.ok(r.json.error.fields[Object.keys(extra)[0]]);
  }
  assert.equal(users.length, count);
  assert.ok(!users.some((u) => u.role === 'admin' && u.employee_id !== 'ADM-1'), 'still exactly one admin');
});

test('No public registration: self-registration and setup paths do not exist, and the admin routes stay closed to the public', async () => {
  for (const path of ['/api/auth/register', '/api/register', '/api/auth/signup', '/api/signup', '/api/employees', '/api/users', '/api/setup', '/api/auth/bootstrap', '/api/admin/setup', '/api/admin/bootstrap']) {
    const r = await call('POST', path, { body: { employeeId: 'HACK-1', name: 'Hacker', password: 'hacker-pass-1', role: 'admin' } });
    assert.ok([401, 404].includes(r.status), path + ' -> ' + r.status);
  }
  assert.ok(!users.some((u) => u.employee_id === 'HACK-1'));
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/admin/bdes')).status, 401);
  assert.equal((await call('GET', '/api/admin/bdes', { cookie: await bdeCookie() })).status, 403);
});

test('a logged-out session no longer works for account creation (logout is enforced by the server)', async () => {
  const cookie = await adminCookie();
  assert.equal((await call('POST', '/api/auth/logout', { body: {}, cookie })).status, 204);
  assert.equal((await call('POST', '/api/admin/employees', { body: { ...newBde, employeeId: 'AFTER-LOGOUT' }, cookie })).status, 401);
  assert.equal(sessions.has(hashToken(cookie.split('=')[1])), false);
});
