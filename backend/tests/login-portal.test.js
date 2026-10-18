import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService, LOGIN_PORTALS } from '../src/modules/auth/auth.service.js';
import { createAuthHandlers } from '../src/modules/auth/auth.handlers.js';
import { hashPassword } from '../src/lib/password.js';

// Admin Sign In / Employee Sign In: the optional `portal` value only NARROWS who may sign in; it never grants anything.
async function setup() {
  const rows = [
    { id: 1, employee_id: 'ADM-1', name: 'Admin One', role: 'admin', is_active: 1, password_hash: await hashPassword('admin-password-1') },
    { id: 2, employee_id: 'BDE-1', name: 'Bde One', role: 'bde', is_active: 1, password_hash: await hashPassword('bde-password-1') }
  ];
  const calls = { lookups: 0, sessions: 0 };
  const repo = {
    findUserByEmployeeId: async (id) => { calls.lookups++; return rows.find((r) => r.employee_id === id) || null; },
    createSession: async () => { calls.sessions++; return true; },
    findActiveSessionUser: async () => null,
    deleteSessionByHash: async () => {},
    deleteExpiredSessionsForUser: async () => {}
  };
  return { service: createAuthService({ repo, ttlHours: 8 }), calls };
}
const generic401 = (e) => e.status === 401 && e.code === 'INVALID_CREDENTIALS' && e.message === 'Employee ID or password is incorrect.';

test('portals: only "admin" and "employee" exist', () => { assert.deepEqual(LOGIN_PORTALS, ['admin', 'employee']); });

test('no portal (the old request shape) still lets both an admin and a BDE sign in, exactly as before', async () => {
  const { service } = await setup();
  assert.equal((await service.login('BDE-1', 'bde-password-1')).user.role, 'bde');
  assert.equal((await service.login('ADM-1', 'admin-password-1')).user.role, 'admin');
  assert.equal((await service.login('BDE-1', 'bde-password-1', undefined)).user.role, 'bde');
  assert.equal((await service.login('BDE-1', 'bde-password-1', null)).user.role, 'bde');
});

test('portal "employee": a BDE signs in (admins are not locked out of the employee screen either)', async () => {
  const { service } = await setup();
  assert.equal((await service.login('BDE-1', 'bde-password-1', 'employee')).user.role, 'bde');
  assert.equal((await service.login('ADM-1', 'admin-password-1', 'employee')).user.role, 'admin');
});

test('portal "admin": an admin signs in', async () => {
  const { service } = await setup();
  const { user, token } = await service.login(' ADM-1 ', 'admin-password-1', 'admin');
  assert.equal(user.role, 'admin'); assert.ok(token);
});

test('portal "admin": a BDE with the CORRECT password is refused with the generic error and NO session is created', async () => {
  const { service, calls } = await setup();
  await assert.rejects(service.login('BDE-1', 'bde-password-1', 'admin'), generic401);
  assert.equal(calls.sessions, 0, 'a BDE must never obtain a session through the admin screen');
});

test('portal "admin": the refusal is the same error as a wrong password or an unknown ID (the role is not revealed)', async () => {
  const { service } = await setup();
  const err = async (p) => { try { await p; } catch (e) { return { status: e.status, code: e.code, message: e.message, fields: e.fields }; } throw new Error('expected a rejection'); };
  const asBde = await err(service.login('BDE-1', 'bde-password-1', 'admin'));
  assert.deepEqual(asBde, await err(service.login('BDE-1', 'wrong-password', 'admin')));
  assert.deepEqual(asBde, await err(service.login('NOBODY', 'whatever-123', 'admin')));
});

test('an unknown portal value is a 400 before any database lookup (it cannot be used to probe or to ask for a role)', async () => {
  const { service, calls } = await setup();
  for (const bad of ['superadmin', 'ADMIN', '', 'bde', 1, true, {}, ['admin']]) {
    await assert.rejects(service.login('ADM-1', 'admin-password-1', bad), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');
  }
  assert.equal(calls.lookups, 0); assert.equal(calls.sessions, 0);
});

test('login handler passes the portal on, never trusts a client-supplied role, and never puts the token in the body', async () => {
  const seen = [];
  const authService = { login: async (id, pw, portal) => { seen.push({ id, pw, portal }); return { token: 'TOK', user: { id: 1, employeeId: id, name: 'N', role: 'admin' } }; } };
  const h = createAuthHandlers({ authService, config: { sessionTtlHours: 8, cookieSecure: false, cookieName: 'bde_session' } });
  const res = { headers: {}, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; }, setHeader(k, v) { res.headers[k] = v; } };
  await h.login({ body: { employeeId: 'ADM-1', password: 'p', portal: 'admin', role: 'admin' } }, res);
  assert.deepEqual(seen[0], { id: 'ADM-1', pw: 'p', portal: 'admin' });
  assert.ok(!JSON.stringify(res.body).includes('TOK'));
  await h.login({ body: { employeeId: 'E', password: 'p' } }, res);
  assert.equal(seen[1].portal, undefined);
});
