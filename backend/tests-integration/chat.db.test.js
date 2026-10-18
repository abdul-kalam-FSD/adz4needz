// Integration tests for the team chat: the REAL Express app talking to a REAL MySQL database over HTTP.
// NOT part of `npm test`. Run with: npm run test:db
// Needs backend/.env pointing at a DEVELOPMENT database where migrations 001-018 are applied (016-018 create the chat tables).
// Creates its own temporary users (employee IDs starting "itest-") and removes their messages and the users afterwards.
// Run it on a QUIET development database: the paging checks assume nobody else posts during the test.
//
// STATUS: written but NOT YET RUN by its author (the build environment had no MySQL and no installed packages).
// If something fails on first run, treat it as a defect in the test OR the code to investigate, not as proof either way.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createChatRepository } from '../src/modules/chat/chat.repository.js';
import { createChatService } from '../src/modules/chat/chat.service.js';

const PASSWORD = 'itest-' + randomBytes(9).toString('hex');
const tag = randomBytes(3).toString('hex');
const emp = Object.fromEntries(['admin', 'asha', 'ravi', 'gone'].map((k) => [k, 'itest-' + randomBytes(4).toString('hex')]));
const names = { admin: `Itest Admin ${tag}`, asha: `Itest Asha ${tag}`, ravi: `Itest Ravi ${tag}`, gone: `Itest Gone ${tag}` };
const handle = (k) => names[k].toLowerCase().replace(/\s+/g, '.');
const ids = {}; const jars = {};
let db, config, servers = [], base, baseLimited;

async function call(who, method, path, body, root = base) {
  const headers = { 'Content-Type': 'application/json' };
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(root + '/api' + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data, res };
}
const send = (who, body, extra = {}, root = base) => call(who, 'POST', '/chat/messages', { body, clientRequestId: randomUUID(), ...extra }, root);
const rows = (sql, params = []) => db.query(sql, params);
const start = async (cfg) => {
  const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const app = createApp({ config: cfg, authService, chatService: createChatService({ repo: createChatRepository(db) }), checkDb: () => db.query('SELECT 1') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

before(async () => {
  config = loadConfig(); db = createDb(config.db);
  base = await start({ ...config, loginRateLimitMax: 1000, chatSendRateLimitMax: 1000 });
  baseLimited = await start({ ...config, loginRateLimitMax: 1000, chatSendRateLimitMax: 3 });
  const hash = await hashPassword(PASSWORD);
  for (const [who, role, active] of [['admin', 'admin', 1], ['asha', 'bde', 1], ['ravi', 'bde', 1], ['gone', 'bde', 1]]) {
    const r = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())', [emp[who], names[who], hash, role, active]);
    ids[who] = r.insertId;
    const login = await call(null, 'POST', '/auth/login', { employeeId: emp[who], password: PASSWORD });
    assert.equal(login.status, 200, 'login failed for ' + who); jars[who] = login.res.headers.get('set-cookie').split(';')[0];
  }
  await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [ids.gone]); // "gone" keeps a valid session until it expires, but is no longer an active person
  // Start every test user at "everything so far is read", so unread counts only reflect this test (the database may hold other chat history).
  const latest = (await call('admin', 'GET', '/chat/unread')).data.latestId;
  if (latest > 0) for (const who of ['admin', 'asha', 'ravi']) await call(who, 'POST', '/chat/read', { upTo: latest });
});

after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  if (db) {
    const userIds = Object.values(ids);
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await db.query(`DELETE FROM chat_mentions WHERE user_id IN (${marks}) OR message_id IN (SELECT id FROM chat_messages WHERE sender_id IN (${marks}))`, [...userIds, ...userIds]); // children first
      await db.query(`DELETE FROM chat_reads WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM chat_messages WHERE sender_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM sessions WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await db.close();
  }
});

test('anonymous callers get 401 on every chat route', async () => {
  for (const [m, p] of [['GET', '/chat/members'], ['GET', '/chat/messages'], ['GET', '/chat/unread'], ['POST', '/chat/messages'], ['POST', '/chat/read']]) assert.equal((await call(null, m, p, {})).status, 401, `${m} ${p}`);
  assert.equal((await call('admin', 'DELETE', '/chat/messages/1', {})).status, 404, 'no delete route'); assert.equal((await call('admin', 'PUT', '/chat/messages', {})).status, 404);
});

test('sending persists exactly as designed: sender from the session, text verbatim (HTML is data), UTC time, and other users can read it', async () => {
  const evil = `<script>alert(1)</script> <img src=x onerror=alert(1)> "quoted" ${tag}`;
  const r = await call('asha', 'POST', '/chat/messages', { body: evil, clientRequestId: randomUUID(), senderId: ids.ravi, sender_id: ids.ravi, createdAt: '2001-01-01 00:00:00', id: 1, kind: 'message' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [row] = await rows('SELECT sender_id, kind, body, created_at FROM chat_messages WHERE id = ?', [r.data.message.id]);
  assert.equal(String(row.sender_id), String(ids.asha), 'the session decides the sender'); assert.equal(row.kind, 'message'); assert.equal(row.body, evil);
  assert.ok(row.created_at.startsWith(new Date().getUTCFullYear().toString()), 'created by the server clock, not the body');
  const seen = (await call('ravi', 'GET', '/chat/messages?limit=5')).data.messages.find((m) => m.id === r.data.message.id);
  assert.equal(seen.body, evil); assert.equal(seen.sender.name, names.asha); assert.equal(seen.mine, false);
  assert.equal((await call('asha', 'GET', '/chat/messages?limit=5')).data.messages.find((m) => m.id === r.data.message.id).mine, true);
});

test('announcements: a BDE is refused (403, nothing stored); an admin can post; BDEs see it flagged as an announcement', async () => {
  const before = (await rows('SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id = ?', [ids.asha]))[0].n;
  assert.equal((await send('asha', `sneaky ${tag}`, { kind: 'announcement' })).status, 403);
  assert.equal((await rows('SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id = ?', [ids.asha]))[0].n, before);
  const a = await send('admin', `Office closed Friday ${tag}`, { kind: 'announcement' }); assert.equal(a.status, 201);
  assert.equal((await rows('SELECT kind FROM chat_messages WHERE id = ?', [a.data.message.id]))[0].kind, 'announcement');
  const filtered = (await call('ravi', 'GET', '/chat/messages?kind=announcement&limit=50')).data.messages; assert.ok(filtered.length >= 1 && filtered.every((m) => m.kind === 'announcement'));
});

test('mentions: found by the server, stored with positions; inactive and unknown people are not mentions; members list has no employee IDs', async () => {
  const body = `hi @${handle('ravi')} and @${handle('gone')} and @nobody.${tag}`;
  const r = await send('asha', body); assert.equal(r.status, 201);
  assert.deepEqual(r.data.message.mentions.map((m) => m.userId), [ids.ravi]);
  const stored = await rows('SELECT user_id, start_pos, end_pos FROM chat_mentions WHERE message_id = ?', [r.data.message.id]);
  assert.equal(stored.length, 1); assert.equal(body.slice(stored[0].start_pos, stored[0].end_pos), '@' + handle('ravi'));
  assert.equal((await call('asha', 'POST', '/chat/messages', { body: 'no names', clientRequestId: randomUUID(), mentions: [{ userId: ids.ravi, start: 0, end: 2 }] })).data.message.mentions.length, 0, 'the client cannot claim a mention');
  const members = (await call('ravi', 'GET', '/chat/members')).data.members;
  assert.ok(members.some((m) => m.id === ids.asha) && !members.some((m) => m.id === ids.gone), 'inactive people are not listed');
  for (const m of members) assert.deepEqual(Object.keys(m).sort(), ['handle', 'id', 'name']);
  assert.ok(!JSON.stringify(members).includes(emp.admin), 'employee IDs are never listed');
});

test('the real unique key: the same send delivered five times AT ONCE creates exactly one message; a reused request id for another text is 409', async () => {
  const body = { body: `race ${tag}`, clientRequestId: randomUUID() };
  const results = await Promise.all(Array.from({ length: 5 }, () => call('asha', 'POST', '/chat/messages', body)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 201], JSON.stringify(results.map((r) => r.data)));
  assert.equal(new Set(results.map((r) => r.data.message.id)).size, 1);
  assert.equal((await rows('SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id = ? AND client_request_id = ?', [ids.asha, body.clientRequestId]))[0].n, 1);
  const reuse = await call('asha', 'POST', '/chat/messages', { ...body, body: 'different' }); assert.equal(reuse.status, 409); assert.equal(reuse.data.error.code, 'REQUEST_ID_REUSED');
});

test('validation: empty, too long, control characters, bad kind, bad request id are 400 and nothing is stored', async () => {
  const count = async () => (await rows('SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id = ?', [ids.asha]))[0].n;
  const before = await count();
  for (const b of [{ body: '' }, { body: '   ' }, { body: 'x'.repeat(2001) }, { body: 'a\u0000b' }, { body: 'ok', kind: 'shout' }, { body: 'ok', clientRequestId: 'nope' }]) assert.equal((await call('asha', 'POST', '/chat/messages', { clientRequestId: randomUUID(), ...b })).status, 400, JSON.stringify(b).slice(0, 40));
  assert.equal(await count(), before);
  assert.equal((await send('asha', 'x'.repeat(2000))).status, 201, 'exactly the limit is accepted'); assert.equal((await send('asha', '😀'.repeat(2000))).status, 201, '2000 emoji (4 bytes each) fit the column');
});

test('paging on real SQL: newest page, before= goes back without gaps, after= returns only newer, kind filter works inside paging', async () => {
  const sent = []; for (let i = 1; i <= 7; i++) sent.push((await send('ravi', `page${i} ${tag}`)).data.message);
  const p1 = (await call('asha', 'GET', '/chat/messages?limit=3')).data; assert.deepEqual(p1.messages.map((m) => m.id), sent.slice(4).map((m) => m.id)); assert.equal(p1.hasMore, true);
  const p2 = (await call('asha', 'GET', `/chat/messages?limit=3&before=${p1.messages[0].id}`)).data; assert.deepEqual(p2.messages.map((m) => m.id), sent.slice(1, 4).map((m) => m.id));
  const fresh = (await call('asha', 'GET', `/chat/messages?after=${sent[4].id}`)).data; assert.deepEqual(fresh.messages.map((m) => m.id), sent.slice(5).map((m) => m.id)); assert.equal(fresh.more, false);
  assert.deepEqual((await call('asha', 'GET', `/chat/messages?after=${sent[6].id}`)).data.messages, []);
  for (const q of ['limit=0', 'limit=101', 'after=abc', 'before=0', 'kind=x', `after=1&before=2`, 'limit=5;DROP']) assert.equal((await call('asha', 'GET', '/chat/messages?' + q)).status, 400, q);
});

test('unread and read cursors on real SQL: own messages never unread, mentions and announcements counted, cursor moves forward only and is clamped', async () => {
  const latest = (await call('admin', 'GET', '/chat/unread')).data.latestId; await call('ravi', 'POST', '/chat/read', { upTo: latest }); await call('asha', 'POST', '/chat/read', { upTo: latest }); // start this test fully caught up
  const m1 = (await send('asha', `plain ${tag}`)).data.message; const m2 = (await send('asha', `hey @${handle('ravi')} ${tag}`)).data.message; const a = (await send('admin', `ann ${tag}`, { kind: 'announcement' })).data.message;
  let u = (await call('ravi', 'GET', '/chat/unread')).data; assert.deepEqual(u.unread, { unread: 3, announcements: 1, mentions: 1 });
  assert.deepEqual((await call('asha', 'GET', '/chat/unread')).data.unread, { unread: 1, announcements: 1, mentions: 0 }, 'asha: only the announcement is unread (her own messages are not)');
  u = (await call('ravi', 'POST', '/chat/read', { upTo: m2.id })).data; assert.equal(u.lastReadMessageId, m2.id); assert.deepEqual(u.unread, { unread: 1, announcements: 1, mentions: 0 });
  assert.equal((await call('ravi', 'POST', '/chat/read', { upTo: m1.id })).data.lastReadMessageId, m2.id, 'never backwards');
  u = (await call('ravi', 'POST', '/chat/read', { upTo: a.id + 100000 })).data; assert.equal(u.lastReadMessageId, u.latestId, 'clamped to the newest message'); assert.equal(u.unread.unread, 0);
  assert.equal((await call('ravi', 'POST', '/chat/read', { upTo: 'x' })).status, 400); assert.equal((await call('ravi', 'POST', '/chat/read', {})).status, 400);
  assert.equal((await call('admin', 'GET', '/chat/unread')).data.unread.mentions, 0);
});

test('read-by on announcements: admin sees how many people read it; the sender and inactive people are not counted; BDEs never see it', async () => {
  const a = (await send('admin', `policy ${tag}`, { kind: 'announcement' })).data.message;
  const active = (await rows('SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND id <> ?', [ids.admin]))[0].n;
  assert.deepEqual(a.readBy, { count: 0, total: active });
  await call('asha', 'POST', '/chat/read', { upTo: a.id });
  const seen = (await call('admin', 'GET', `/chat/messages?after=${a.id - 1}&limit=5`)).data.messages.find((m) => m.id === a.id); assert.deepEqual(seen.readBy, { count: 1, total: active });
  assert.equal('readBy' in (await call('ravi', 'GET', `/chat/messages?after=${a.id - 1}`)).data.messages.find((m) => m.id === a.id), false);
});

test('rate limit: the 4th message within a minute is 429 for that person only (this app instance allows 3 per minute)', async () => {
  const codes = []; for (let i = 0; i < 4; i++) codes.push((await send('asha', `flood ${i} ${tag}`, {}, baseLimited)).status);
  assert.deepEqual(codes, [201, 201, 201, 429]);
  const limited = await send('asha', `flood again ${tag}`, {}, baseLimited); assert.equal(limited.data.error.code, 'TOO_MANY_MESSAGES');
  assert.equal((await send('ravi', `not limited ${tag}`, {}, baseLimited)).status, 201, 'the limit is per person');
  assert.equal((await call('asha', 'GET', '/chat/messages?limit=1', undefined, baseLimited)).status, 200, 'reading is not limited');
});
