import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUserRepository } from '../src/modules/users/users.repository.js';

function fakeDb(results = []) {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); const r = results.shift(); if (r instanceof Error) throw r; return r; } };
}

test('findProfileById: selects public columns only (never password_hash), parameterized by the id', async () => {
  const db = fakeDb([[{ id: 7, employee_id: 'E7' }]]);
  const row = await createUserRepository(db).findProfileById(7);
  assert.equal(row.id, 7);
  assert.ok(!/password_hash/i.test(db.calls[0].sql));
  assert.deepEqual(db.calls[0].params, [7]);
  assert.match(db.calls[0].sql, /WHERE id = \?/);
});
test('findProfileById: unknown user -> null', async () => {
  assert.equal(await createUserRepository(fakeDb([[]])).findProfileById(1), null);
});
test('findPasswordHashById: returns only the hash string, or null', async () => {
  assert.equal(await createUserRepository(fakeDb([[{ password_hash: 'h' }]])).findPasswordHashById(1), 'h');
  assert.equal(await createUserRepository(fakeDb([[]])).findPasswordHashById(1), null);
});
test('updateContact: fixed columns, values only as parameters, scoped to the user id', async () => {
  const db = fakeDb([{ affectedRows: 1 }]);
  const n = await createUserRepository(db).updateContact(5, { phone: '9876543210', email: 'a@b.co' });
  assert.equal(n, 1);
  assert.equal(db.calls[0].sql, 'UPDATE users SET phone = ?, email = ? WHERE id = ?');
  assert.deepEqual(db.calls[0].params, ['9876543210', 'a@b.co', 5]);
});
test('updatePasswordHash is a compare-and-set (BINARY comparison of the verified hash); deleteOtherSessions: exact SQL and parameter order', async () => {
  const db = fakeDb([{ affectedRows: 1 }, { affectedRows: 3 }]);
  const repo = createUserRepository(db);
  assert.equal(await repo.updatePasswordHash(5, 'NEWHASH', 'VERIFIEDHASH'), 1);
  assert.equal(await repo.deleteOtherSessions(5, 'KEEP'), 3);
  assert.equal(db.calls[0].sql, 'UPDATE users SET password_hash = ? WHERE id = ? AND BINARY password_hash = ?');
  assert.deepEqual(db.calls[0].params, ['NEWHASH', 5, 'VERIFIEDHASH']);
  assert.equal(db.calls[1].sql, 'DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?');
  assert.deepEqual(db.calls[1].params, [5, 'KEEP']);
});
test('updatePasswordHash: 0 means "no row matched" (the hash changed in between) and is returned as 0, not as an error', async () => {
  assert.equal(await createUserRepository(fakeDb([{ affectedRows: 0 }])).updatePasswordHash(5, 'N', 'V'), 0);
});
test('updatePasswordHash can never run as an unconditional update: a missing expected hash is refused before any SQL', async () => {
  for (const expected of [undefined, null, '', 5]) {
    const db = fakeDb([{ affectedRows: 1 }]);
    await assert.rejects(createUserRepository(db).updatePasswordHash(5, 'N', expected), TypeError);
    assert.equal(db.calls.length, 0);
  }
});
test('write helpers return 0 for "nothing matched" and null when the driver result is not a write result', async () => {
  const repo = createUserRepository(fakeDb([{ affectedRows: 0 }, undefined, [], 'ok', { affectedRows: '1' }]));
  assert.equal(await repo.deleteOtherSessions(1, 'k'), 0);
  for (let i = 0; i < 4; i++) assert.equal(await repo.deleteOtherSessions(1, 'k'), null, 'case ' + i);
});
test('database errors propagate (the service decides what to do)', async () => {
  const boom = Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
  await assert.rejects(createUserRepository(fakeDb([boom])).findProfileById(1), /db down/);
});
test('repository source: every query is a plain string literal (no values interpolated into SQL)', () => {
  const src = readFileSync(new URL('../src/modules/users/users.repository.js', import.meta.url), 'utf8');
  assert.ok(!/\$\{/.test(src), 'no template interpolation anywhere in the repository');
  assert.ok(!/query\(\s*`/.test(src), 'no template-literal SQL');
});
