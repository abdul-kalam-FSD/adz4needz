import test from 'node:test';
import assert from 'node:assert/strict';
import { describePasswordFailure, fieldsToClear } from './profile-messages.js';

const err = (code, status = 500) => ({ code, status });

test('heading never contradicts the server: "changed" only when the server says it WAS changed', () => {
  assert.match(describePasswordFailure(err('SESSIONS_NOT_FULLY_CLOSED')).lead, /^Password changed, but/);
  for (const code of ['PASSWORD_UPDATE_UNCONFIRMED']) assert.match(describePasswordFailure(err(code)).lead, /not confirmed/);
  for (const code of ['SESSION_INVALIDATION_FAILED', 'PASSWORD_UPDATE_FAILED', 'PASSWORD_CHANGED_CONCURRENTLY']) assert.equal(describePasswordFailure(err(code)).lead, 'Password not changed.', code);
  for (const e of [err('VALIDATION_ERROR', 400), err('TOO_MANY_ATTEMPTS', 429), err('UNAUTHENTICATED', 401), { code: 'X', status: 401 }]) assert.equal(describePasswordFailure(e).lead, 'Password not changed.');
});
test('network failures and unknown server errors are "not confirmed", with advice on how to find out', () => {
  for (const e of [err('NETWORK', 0), err('INTERNAL_ERROR', 500), err('ERROR', 502), undefined, null]) {
    const d = describePasswordFailure(e);
    assert.match(d.lead, /not confirmed/);
    assert.match(d.hint, /new password first/);
    assert.ok(!/not changed/i.test(d.lead));
  }
});
test('no heading or hint mentions an admin clearing sessions', () => {
  for (const code of ['SESSIONS_NOT_FULLY_CLOSED', 'PASSWORD_UPDATE_UNCONFIRMED', 'PASSWORD_UPDATE_FAILED', 'NETWORK', 'PASSWORD_CHANGED_CONCURRENTLY']) {
    const d = describePasswordFailure(err(code, 500));
    assert.ok(!/admin/i.test(d.lead + d.hint), code);
  }
});
test('after a rejected attempt the current password is always cleared; a plain 400 keeps the new-password fields, anything else clears all', () => {
  assert.deepEqual(fieldsToClear({ status: 400, fields: { currentPassword: 'x' } }), ['currentPassword']);
  assert.deepEqual(fieldsToClear({ status: 400, fields: { newPassword: 'x' } }), ['currentPassword']);
  for (const e of [{ status: 500 }, { status: 409 }, { status: 0 }, { status: 400, fields: {} }, { status: 400 }, {}]) {
    assert.deepEqual(fieldsToClear(e), ['currentPassword', 'newPassword', 'confirmPassword']);
  }
  assert.ok(fieldsToClear({ status: 400, fields: { a: 1 } }).includes('currentPassword'));
});
