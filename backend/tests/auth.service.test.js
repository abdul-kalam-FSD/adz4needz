import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { hashPassword } from '../src/lib/password.js';
import { hashToken } from '../src/lib/session-token.js';

async function setup(overrides = {}) {
  const user = { id: 7, employee_id: 'EMP-TEST', name: 'Test User', role: 'bde', is_active: 1, password_hash: await hashPassword('right-password-1') };
  const sessions = new Map();
  const calls = { cleanup: 0 };
  const repo = {
    findUserByEmployeeId: async (id) => (id === user.employee_id ? { ...user, ...overrides } : null),
    createSession: async ({ userId, tokenHash, ttlHours }) => { sessions.set(tokenHash, { userId, ttlHours }); },
    findActiveSessionUser: async (h) => (sessions.has(h) ? { id: user.id, employee_id: user.employee_id, name: user.name, role: user.role } : null),
    deleteSessionByHash: async (h) => { sessions.delete(h); },
    deleteExpiredSessionsForUser: async () => { calls.cleanup++; }
  };
  return { service: createAuthService({ repo, ttlHours: 8 }), sessions, calls };
}
const rejects401 = (p) => assert.rejects(p, (e) => e.status === 401 && e.code === 'INVALID_CREDENTIALS' && e.message === 'Employee ID or password is incorrect.');

test('login succeeds, stores only the token HASH, returns public user without password data', async () => {
  const { service, sessions, calls } = await setup();
  const { token, user } = await service.login(' EMP-TEST ', 'right-password-1');
  assert.deepEqual(user, { id: 7, employeeId: 'EMP-TEST', name: 'Test User', role: 'bde' });
  assert.ok(!JSON.stringify(user).match(/hash|password/i));
  assert.ok(sessions.has(hashToken(token))); assert.ok(!sessions.has(token));
  assert.equal(sessions.get(hashToken(token)).ttlHours, 8); assert.equal(calls.cleanup, 1);
});
test('wrong password, unknown ID and inactive user all give the SAME error', async () => {
  await rejects401((await setup()).service.login('EMP-TEST', 'wrong-password'));
  await rejects401((await setup()).service.login('NOBODY', 'right-password-1'));
  await rejects401((await setup({ is_active: 0 })).service.login('EMP-TEST', 'right-password-1'));
});
test('blank, non-string or oversized credentials -> 400 before any lookup', async () => {
  const { service } = await setup();
  for (const [a, b] of [['', 'x'], ['EMP-TEST', ''], [null, 'x'], ['EMP-TEST', 123], ['EMP-TEST', 'x'.repeat(500)]]) {
    await assert.rejects(service.login(a, b), (e) => e.status === 400);
  }
});
test('session lookup works, and logout invalidates the session', async () => {
  const { service } = await setup();
  const { token } = await service.login('EMP-TEST', 'right-password-1');
  assert.equal((await service.getUserForSession(token)).employeeId, 'EMP-TEST');
  await service.logout(token);
  assert.equal(await service.getUserForSession(token), null);
  assert.equal(await service.getUserForSession(''), null);
  assert.equal(await service.getUserForSession(undefined), null);
  await service.logout(undefined); // must not throw
});

test('an over-long employee ID is refused with 400 before any lookup or password hashing (64 characters is the limit)', async () => {
  let lookups = 0;
  const { service } = await setup();
  const guarded = createAuthService({ repo: { findUserByEmployeeId: async () => { lookups++; return null; } }, ttlHours: 8 });
  await assert.rejects(guarded.login('E'.repeat(65), 'right-password-1'), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');
  await assert.rejects(guarded.login('  ' + 'E'.repeat(65) + '  ', 'right-password-1'), (e) => e.status === 400);
  assert.equal(lookups, 0, 'no database lookup for an impossible ID');
  await assert.rejects(guarded.login('E'.repeat(64), 'right-password-1'), (e) => e.status === 401, 'exactly 64 is still looked up (and simply does not exist)');
  assert.equal(lookups, 1); assert.ok(service);
});
