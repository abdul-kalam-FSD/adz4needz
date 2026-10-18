import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserHandlers } from '../src/modules/users/users.handlers.js';

const res = () => { const r = { code: null, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const config = { cookieName: 'bde_session' };
const user = { id: 7, role: 'bde' };

test('profile: responds 200 with { profile } for req.user only', async () => {
  const seen = [];
  const h = createUserHandlers({ userService: { getProfile: async (u) => { seen.push(u); return { id: 7 }; } }, config });
  const r = res(); await h.profile({ user, query: { id: '99' }, params: { id: '99' } }, r);
  assert.equal(r.code, 200); assert.deepEqual(r.body, { profile: { id: 7 } });
  assert.deepEqual(seen, [user], 'ids in the query or URL are ignored');
});
test('updateProfile: passes req.user and req.body to the service', async () => {
  const seen = [];
  const h = createUserHandlers({ userService: { updateProfile: async (u, b) => { seen.push([u, b]); return { id: 7, phone: 'x' }; } }, config });
  const r = res(); await h.updateProfile({ user, body: { phone: '9876543210' } }, r);
  assert.equal(r.code, 200); assert.deepEqual(seen, [[user, { phone: '9876543210' }]]);
});
test('changePassword: takes the caller token from the session cookie and never echoes passwords', async () => {
  const seen = [];
  const h = createUserHandlers({ userService: { changePassword: async (u, t, b) => { seen.push([u, t, b]); return { changed: true }; } }, config });
  const r = res();
  await h.changePassword({ user, headers: { cookie: 'x=1; bde_session=tok-123; y=2' }, body: { currentPassword: 'AAAA-old-1', newPassword: 'BBBB-new-2222' } }, r);
  assert.equal(r.code, 200); assert.equal(r.body.changed, true);
  assert.equal(seen[0][1], 'tok-123');
  const out = JSON.stringify(r.body);
  assert.ok(!out.includes('AAAA-old-1') && !out.includes('BBBB-new-2222') && !/token|hash/i.test(out));
});
test('changePassword: a cookie with another name is not used as the session token', async () => {
  const seen = [];
  const h = createUserHandlers({ userService: { changePassword: async (u, t) => { seen.push(t); return {}; } }, config });
  await h.changePassword({ user, headers: { cookie: 'other=abc' }, body: {} }, res());
  assert.equal(seen[0], undefined);
});
test('service errors propagate to the error handler (asyncHandler) instead of being swallowed', async () => {
  const h = createUserHandlers({ userService: { getProfile: async () => { throw new Error('boom'); } }, config });
  await assert.rejects(h.profile({ user }, res()), /boom/);
});
test('changePassword response: says what is known (changed; sessions already open were signed out) and promises nothing about in-flight logins', async () => {
  const h = createUserHandlers({ userService: { changePassword: async () => ({ changed: true }) }, config });
  const r = res(); await h.changePassword({ user, headers: { cookie: 'bde_session=t' }, body: {} }, r);
  assert.match(r.body.message, /^Your password was changed\./);
  assert.match(r.body.message, /already open/);
  assert.ok(!/\b(all|every|everywhere)\b/i.test(r.body.message), r.body.message);
  assert.ok(!/admin/i.test(r.body.message));
});
