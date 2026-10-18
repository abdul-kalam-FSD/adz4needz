import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayment, validateInstalment } from './validate-payment.js';

const ok = { leadId: 5, courseOrInternship: ' Full Stack Internship ', amountCommitted: '15000.50', commitmentDate: '2026-06-15' };

test('valid payment: values normalised, amount becomes BigInt paise', () => {
  const r = validatePayment(ok);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { leadId: '5', courseOrInternship: 'Full Stack Internship', amountCommitted: 1500050n, commitmentDate: '2026-06-15' });
});
test('leadId: required on create and a positive integer', () => {
  assert.ok(validatePayment({ ...ok, leadId: undefined }).errors.leadId);
  for (const bad of ['', 0, -1, 1.5, 'abc', '1; DROP TABLE leads', [], {}, '9'.repeat(19)]) assert.ok(validatePayment({ ...ok, leadId: bad }).errors.leadId, JSON.stringify(bad));
});
test('course or internship: required, no control characters, max 150', () => {
  for (const bad of ['', '   ', undefined, 5, 'a\u0000b', 'a\nb']) assert.ok(validatePayment({ ...ok, courseOrInternship: bad }).errors.courseOrInternship, JSON.stringify(bad));
  assert.equal(validatePayment({ ...ok, courseOrInternship: 'x'.repeat(150) }).ok, true);
  assert.ok(validatePayment({ ...ok, courseOrInternship: 'x'.repeat(151) }).errors.courseOrInternship);
});
test('committed amount: positive, max 2 decimals', () => {
  for (const bad of [undefined, '', 0, '0.00', -10, '12.345', 'abc', '1e5', '10000000000', null, true]) assert.ok(validatePayment({ ...ok, amountCommitted: bad }).errors.amountCommitted, JSON.stringify(bad));
  assert.equal(validatePayment({ ...ok, amountCommitted: 15000 }).value.amountCommitted, 1500000n);
});
test('commitment date: real calendar date only', () => {
  for (const bad of [undefined, '', '2026-02-30', '2026-13-01', '15/06/2026', '2026-6-1', '0999-01-01', 20260615, 'tomorrow']) assert.ok(validatePayment({ ...ok, commitmentDate: bad }).errors.commitmentDate, JSON.stringify(bad));
  assert.equal(validatePayment({ ...ok, commitmentDate: '2024-02-29' }).ok, true);
});
test('update ignores leadId; owner fields in the body are ignored; non-objects rejected', () => {
  const r = validatePayment({ ...ok, leadId: 999, userId: 77, user_id: 77, status: 'paid', amountPaid: '1' }, { forCreate: false });
  assert.equal(r.ok, true); assert.equal('leadId' in r.value, false);
  assert.equal(JSON.stringify(r.value, (k, v) => (typeof v === 'bigint' ? String(v) : v)).includes('77'), false);
  assert.equal('status' in r.value, false, 'status is derived, never accepted');
  for (const bad of [null, [], 'x', 5, undefined]) assert.equal(validatePayment(bad).ok, false);
});
test('instalment: amount and date required; confirmDuplicate only counts when exactly true', () => {
  const r = validateInstalment({ amount: '2500', paidOn: '2026-06-20' });
  assert.equal(r.ok, true); assert.deepEqual(r.value, { amount: 250000n, paidOn: '2026-06-20', confirmDuplicate: false });
  assert.equal(validateInstalment({ amount: 1, paidOn: '2026-06-20', confirmDuplicate: true }).value.confirmDuplicate, true);
  for (const v of ['true', 1, 'yes']) assert.equal(validateInstalment({ amount: 1, paidOn: '2026-06-20', confirmDuplicate: v }).value.confirmDuplicate, false);
  for (const bad of [{}, { amount: 0, paidOn: '2026-06-20' }, { amount: '1.999', paidOn: '2026-06-20' }, { amount: 5, paidOn: '2026-02-30' }, { amount: 5 }, { paidOn: '2026-06-20' }, { amount: -5, paidOn: '2026-06-20' }]) {
    assert.equal(validateInstalment(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(validateInstalment(null).ok, false);
});
