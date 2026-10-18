import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContactForm, validatePasswordForm } from './validate-profile.js';

test('contact: valid values are trimmed and both keys are always present', () => {
  const r = validateContactForm({ phone: ' +91 98765 43210 ', email: ' anu@example.com ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { phone: '+91 98765 43210', email: 'anu@example.com' });
});
test('contact: blank fields become null (clear)', () => {
  assert.deepEqual(validateContactForm({ phone: '', email: '   ' }).value, { phone: null, email: null });
  assert.deepEqual(validateContactForm({ phone: undefined, email: null }).value, { phone: null, email: null });
});
test('contact: invalid phone numbers are rejected (same cases as the server tests)', () => {
  for (const phone of ['abc', '12345', '1'.repeat(16), '1'.repeat(21), '98765 4321 x']) {
    const r = validateContactForm({ phone, email: '' });
    assert.equal(r.ok, false, phone); assert.ok(r.errors.phone, phone);
  }
  for (const phone of ['9876543210', '+91 98765 43210', '1234567', '123456789012345', '(044) 2345 6789', '98765-43210']) assert.equal(validateContactForm({ phone, email: '' }).ok, true, phone);
});
test('contact: invalid emails are rejected (same cases as the server tests)', () => {
  for (const email of ['a@b', 'a b@c.de', 'a@@b.co', '@b.co', 'a@.co', 'x'.repeat(250) + '@a.co', 'tab\t@x.co']) {
    const r = validateContactForm({ phone: '', email });
    assert.equal(r.ok, false, email); assert.ok(r.errors.email, email);
  }
  assert.equal(validateContactForm({ phone: '', email: 'a@b.co' }).ok, true);
});
test('contact: a rejected form returns no usable value', () => {
  assert.deepEqual(validateContactForm({ phone: 'abc', email: 'a@b.co' }).value, {});
});

const OLD = 'old-password-123', NEW = 'brand-new-pass-456';
test('password: valid form passes and only current + new are returned (no confirm field)', () => {
  const r = validatePasswordForm({ currentPassword: OLD, newPassword: NEW, confirmPassword: NEW });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ['currentPassword', 'newPassword']);
});
test('password: policy is 10 to 200 characters', () => {
  const f = (n) => validatePasswordForm({ currentPassword: OLD, newPassword: n, confirmPassword: n });
  assert.equal(f('x'.repeat(9)).ok, false);
  assert.equal(f('x'.repeat(10)).ok, true);
  assert.equal(f('x'.repeat(200)).ok, true);
  assert.equal(f('x'.repeat(201)).ok, false);
});
test('password: current is required, new must differ from current, confirmation must match', () => {
  assert.ok(validatePasswordForm({ currentPassword: '', newPassword: NEW, confirmPassword: NEW }).errors.currentPassword);
  assert.match(validatePasswordForm({ currentPassword: OLD, newPassword: OLD, confirmPassword: OLD }).errors.newPassword, /different/);
  assert.ok(validatePasswordForm({ currentPassword: OLD, newPassword: NEW, confirmPassword: NEW + 'x' }).errors.confirmPassword);
});
test('password: messages never contain the typed passwords', () => {
  const r = validatePasswordForm({ currentPassword: OLD, newPassword: 'short', confirmPassword: 'other' });
  assert.ok(!JSON.stringify(r.errors).includes(OLD) && !JSON.stringify(r.errors).includes('short'));
});
test('profile page source: exactly the five expected inputs exist; name, employee ID and role are display-only', () => {
  const src = readFileSync(new URL('../pages/ProfilePage.jsx', import.meta.url), 'utf8');
  const ids = (src.match(/<input\b[^>]*>/g) || []).map((tag) => (tag.match(/\bid="([^"]+)"/) || [])[1]);
  assert.deepEqual(ids.sort(), ['field-confirmPassword', 'field-currentPassword', 'field-email', 'field-newPassword', 'field-phone']);
  assert.ok(!/setName|setEmployeeId|setRole/.test(src));
  assert.match(src, /<dd>\{p\.name\}<\/dd>/); assert.match(src, /<dd>\{p\.employeeId\}<\/dd>/);
});
