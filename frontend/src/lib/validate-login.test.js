import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLogin, loginFailure, safeDestination, LOGIN_NOTICES, MAX_LOGIN_ID_LENGTH, MAX_PASSWORD_LENGTH } from './validate-login.js';

test('limits match the server (64 for the ID, 200 for the password)', () => { assert.equal(MAX_LOGIN_ID_LENGTH, 64); assert.equal(MAX_PASSWORD_LENGTH, 200); });

test('validateLogin: a good form passes; the ID is trimmed and the password is NEVER trimmed or changed', () => {
  const r = validateLogin({ employeeId: '  EMP-001 ', password: ' pass with spaces ' });
  assert.equal(r.ok, true); assert.deepEqual(r.errors, {}); assert.equal(r.value.employeeId, 'EMP-001');
});
test('validateLogin: blank and missing fields get one message each', () => {
  for (const f of [{ employeeId: '', password: '' }, { employeeId: '   ', password: 'x' }, {}, { employeeId: null, password: null }, { employeeId: 5, password: 5 }]) {
    const r = validateLogin(f); assert.equal(r.ok, false);
    assert.equal(r.errors.employeeId, 'Enter your employee ID.'); if (f.password !== 'x') assert.equal(r.errors.password, 'Enter your password.');
  }
  assert.equal(validateLogin({ employeeId: 'E1', password: '' }).errors.employeeId, undefined);
  assert.equal(validateLogin({ employeeId: '', password: 'secret' }).errors.password, undefined);
});
test('validateLogin: an email address is explained, not sent (sign-in is by employee ID only)', () => {
  const r = validateLogin({ employeeId: 'asha@example.com', password: 'x' });
  assert.equal(r.ok, false); assert.equal(r.errors.employeeId, 'Sign in with your employee ID, not your email address.');
});
test('validateLogin: length limits and spaces inside the ID', () => {
  assert.equal(validateLogin({ employeeId: 'E'.repeat(64), password: 'x' }).ok, true);
  assert.match(validateLogin({ employeeId: 'E'.repeat(65), password: 'x' }).errors.employeeId, /too long/);
  assert.match(validateLogin({ employeeId: 'EMP 001', password: 'x' }).errors.employeeId, /no spaces/);
  assert.match(validateLogin({ employeeId: 'EMP\t1', password: 'x' }).errors.employeeId, /no spaces/);
  assert.equal(validateLogin({ employeeId: 'E1', password: 'p'.repeat(200) }).ok, true);
  assert.match(validateLogin({ employeeId: 'E1', password: 'p'.repeat(201) }).errors.password, /too long/);
});
test('validateLogin: legacy-looking IDs are not blocked by a pattern the server may not share (the server decides)', () => {
  for (const id of ['EMP001', 'emp.001', 'a_b-c', 'ÅSHA1', '123']) assert.equal(validateLogin({ employeeId: id, password: 'x' }).ok, true, id);
});

test('loginFailure: each failure kind gets one plain sentence and never exposes server internals', () => {
  assert.equal(loginFailure({ status: 0 }).kind, 'network'); assert.match(loginFailure({ status: 0 }).message, /Could not reach the server/);
  assert.equal(loginFailure({ status: 401, code: 'INVALID_CREDENTIALS', message: 'x' }).kind, 'credentials');
  assert.match(loginFailure({ status: 401 }).message, /incorrect/);
  assert.equal(loginFailure({ status: 429 }).kind, 'rate'); assert.match(loginFailure({ status: 429 }).message, /wait a few minutes/);
  assert.equal(loginFailure({ status: 400, message: 'Enter your employee ID and password.' }).kind, 'validation');
  for (const status of [500, 502, 503]) { const f = loginFailure({ status, message: 'ER_ACCESS_DENIED stack trace' }); assert.equal(f.kind, 'server'); assert.ok(!/ER_|stack/.test(f.message)); }
  for (const bad of [null, undefined, {}, new Error('x'), { status: 'x' }, { status: 418 }]) assert.equal(loginFailure(bad).kind, 'unknown');
});
test('loginFailure: wrong password and unknown ID read the same (no account enumeration)', () => {
  assert.equal(loginFailure({ status: 401, code: 'INVALID_CREDENTIALS' }).message, loginFailure({ status: 401, code: 'INVALID_CREDENTIALS', message: 'other' }).message);
});

test('safeDestination: only paths inside the app; everything else goes home', () => {
  assert.equal(safeDestination('/leads'), '/leads'); assert.equal(safeDestination('/admin/reports?month=2026-10'), '/admin/reports?month=2026-10'); assert.equal(safeDestination('/'), '/');
  for (const bad of [undefined, null, '', 5, 'leads', 'https://evil.example/', '//evil.example', '/\\evil.example', '/login', '/login?x=1', 'javascript:alert(1)', '/ok\nSet-Cookie: x', '/a\\b']) assert.equal(safeDestination(bad), '/', String(bad));
});
test('notices: a message for signing out and for an ended session, each with a tone', () => {
  assert.equal(LOGIN_NOTICES.signed_out.tone, 'success'); assert.match(LOGIN_NOTICES.signed_out.text, /signed out/);
  assert.equal(LOGIN_NOTICES.expired.tone, 'info'); assert.match(LOGIN_NOTICES.expired.text, /session has ended/);
});
