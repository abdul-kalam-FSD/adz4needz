// Regression for the "Unknown column 'c.kind'" / "Unknown column 'last_read_message_id'" failure.
// Unlike chat.db.test.js (HTTP level) this talks to the REAL chat repository and to information_schema directly, so a database whose
// chat tables have the OLD shape fails here with the original MySQL error instead of a vague 500.
// NOT part of `npm test`. Run with: npm run test:db   (needs backend/.env pointing at a DEVELOPMENT/scratch database, migrations applied)
// Creates users with employee IDs starting "shape-" and removes everything it created.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { createChatRepository } from '../src/modules/chat/chat.repository.js';

const tag = randomBytes(4).toString('hex');
let db, repo; const ids = []; const msgIds = [];
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const mkUser = async (label) => {
  const r = await db.query("INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, 'x', 'bde', 1, UTC_TIMESTAMP())", [`shape-${tag}-${label}`, `Shape ${label} ${tag}`]);
  ids.push(Number(r.insertId)); return Number(r.insertId);
};
const post = async (senderId, kind, body) => {
  const id = await repo.insertMessage({ senderId, kind, body, clientRequestId: randomUUID(), createdAt: now(), mentions: [] });
  msgIds.push(id); return id;
};
const columns = async (table) => (await db.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?', [table])).map((r) => r.c);

before(async () => { db = createDb(loadConfig().db); repo = createChatRepository(db); });
after(async () => {
  if (!db) return;
  if (msgIds.length) { const m = msgIds.map(() => '?').join(','); await db.query(`DELETE FROM chat_mentions WHERE message_id IN (${m})`, msgIds); await db.query(`DELETE FROM chat_messages WHERE id IN (${m})`, msgIds); }
  if (ids.length) { const m = ids.map(() => '?').join(','); await db.query(`DELETE FROM chat_reads WHERE user_id IN (${m})`, ids); await db.query(`DELETE FROM users WHERE id IN (${m})`, ids); }
  await db.close();
});

test('live schema: the chat tables have exactly the columns the repository needs, and none of the old direct-message design', async () => {
  const messages = await columns('chat_messages'); const reads = await columns('chat_reads'); const mentions = await columns('chat_mentions');
  for (const c of ['id', 'sender_id', 'kind', 'body', 'client_request_id', 'created_at']) assert.ok(messages.includes(c), `chat_messages.${c} missing`);
  assert.ok(!messages.includes('recipient_id'), 'chat_messages still has the old direct-message column recipient_id; run: npm run chat:schema');
  for (const c of ['user_id', 'last_read_message_id', 'updated_at']) assert.ok(reads.includes(c), `chat_reads.${c} missing`);
  assert.ok(!reads.includes('peer_id') && !reads.includes('last_read_id'), 'chat_reads still has the old design columns; run: npm run chat:schema');
  for (const c of ['message_id', 'start_pos', 'end_pos', 'user_id']) assert.ok(mentions.includes(c), `chat_mentions.${c} missing`);
});

test('conversation listing: page() runs on the live schema (the c.kind query), newest first, oldest first after=, announcement filter, before= paging', async () => {
  const a = await mkUser('a'); const b = await mkUser('b');
  const m1 = await post(a, 'message', 'one'); const m2 = await post(b, 'announcement', 'two'); const m3 = await post(a, 'message', 'three');
  const newest = await repo.page({ kind: 'message', limit: 3 });
  assert.deepEqual(newest.map((r) => Number(r.id)), [m3, m2, m1], 'newest first');
  assert.deepEqual(newest.map((r) => r.kind), ['message', 'announcement', 'message']);
  assert.ok(newest.every((r) => typeof r.sender_name === 'string' && r.sender_role === 'bde'));
  assert.deepEqual((await repo.page({ kind: 'message', afterId: m1, limit: 10 })).map((r) => Number(r.id)).filter((id) => msgIds.includes(id)), [m2, m3], 'after= is oldest first');
  assert.deepEqual((await repo.page({ kind: 'message', beforeId: m3, limit: 2 })).map((r) => Number(r.id)), [m2, m1], 'before= goes back without gaps');
  assert.deepEqual((await repo.page({ kind: 'announcement', afterId: m1 - 1, limit: 50 })).map((r) => Number(r.id)).filter((id) => msgIds.includes(id)), [m2], 'announcement filter');
});

test('read cursors: a new user is at 0, advanceCursor only moves forward and never overwrites with a lower value, one row per user', async () => {
  const u = await mkUser('cursor');
  assert.equal(await repo.readCursor(u), 0, 'no row = read nothing');
  await repo.advanceCursor(u, 50, now()); assert.equal(await repo.readCursor(u), 50);
  await repo.advanceCursor(u, 20, now()); assert.equal(await repo.readCursor(u), 50, 'cursor never moves backwards');
  await repo.advanceCursor(u, 90, now()); assert.equal(await repo.readCursor(u), 90);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM chat_reads WHERE user_id = ?', [u]))[0].n, 1);
});

test('unread status: own messages are never unread, announcements are counted, and reading up to the newest message clears the count', async () => {
  const reader = await mkUser('reader'); const other = await mkUser('other');
  const base = await repo.latestId(); await repo.advanceCursor(reader, base, now());
  const x1 = await post(other, 'message', 'hello'); await post(other, 'announcement', 'notice'); await post(reader, 'message', 'my own');
  let counts = await repo.unreadCounts(reader, await repo.readCursor(reader));
  assert.equal(counts.unread, 2, 'two from the other person, own message excluded'); assert.equal(counts.announcements, 1);
  await repo.advanceCursor(reader, x1, now());
  counts = await repo.unreadCounts(reader, await repo.readCursor(reader));
  assert.equal(counts.unread, 1, 'only the announcement is still newer than the cursor');
  await repo.advanceCursor(reader, await repo.latestId(), now());
  counts = await repo.unreadCounts(reader, await repo.readCursor(reader));
  assert.deepEqual(counts, { unread: 0, announcements: 0, mentions: 0 });
  const cursors = await repo.activeCursors(); const mine = cursors.find((c) => c.userId === reader);
  assert.ok(mine && mine.cursor === (await repo.latestId()), 'activeCursors (admin read-by) sees the same cursor');
});
