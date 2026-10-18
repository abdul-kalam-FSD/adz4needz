import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, serializeCookie } from '../src/lib/cookies.js';
import { generateToken, hashToken } from '../src/lib/session-token.js';

test('parseCookies reads values, ignores junk, no prototype pollution', () => {
  const c = parseCookies('a=1; bde_session=abc%20def; broken; constructor=x');
  assert.equal(c.a, '1');
  assert.equal(c.bde_session, 'abc def');
  assert.equal(c.broken, undefined);
  assert.equal(parseCookies(undefined).anything, undefined);
  assert.equal(Object.getPrototypeOf(c), null);
});
test('session cookie is HttpOnly + SameSite=Lax; Secure only when asked', () => {
  const dev = serializeCookie('s', 'v', { maxAgeSeconds: 60, secure: false });
  const prod = serializeCookie('s', 'v', { maxAgeSeconds: 60, secure: true });
  assert.match(dev, /HttpOnly/); assert.match(dev, /SameSite=Lax/); assert.match(dev, /Max-Age=60/);
  assert.doesNotMatch(dev, /Secure/); assert.match(prod, /Secure/);
});
test('tokens are random, long, and hashed deterministically', () => {
  const a = generateToken(); const b = generateToken();
  assert.notEqual(a, b); assert.ok(a.length >= 43);
  assert.equal(hashToken(a), hashToken(a)); assert.equal(hashToken(a).length, 64);
  assert.notEqual(hashToken(a), a);
});
