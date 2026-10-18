import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfileUpdate, validatePasswordChange } from '../src/lib/validate-profile.js';
import { validateLead } from '../src/lib/validate-lead.js';

// ---- contact details ----
test('profile update: valid phone and email are accepted and trimmed', () => {
  const r = validateProfileUpdate({ phone: ' +91 98765 43210 ', email: ' anu@example.com ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { phone: '+91 98765 43210', email: 'anu@example.com' });
});
test('profile update: only the fields that are present are in the result (missing = unchanged)', () => {
  assert.deepEqual(validateProfileUpdate({ phone: '9876543210' }).value, { phone: '9876543210' });
  assert.deepEqual(validateProfileUpdate({ email: 'a@b.co' }).value, { email: 'a@b.co' });
});
test('profile update: null or blank clears a field', () => {
  assert.deepEqual(validateProfileUpdate({ phone: null, email: '   ' }).value, { phone: null, email: null });
});
test('profile update: invalid phone numbers are rejected', () => {
  for (const phone of ['abc', '12345', '1'.repeat(16), '1'.repeat(21), '98765 4321 x', 12345678901, true, {}, ['9876543210']]) {
    const r = validateProfileUpdate({ phone });
    assert.equal(r.ok, false, String(JSON.stringify(phone)));
    assert.ok(r.errors.phone, String(JSON.stringify(phone)));
  }
});
test('profile update: invalid emails are rejected', () => {
  const long = 'x'.repeat(250) + '@a.co';
  for (const email of ['a@b', 'a b@c.de', 'a@@b.co', '@b.co', 'a@.co', long, 'tab\t@x.co', 'nl\n@x.co', 42, true, {}]) {
    const r = validateProfileUpdate({ email });
    assert.equal(r.ok, false, String(JSON.stringify(email)));
    assert.ok(r.errors.email, String(JSON.stringify(email)));
  }
});
test('profile update: unexpected fields are rejected, never silently ignored', () => {
  for (const extra of ['name', 'employeeId', 'employee_id', 'role', 'id', 'userId', 'isActive', 'password', 'passwordHash', 'password_hash', 'createdAt']) {
    const r = validateProfileUpdate({ phone: '9876543210', [extra]: 'x' });
    assert.equal(r.ok, false, extra);
    assert.ok(r.errors._form, extra);
    assert.deepEqual(r.value, {}, 'nothing usable is returned when the request is rejected');
  }
  const proto = validateProfileUpdate(JSON.parse('{"phone":"9876543210","__proto__":{"role":"admin"}}'));
  assert.equal(proto.ok, false);
});
test('profile update: empty object and non-objects are rejected', () => {
  for (const body of [{}, null, undefined, 'x', 5, [], [{ phone: '9876543210' }]]) assert.equal(validateProfileUpdate(body).ok, false, JSON.stringify(body));
});
test('profile update: phone/email rules match the lead rules (parity with validateLead)', () => {
  const phones = ['9876543210', '+91 98765 43210', '12345', '1234567', '123456789012345', '1234567890123456', 'abc', '98765-43210', '(044) 2345 6789', '1'.repeat(21), ' '];
  for (const p of phones) {
    const lead = validateLead({ candidateName: 'A', email: 'a@b.co', phone: p, courseOrInternship: 'C' });
    const mine = validateProfileUpdate({ phone: p });
    assert.equal(!!mine.errors.phone, !!lead.errors.phone, 'phone ' + JSON.stringify(p));
  }
  const emails = ['a@b.co', 'a@b', 'a b@c.de', 'x'.repeat(250) + '@a.co', 'a@b.c', 'a@@b.co', 'tab\t@x.co', ' '];
  for (const e of emails) {
    const lead = validateLead({ candidateName: 'A', phone: '9876543210', email: e, courseOrInternship: 'C' });
    const mine = validateProfileUpdate({ email: e });
    assert.equal(!!mine.errors.email, !!lead.errors.email, 'email ' + JSON.stringify(e));
  }
});

// ---- password change ----
const OLD = 'old-password-123';
const NEW = 'brand-new-pass-456';
test('password change: valid request passes through untouched (no trimming)', () => {
  const r = validatePasswordChange({ currentPassword: OLD, newPassword: '  spaced new pass  ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.newPassword, '  spaced new pass  ');
});
test('password change: new password policy is 10 to 200 characters', () => {
  assert.equal(validatePasswordChange({ currentPassword: OLD, newPassword: 'x'.repeat(9) }).ok, false);
  assert.equal(validatePasswordChange({ currentPassword: OLD, newPassword: 'x'.repeat(10) }).ok, true);
  assert.equal(validatePasswordChange({ currentPassword: OLD, newPassword: 'x'.repeat(200) }).ok, true);
  const long = validatePasswordChange({ currentPassword: OLD, newPassword: 'x'.repeat(201) });
  assert.equal(long.ok, false); assert.ok(long.errors.newPassword);
});
test('password change: current password is required, a string, and at most 200 characters', () => {
  for (const currentPassword of [undefined, null, '', 5, {}, 'x'.repeat(201)]) {
    const r = validatePasswordChange({ currentPassword, newPassword: NEW });
    assert.equal(r.ok, false); assert.ok(r.errors.currentPassword);
  }
});
test('password change: a new password identical to the current one is rejected', () => {
  const r = validatePasswordChange({ currentPassword: OLD, newPassword: OLD });
  assert.equal(r.ok, false); assert.match(r.errors.newPassword, /different/);
});
test('password change: non-string new password is rejected', () => {
  for (const newPassword of [undefined, null, 12345678901, {}, ['x'.repeat(12)]]) assert.equal(validatePasswordChange({ currentPassword: OLD, newPassword }).ok, false);
});
test('password change: unexpected fields and non-objects are rejected', () => {
  for (const extra of ['confirmPassword', 'userId', 'role', 'passwordHash']) {
    const r = validatePasswordChange({ currentPassword: OLD, newPassword: NEW, [extra]: 'x' });
    assert.equal(r.ok, false, extra); assert.ok(r.errors._form, extra);
  }
  for (const body of [null, undefined, 'x', [], 7]) assert.equal(validatePasswordChange(body).ok, false);
});
test('password change: no error message contains either password', () => {
  const r = validatePasswordChange({ currentPassword: OLD, newPassword: OLD });
  assert.ok(!JSON.stringify(r.errors).includes(OLD));
  const r2 = validatePasswordChange({ currentPassword: OLD, newPassword: 'short', extra: 1 });
  assert.ok(!JSON.stringify(r2.errors).includes('short'));
});
