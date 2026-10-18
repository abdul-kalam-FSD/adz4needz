import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLead, normalizePhoneKey, normalizeEmailKey, LIMITS } from '../src/lib/validate-lead.js';
import { addDays } from '../src/lib/dates.js';

const good = { candidateName: 'Priya R', phone: '+91 98765 43210', email: 'Priya@Example.com', courseOrInternship: 'Full Stack Internship', leadStatusId: 2, followUpDate: '2026-10-20', nextAction: 'Call after 5 pm', };
const v = (o) => validateLead({ ...good, ...o });

test('valid lead passes, values are trimmed and keys computed', () => {
  const r = v({ candidateName: '  Priya R  ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.candidateName, 'Priya R');
  assert.equal(r.value.phoneKey, '9876543210');
  assert.equal(r.value.emailKey, 'priya@example.com');
  assert.equal(r.value.leadStatusId, 2);
  assert.equal(r.value.confirmDuplicate, false);
});
test('phone only, email only, and both are fine; neither is rejected', () => {
  assert.equal(v({ email: '' }).ok, true);
  assert.equal(v({ phone: '' }).ok, true);
  const r = v({ phone: '', email: null });
  assert.equal(r.ok, false); assert.ok(r.errors.phone);
});
test('follow-up date and next action are optional', () => {
  const r = v({ followUpDate: '', nextAction: '   ' });
  assert.equal(r.ok, true); assert.equal(r.value.followUpDate, null); assert.equal(r.value.nextAction, null);
});
test('required fields: name, course, status', () => {
  for (const [k, e] of [['candidateName', 'candidateName'], ['courseOrInternship', 'courseOrInternship'], ['leadStatusId', 'leadStatusId']]) {
    for (const bad of ['', '   ', null, undefined]) assert.ok(v({ [k]: bad }).errors[e], `${k} = ${JSON.stringify(bad)}`);
  }
});
test('phone rules: characters and 7-15 digits', () => {
  for (const bad of ['abc', '12345', '1'.repeat(16), '98765 4321 x', '<script>', 98765432101]) assert.ok(v({ phone: bad }).errors.phone, String(bad));
  for (const ok of ['9876543210', '+91 98765-43210', '(044) 2345 6789']) assert.equal(v({ phone: ok }).ok, true, ok);
});
test('email rules', () => {
  for (const bad of ['plain', 'a@b', '@x.com', 'a b@x.com', 'x'.repeat(250) + '@x.com']) assert.ok(v({ email: bad }).errors.email, bad);
});
test('length limits', () => {
  assert.ok(v({ candidateName: 'x'.repeat(LIMITS.name + 1) }).errors.candidateName);
  assert.ok(v({ courseOrInternship: 'x'.repeat(LIMITS.course + 1) }).errors.courseOrInternship);
  assert.ok(v({ nextAction: 'x'.repeat(LIMITS.nextAction + 1) }).errors.nextAction);
  assert.equal(v({ candidateName: 'x'.repeat(LIMITS.name) }).ok, true);
});
test('control characters and non-string text are rejected; newline is allowed only in next action', () => {
  assert.ok(v({ candidateName: 'a\u0000b' }).errors.candidateName);
  assert.ok(v({ courseOrInternship: 'a\nb' }).errors.courseOrInternship);
  assert.ok(v({ candidateName: { $ne: 1 } }).errors.candidateName);
  assert.ok(v({ nextAction: 'a\u0007b' }).errors.nextAction);
  assert.equal(v({ nextAction: 'line1\nline2' }).ok, true);
});
test('status id must be a positive whole number; strings of digits accepted', () => {
  for (const bad of [0, -1, 1.5, 'abc', '0', '01', {}, true]) assert.ok(v({ leadStatusId: bad }).errors.leadStatusId, String(bad));
  assert.equal(v({ leadStatusId: '3' }).value.leadStatusId, 3);
});
test('follow-up date must be a real date (past dates are allowed)', () => {
  for (const bad of ['2026-02-30', '20/10/2026', 5]) assert.ok(v({ followUpDate: bad }).errors.followUpDate, String(bad));
  assert.equal(v({ followUpDate: '2020-01-01' }).ok, true);
});
test('confirmDuplicate is true only for the boolean true; owner/user fields in the body are ignored', () => {
  assert.equal(v({ confirmDuplicate: true }).value.confirmDuplicate, true);
  for (const x of ['true', 1, 'yes']) assert.equal(v({ confirmDuplicate: x }).value.confirmDuplicate, false);
  const r = v({ userId: 99, user_id: 99, bdeId: 99 });
  assert.equal('userId' in r.value || 'user_id' in r.value || 'bdeId' in r.value, false);
});
test('non-object bodies are rejected', () => { for (const b of [null, undefined, 'x', 5, []]) assert.equal(validateLead(b).ok, false); });
test('duplicate keys: formatting differences still match', () => {
  assert.equal(normalizePhoneKey('+91 98765 43210'), normalizePhoneKey('098765-43210'));
  assert.equal(normalizePhoneKey('98765 43210'), '9876543210');
  assert.equal(normalizePhoneKey('2345678'), '2345678');
  assert.equal(normalizeEmailKey('  A@B.com '), 'a@b.com');
});
test('addDays handles month/year/leap boundaries', () => {
  assert.equal(addDays('2026-10-10', 7), '2026-10-17'); assert.equal(addDays('2026-12-30', 7), '2027-01-06');
  assert.equal(addDays('2028-02-25', 5), '2028-03-01'); assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
