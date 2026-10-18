import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateNewEmployee } from '../src/lib/validate-employee.js';
import { createEmployeeService } from '../src/modules/employees/employees.service.js';
import { MIN_PASSWORD_LENGTH } from '../src/lib/password.js';

const admin = { id: 1, role: 'admin' };
const good = { employeeId: 'E101', name: ' Asha Kumar ', password: 'correct-horse-9' };

test('validateNewEmployee: trims, enforces the same rules as the CLI, rejects extra fields', () => {
  const r = validateNewEmployee(good); assert.equal(r.ok, true); assert.deepEqual(r.value, { employeeId: 'E101', name: 'Asha Kumar' });
  const bad = (o) => validateNewEmployee({ ...good, ...o });
  assert.ok(bad({ employeeId: 'has space' }).errors.employeeId); assert.ok(bad({ employeeId: '' }).errors.employeeId); assert.ok(bad({ employeeId: 'x'.repeat(33) }).errors.employeeId); assert.ok(bad({ employeeId: "E1'; --" }).errors.employeeId);
  assert.ok(bad({ name: '   ' }).errors.name); assert.ok(bad({ name: 'x'.repeat(121) }).errors.name); assert.ok(bad({ name: 'a\u0000b' }).errors.name); assert.ok(bad({ name: 5 }).errors.name);
  assert.ok(bad({ password: 'short' }).errors.password); assert.ok(bad({ password: ' '.repeat(12) }).errors.password); assert.ok(bad({ password: 'x'.repeat(201) }).errors.password); assert.ok(bad({ password: 12345678901 }).errors.password);
  assert.ok(bad({ employeeId: 'ABCDEFGHIJ1', password: 'abcdefghij1' }).errors.password, 'password equal to the employee ID (any case) is refused');
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  for (const extra of ['role', 'isActive', 'password_hash', 'id']) assert.ok(validateNewEmployee({ ...good, [extra]: 'admin' }).errors[extra], extra);
  assert.equal(validateNewEmployee(null).ok, false); assert.equal(validateNewEmployee([]).ok, false);
});

function make({ duplicate = false } = {}) {
  const calls = []; const hashed = [];
  const repo = { insertBde: async (a) => { calls.push(a); return duplicate ? { duplicate: true } : { id: 42 }; } };
  return { calls, hashed, svc: createEmployeeService({ repo, hash: async (p) => { hashed.push(p); return 'HASH(' + p.length + ')'; } }) };
}

test('createBde: admin only; stores a hash (never the password); returns no secret; role is always bde', async () => {
  const { svc, calls, hashed } = make();
  for (const a of [{ id: 10, role: 'bde' }, null, { id: 3, role: 'x' }]) await assert.rejects(svc.createBde(a, good), (e) => e.status === 403);
  assert.equal(calls.length, 0);
  const e = await svc.createBde(admin, good);
  assert.deepEqual(e, { id: 42, employeeId: 'E101', name: 'Asha Kumar', role: 'bde', isActive: true });
  assert.deepEqual(calls[0], { employeeId: 'E101', name: 'Asha Kumar', passwordHash: 'HASH(15)' }); assert.deepEqual(hashed, ['correct-horse-9']);
  assert.ok(!JSON.stringify(e).includes('correct-horse') && !JSON.stringify(e).includes('HASH'));
});

test('createBde: validation errors write nothing; a taken employee ID is a 409 with a field error', async () => {
  const { svc, calls } = make();
  await assert.rejects(svc.createBde(admin, { ...good, role: 'admin' }), (e) => e.status === 400 && Boolean(e.fields.role));
  await assert.rejects(svc.createBde(admin, { ...good, password: 'x' }), (e) => e.status === 400);
  assert.equal(calls.length, 0);
  const dup = make({ duplicate: true });
  await assert.rejects(dup.svc.createBde(admin, good), (e) => e.status === 409 && e.code === 'EMPLOYEE_ID_EXISTS' && Boolean(e.fields.employeeId));
});

test('wiring (text): a separate admin-only router with EXACTLY these four routes; SQL fixes the role to bde', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /api\.use\('\/admin\/employees', authenticate, authorize\('admin'\), employeesRouter\)/);
  // Deliberately widened (team management): list, create, switch on/off, reset password. Any other route must be added here on purpose.
  assert.deepEqual((app.match(/employeesRouter\.\w+\('[^']*'/g) || []).sort(), ["employeesRouter.get('/'", "employeesRouter.post('/'", "employeesRouter.post('/:id/reset-password'", "employeesRouter.put('/:id/active'"]);
  assert.ok(app.indexOf("api.use('/admin/employees'") < app.indexOf("api.use('/admin', authenticate"));
  const repo = readFileSync(new URL('../src/modules/employees/employees.repository.js', import.meta.url), 'utf8');
  assert.match(repo, /VALUES \(\?, \?, \?, 'bde', 1,/); assert.ok(!/role\s*=\s*\?/.test(repo));
  assert.equal((repo.match(/role = 'bde'/g) || []).length, 4, 'find, list, setActive and setPassword all fix the role in SQL');
});
