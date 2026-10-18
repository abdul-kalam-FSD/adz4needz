import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

test('hash is not the plain password and has the expected format', async () => {
  const h = await hashPassword('correct horse battery');
  assert.ok(!h.includes('correct horse'));
  assert.equal(h.split('$').length, 6);
  assert.ok(h.startsWith('scrypt$32768$8$1$'));
});
test('correct password verifies, wrong one does not', async () => {
  const h = await hashPassword('Secret-12345');
  assert.equal(await verifyPassword('Secret-12345', h), true);
  assert.equal(await verifyPassword('Secret-12346', h), false);
  assert.equal(await verifyPassword('', h), false);
});
test('same password gives different hashes (random salt)', async () => {
  assert.notEqual(await hashPassword('same-password-1'), await hashPassword('same-password-1'));
});
test('malformed or hostile stored hashes are rejected, not thrown', async () => {
  for (const bad of ['', 'plain', 'scrypt$1$2', 'bcrypt$a$b$c$d$e', 'scrypt$99999999999$8$1$AA==$AA==', 'scrypt$32768$8$1$AA==$', null, undefined]) {
    assert.equal(await verifyPassword('x', bad), false);
  }
});
