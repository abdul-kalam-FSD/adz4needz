import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEmployeeForm } from './validate-employee.js';

const good = { employeeId: 'E101', name: 'Asha Kumar', password: 'correct-horse-9', confirmPassword: 'correct-horse-9' };
test('valid form', () => { const r = validateEmployeeForm({ ...good, name: ' Asha Kumar ' }); assert.equal(r.ok, true); assert.equal(r.value.name, 'Asha Kumar'); });
test('each rule', () => {
  assert.ok(validateEmployeeForm({ ...good, employeeId: 'a b' }).errors.employeeId); assert.ok(validateEmployeeForm({ ...good, name: '' }).errors.name);
  assert.ok(validateEmployeeForm({ ...good, password: 'short', confirmPassword: 'short' }).errors.password);
  assert.ok(validateEmployeeForm({ ...good, confirmPassword: 'different-pass1' }).errors.confirmPassword);
  assert.ok(validateEmployeeForm({ ...good, employeeId: 'abcdefghij1', password: 'ABCDEFGHIJ1', confirmPassword: 'ABCDEFGHIJ1' }).errors.password);
  assert.ok(validateEmployeeForm({ ...good, password: ' '.repeat(12), confirmPassword: ' '.repeat(12) }).errors.password);
});
