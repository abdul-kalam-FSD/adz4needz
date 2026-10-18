// The session-expiry hook in the API client, with fetch replaced by a stub (no network, no browser).
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, uploadReceipt, uploadImportFile, setUnauthorizedHandler, ApiError } from './client.js';

const realFetch = globalThis.fetch;
let fires;
const reply = (status, body) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { fires = 0; setUnauthorizedHandler(() => { fires++; }); });
afterEach(() => { globalThis.fetch = realFetch; setUnauthorizedHandler(null); });
const unauth = reply(401, { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } });

test('a protected call answered 401 UNAUTHENTICATED fires the handler once and still throws the ApiError', async () => {
  globalThis.fetch = unauth;
  await assert.rejects(api.listLeads('page=1'), (e) => e instanceof ApiError && e.status === 401 && e.code === 'UNAUTHENTICATED');
  assert.equal(fires, 1);
});
test('it fires for the call desk, uploads and every other protected path, not just one', async () => {
  globalThis.fetch = unauth;
  await assert.rejects(api.recordCall({})); await assert.rejects(api.callSummary()); await assert.rejects(api.monthlyReport('2026-10'));
  await assert.rejects(uploadReceipt(1, { name: 'a.pdf', type: 'application/pdf' })); await assert.rejects(uploadImportFile({ name: 'a.csv', type: 'text/csv' }));
  assert.equal(fires, 5);
});
test('a failed LOGIN (401 INVALID_CREDENTIALS) is NOT an expired session', async () => {
  globalThis.fetch = reply(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Employee ID or password is incorrect.' } });
  await assert.rejects(api.login('E1', 'wrong'), (e) => e.status === 401 && e.code === 'INVALID_CREDENTIALS');
  assert.equal(fires, 0);
});
test('the startup check (/auth/me) and logout never fire it, even on UNAUTHENTICATED', async () => {
  globalThis.fetch = unauth;
  await assert.rejects(api.me()); await assert.rejects(api.logout());
  assert.equal(fires, 0);
});
test('other failures (403, 404, 429, 500, network) and successes do not fire it', async () => {
  for (const s of [400, 403, 404, 409, 429, 500, 503]) { globalThis.fetch = reply(s, { error: { code: 'X', message: 'm' } }); await assert.rejects(api.listLeads('')); }
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(api.listLeads(''), (e) => e.status === 0 && e.code === 'NETWORK');
  globalThis.fetch = reply(200, { user: { id: 1 } }); await api.callSummary();
  globalThis.fetch = reply(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }); await assert.rejects(api.listLeads(''));
  assert.equal(fires, 0);
});
test('a 401 without the UNAUTHENTICATED code (for example a non-JSON proxy page) does not log anyone out', async () => {
  globalThis.fetch = async () => new Response('<html>Unauthorized</html>', { status: 401 });
  await assert.rejects(api.listLeads(''), (e) => e.status === 401);
  assert.equal(fires, 0);
});
test('with no handler registered nothing breaks; the handler can be removed', async () => {
  setUnauthorizedHandler(null); globalThis.fetch = unauth; await assert.rejects(api.listLeads('')); assert.equal(fires, 0);
  setUnauthorizedHandler('not a function'); await assert.rejects(api.listLeads('')); assert.equal(fires, 0);
});

// ---- team chat methods ----
function recorder(body = {}) { const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, creds: init.credentials }); return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }; return calls; }
test('chat methods use the right endpoint, method and body, and send the session cookie', async () => {
  const calls = recorder({ ok: true });
  await api.chatMembers(); await api.chatMessages('kind=all&limit=50'); await api.chatMessages(''); await api.chatUnread();
  await api.chatSend({ body: 'hi', kind: 'message', clientRequestId: 'abc' }); await api.chatRead(42);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET /api/chat/members', 'GET /api/chat/messages?kind=all&limit=50', 'GET /api/chat/messages', 'GET /api/chat/unread', 'POST /api/chat/messages', 'POST /api/chat/read']);
  assert.deepEqual(calls[4].body, { body: 'hi', kind: 'message', clientRequestId: 'abc' }); assert.deepEqual(calls[5].body, { upTo: 42 });
  assert.ok(calls.every((c) => c.creds === 'same-origin' || c.creds === 'include'), 'cookies are sent');
  assert.ok(calls.slice(0, 4).every((c) => c.body === undefined), 'reads send no body');
});
test('chat calls answered 401 UNAUTHENTICATED return the person to the sign-in screen like every other protected call', async () => {
  globalThis.fetch = unauth;
  await assert.rejects(api.chatUnread()); await assert.rejects(api.chatMessages('')); await assert.rejects(api.chatSend({})); await assert.rejects(api.chatRead(1));
  assert.equal(fires, 4);
});
test('a rate-limited send (429 TOO_MANY_MESSAGES) surfaces the server message and does not log anyone out', async () => {
  globalThis.fetch = reply(429, { error: { code: 'TOO_MANY_MESSAGES', message: 'You are sending messages too quickly. Please wait a moment.' } });
  await assert.rejects(api.chatSend({}), (e) => e.status === 429 && e.code === 'TOO_MANY_MESSAGES' && /too quickly/.test(e.message)); assert.equal(fires, 0);
});
