import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInterview, OUTCOME_REQUIRES_ATTENDANCE } from './validate-interview.js';

const ok = { leadId: 5, scheduledAt: '2026-06-15T14:30', attendance: 'pending', outcome: 'pending', interestedInJoining: null };

test('valid create: values are normalised', () => {
  const r = validateInterview(ok);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { leadId: '5', scheduledAt: '2026-06-15 14:30:00', attendance: 'pending', outcome: 'pending', interestedInJoining: null });
});
test('create: optional fields get defaults', () => {
  const r = validateInterview({ leadId: '7', scheduledAt: '2026-06-15 09:05' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { leadId: '7', scheduledAt: '2026-06-15 09:05:00', attendance: 'pending', outcome: 'pending', interestedInJoining: null });
});
test('leadId: required on create; must be a positive integer', () => {
  assert.ok(validateInterview({ ...ok, leadId: undefined }).errors.leadId);
  for (const bad of ['', 0, -1, 1.5, 'abc', '1; DROP TABLE leads', '0', [], {}, '9'.repeat(19)]) assert.ok(validateInterview({ ...ok, leadId: bad }).errors.leadId, JSON.stringify(bad));
  assert.equal(validateInterview({ ...ok, leadId: ' 12 ' }).value.leadId, '12');
});
test('scheduledAt: required, real date, real time, minute precision', () => {
  assert.ok(validateInterview({ ...ok, scheduledAt: '' }).errors.scheduledAt);
  assert.ok(validateInterview({ ...ok, scheduledAt: undefined }).errors.scheduledAt);
  for (const bad of ['2026-06-15', '2026-02-30T10:00', '2026-13-01T10:00', '2026-06-15T24:00', '2026-06-15T10:60', '15/06/2026 10:00', '2026-06-15T10:00:30', '0999-01-01T10:00', 20260615, null, {}]) {
    assert.ok(validateInterview({ ...ok, scheduledAt: bad }).errors.scheduledAt, JSON.stringify(bad));
  }
  assert.equal(validateInterview({ ...ok, scheduledAt: '2026-06-15T23:59' }).ok, true);
  assert.equal(validateInterview({ ...ok, scheduledAt: '2024-02-29T00:00:00' }).value.scheduledAt, '2024-02-29 00:00:00', 'leap day, explicit :00 seconds');
  assert.equal(validateInterview({ ...ok, scheduledAt: '2020-01-01T10:00' }).ok, true, 'past dates are allowed (back-entry)');
});
test('attendance / outcome only accept the listed values', () => {
  for (const v of ['pending', 'attended', 'did_not_attend']) assert.equal(validateInterview({ ...ok, attendance: v }).ok, true);
  for (const bad of ['Attended', 'absent', '', null, 1, true]) assert.ok(validateInterview({ ...ok, attendance: bad }).errors.attendance, JSON.stringify(bad));
  for (const bad of ['Selected', 'rejected', '', null, 0]) assert.ok(validateInterview({ ...ok, outcome: bad }).errors.outcome, JSON.stringify(bad));
});
test('outcome needs attendance = attended (documented assumption, one constant)', () => {
  assert.equal(OUTCOME_REQUIRES_ATTENDANCE, true);
  assert.ok(validateInterview({ ...ok, attendance: 'pending', outcome: 'selected' }).errors.outcome);
  assert.ok(validateInterview({ ...ok, attendance: 'did_not_attend', outcome: 'not_selected' }).errors.outcome);
  assert.equal(validateInterview({ ...ok, attendance: 'attended', outcome: 'selected' }).ok, true);
  assert.equal(validateInterview({ ...ok, attendance: 'attended', outcome: 'not_selected' }).ok, true);
  assert.equal(validateInterview({ ...ok, attendance: 'did_not_attend', outcome: 'pending' }).ok, true);
});
test('interestedInJoining is true / false / null only', () => {
  for (const v of [true, false, null]) assert.equal(validateInterview({ ...ok, interestedInJoining: v }).value.interestedInJoining, v);
  for (const bad of ['yes', 'true', 1, 0, '']) assert.ok(validateInterview({ ...ok, interestedInJoining: bad }).errors.interestedInJoining, JSON.stringify(bad));
});
test('Phase 6: paymentConfirmed is derived from payments, so a value in the body is ignored (never an error, never stored)', () => {
  for (const v of [true, false, 'yes', 1, null, 'garbage']) {
    const r = validateInterview({ ...ok, paymentConfirmed: v });
    assert.equal(r.ok, true, JSON.stringify(v));
    assert.equal('paymentConfirmed' in r.value, false);
  }
});
test('update: every field must be sent (no silent resets); leadId is ignored', () => {
  const r = validateInterview({ scheduledAt: '2026-06-15T10:00' }, { forCreate: false });
  assert.equal(r.ok, false);
  for (const k of ['attendance', 'outcome', 'interestedInJoining']) assert.ok(r.errors[k], k);
  const full = validateInterview({ ...ok, leadId: 999 }, { forCreate: false });
  assert.equal(full.ok, true);
  assert.equal('leadId' in full.value, false);
});
test('owner / user fields in the body are ignored; non-object bodies rejected', () => {
  const r = validateInterview({ ...ok, userId: 99, user_id: 99, bdeId: 99 });
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.value).includes('99'), false);
  for (const bad of [null, [], 'x', 5, undefined]) assert.equal(validateInterview(bad).ok, false);
});
