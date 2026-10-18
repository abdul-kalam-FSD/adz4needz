import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmployeeService, generateTempPassword } from '../src/modules/employees/employees.service.js';
import { createEmployeeRepository } from '../src/modules/employees/employees.repository.js';
import { MIN_PASSWORD_LENGTH } from '../src/lib/password.js';

const admin = { id: 1, role: 'admin' };
const bdeUser = { id: 7, role: 'bde' };
const row = (o = {}) => ({ id: 7, employee_id: 'BDE-007', name: 'Priya S.', phone: '+91 98', email: null, is_active: 1, created_at: '2026-10-01 00:00:00', ...o });

function make({ found = row() } = {}) {
  const log = [];
  const repo = {
    listBdes: async () => [row(), row({ id: 8, name: 'Zed', is_active: 0 })],
    findBde: async (id) => (found && String(found.id) === String(id) ? found : null),
    setActive: async (id, v) => log.push(['setActive', id, v]),
    setPassword: async (id, h) => log.push(['setPassword', id, h])
  };
  return { log, svc: createEmployeeService({ repo, hash: async (p) => 'HASH:' + p.length, makePassword: () => 'Temp-Pass-12345' }) };
}

test('every new action is admin-only (a BDE gets 403 and nothing is written)', async () => {
  const { svc, log } = make();
  for (const call of [() => svc.list(bdeUser), () => svc.setActive(bdeUser, '7', false), () => svc.resetPassword(bdeUser, '7'), () => svc.list(null)]) {
    await assert.rejects(call(), (e) => e.status === 403);
  }
  assert.deepEqual(log, []);
});

test('list: shapes accounts, exposes no password data, includes inactive accounts', async () => {
  const { svc } = make();
  const l = await svc.list(admin);
  assert.equal(l.length, 2); assert.equal(l[1].isActive, false);
  assert.ok(!JSON.stringify(l).toLowerCase().includes('password'));
});

test('setActive: validates id and flag, 404 for unknown/non-BDE, writes only when the state changes', async () => {
  const { svc, log } = make();
  await assert.rejects(svc.setActive(admin, 'abc', false), (e) => e.status === 400);
  await assert.rejects(svc.setActive(admin, '7', 'no'), (e) => e.status === 400 && Boolean(e.fields && e.fields.isActive));
  await assert.rejects(svc.setActive(admin, '99', false), (e) => e.status === 404);
  assert.deepEqual(log, []);
  const off = await svc.setActive(admin, '7', false);
  assert.equal(off.isActive, false); assert.deepEqual(log, [['setActive', '7', false]]);
  await svc.setActive(admin, '7', true); assert.equal(log.length, 1, 'already active: no write');
});

test('resetPassword: temporary password returned once, only its hash is stored, 404 for unknown', async () => {
  const { svc, log } = make();
  const r = await svc.resetPassword(admin, '7');
  assert.equal(r.temporaryPassword, 'Temp-Pass-12345');
  assert.deepEqual(log, [['setPassword', '7', 'HASH:15']]);
  assert.ok(!JSON.stringify(r.employee).includes('Temp-Pass'));
  await assert.rejects(svc.resetPassword(admin, '99'), (e) => e.status === 404);
});

test('generateTempPassword: meets the password policy, uses the full length, no look-alike characters', () => {
  const p = generateTempPassword(); assert.ok(p.length >= MIN_PASSWORD_LENGTH); assert.equal(p.length, 14);
  assert.doesNotMatch(p, /[0OlI1]/);
  assert.notEqual(generateTempPassword(), generateTempPassword());
});

test('repository SQL: role is a constant, ids are parameters, switching off or re-passwording removes sessions', async () => {
  const sqls = []; const db = { query: async (sql, params) => { sqls.push([sql.replace(/\s+/g, ' ').trim(), params]); return []; } };
  const repo = createEmployeeRepository(db);
  await repo.setActive('7', false); await repo.setPassword('7', 'H'); await repo.setActive('7', true);
  assert.deepEqual(sqls[0], ["UPDATE users SET is_active = ? WHERE id = ? AND role = 'bde'", [0, '7']]);
  assert.deepEqual(sqls[1], ['DELETE FROM sessions WHERE user_id = ?', ['7']]);
  assert.deepEqual(sqls[2], ["UPDATE users SET password_hash = ? WHERE id = ? AND role = 'bde'", ['H', '7']]);
  assert.deepEqual(sqls[3], ['DELETE FROM sessions WHERE user_id = ?', ['7']]);
  assert.equal(sqls.length, 5, 'reactivation does not touch sessions');
  assert.ok(sqls.every(([s]) => !/DROP|TRUNCATE/i.test(s)));
});

test('routes are registered under the admin-only employees router', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /employeesRouter\.get\('\/', asyncHandler\(employees\.list\)\)/);
  assert.match(app, /employeesRouter\.put\('\/:id\/active'/); assert.match(app, /employeesRouter\.post\('\/:id\/reset-password'/);
  assert.match(app, /api\.use\('\/admin\/employees', authenticate, authorize\('admin'\), employeesRouter\)/);
});
