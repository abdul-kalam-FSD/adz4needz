// The real chat repository on a RECORDING fake database: every statement's placeholders must match its parameters, only the validated LIMIT is
// put into SQL text, writes are transactional, and nothing is ever deleted. It checks the SQL TEXT; it does not execute it (no MySQL here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatRepository } from '../src/modules/chat/chat.repository.js';

const placeholders = (sql) => (sql.match(/\?/g) || []).length;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
function recording(answer = () => []) {
  const log = []; const txLog = []; let committed = false; let rolledBack = false;
  const run = (sink) => async (sql, params = []) => { const s = norm(sql); sink.push({ sql: s, params }); assert.equal(placeholders(sql), params.length, 'placeholders vs params: ' + s.slice(0, 70)); return answer(s, params); };
  const db = {
    log, txLog, get committed() { return committed; }, get rolledBack() { return rolledBack; },
    query: run(log),
    async transaction(fn) { try { const r = await fn({ query: run(txLog) }); committed = true; return r; } catch (e) { rolledBack = true; throw e; } }
  };
  return db;
}

test('every statement has matching placeholders and parameters, and uses no string-built values', async () => {
  const db = recording((s) => (s.startsWith('INSERT INTO chat_messages') ? { insertId: 5 } : s.includes('COUNT(*)') ? [{ unread: 3, announcements: 1 }] : s.includes('COUNT(DISTINCT') ? [{ mentions: 2 }] : s.includes('MAX(id)') ? [{ latest: 9 }] : []));
  const r = createChatRepository(db);
  await r.activeUsers(); await r.findByRequestId(1, 'rid'); await r.insertMessage({ senderId: 1, kind: 'message', body: 'b', clientRequestId: 'r', createdAt: '2026-10-14 05:00:00', mentions: [{ start: 0, end: 3, userId: 2 }, { start: 5, end: 9, userId: 3 }] });
  await r.page({ kind: 'all', afterId: null, beforeId: null, limit: 51 }); await r.page({ kind: 'announcement', afterId: 4, beforeId: null, limit: 200 }); await r.page({ kind: 'all', afterId: null, beforeId: 8, limit: 11 });
  await r.byIds([1, 2, 3]); await r.mentionsFor([1, 2]); await r.latestId(); await r.readCursor(1); await r.advanceCursor(1, 7, '2026-10-14 05:00:00'); await r.unreadCounts(1, 4); await r.activeCursors();
  assert.ok(db.log.length + db.txLog.length >= 17);
  for (const q of [...db.log, ...db.txLog]) assert.ok(!/\$\{|' \+ |" \+ /.test(q.sql), 'no concatenated values: ' + q.sql.slice(0, 60));
});
test('page(): the LIMIT is a validated integer in the text; bad values are refused before any query; direction follows after/before', async () => {
  const db = recording(); const r = createChatRepository(db);
  await r.page({ kind: 'all', afterId: null, beforeId: null, limit: 51 }); assert.match(db.log[0].sql, /ORDER BY c\.id DESC LIMIT 51$/); assert.deepEqual(db.log[0].params, []);
  await r.page({ kind: 'announcement', afterId: 4, beforeId: null, limit: 200 }); assert.match(db.log[1].sql, /WHERE c\.kind = 'announcement' AND c\.id > \? ORDER BY c\.id ASC LIMIT 200$/); assert.deepEqual(db.log[1].params, [4]);
  await r.page({ kind: 'all', afterId: null, beforeId: 8, limit: 11 }); assert.match(db.log[2].sql, /WHERE c\.id < \? ORDER BY c\.id DESC LIMIT 11$/);
  for (const limit of [0, -1, 1.5, '5; DROP TABLE users', NaN, 1001, null, undefined]) await assert.rejects(r.page({ kind: 'all', afterId: null, beforeId: null, limit }), /invalid limit/, String(limit));
  assert.equal(db.log.length, 3, 'nothing ran for the bad limits');
});
test('the announcement filter is a constant in the SQL, never a parameter', async () => {
  const db = recording(); await createChatRepository(db).page({ kind: 'announcement', afterId: null, beforeId: null, limit: 5 });
  assert.match(db.log[0].sql, /c\.kind = 'announcement'/); assert.deepEqual(db.log[0].params, []);
});
test('insertMessage: the message and ALL its mentions are written inside one transaction; a failure rolls everything back', async () => {
  const db = recording((s) => (s.startsWith('INSERT INTO chat_messages') ? { insertId: 42 } : [])); const r = createChatRepository(db);
  const id = await r.insertMessage({ senderId: 7, kind: 'announcement', body: 'x', clientRequestId: 'rid', createdAt: '2026-10-14 05:00:00', mentions: [{ start: 0, end: 4, userId: 2 }, { start: 6, end: 10, userId: 3 }] });
  assert.equal(id, 42); assert.equal(db.log.length, 0, 'nothing outside the transaction'); assert.equal(db.committed, true);
  assert.equal(db.txLog.length, 3); assert.deepEqual(db.txLog[0].params, [7, 'announcement', 'x', 'rid', '2026-10-14 05:00:00']);
  assert.deepEqual(db.txLog[1].params, [42, 0, 4, 2]); assert.deepEqual(db.txLog[2].params, [42, 6, 10, 3]);
  const failing = recording((s) => { if (s.startsWith('INSERT INTO chat_mentions')) throw new Error('disk full'); return { insertId: 1 }; });
  await assert.rejects(createChatRepository(failing).insertMessage({ senderId: 1, kind: 'message', body: 'x', clientRequestId: 'r', createdAt: 't', mentions: [{ start: 0, end: 1, userId: 2 }] }), /disk full/);
  assert.equal(failing.rolledBack, true); assert.equal(failing.committed, false);
});
test('the sender and the active-user rules are in SQL: ownership of the cursor is by user id, unread excludes the viewer\'s own messages', async () => {
  const db = recording((s) => (s.includes('COUNT(*)') ? [{ unread: 0, announcements: 0 }] : [{ mentions: 0 }])); const r = createChatRepository(db);
  await r.unreadCounts(10, 4);
  assert.match(db.log[0].sql, /WHERE id > \? AND sender_id <> \?/); assert.deepEqual(db.log[0].params, [4, 10]);
  assert.match(db.log[1].sql, /m\.user_id = \? AND m\.message_id > \? AND c\.sender_id <> \?/); assert.deepEqual(db.log[1].params, [10, 4, 10]);
  assert.match(db.log[0].sql, /COUNT\(CASE WHEN kind = 'announcement' THEN 1 END\)/, 'COUNT not SUM (the driver returns SUM as text)');
});
test('advanceCursor: forward only (GREATEST), a row is created once without overwriting, no deprecated upsert syntax', async () => {
  const db = recording(); await createChatRepository(db).advanceCursor(3, 12, '2026-10-14 05:00:00');
  assert.match(db.log[0].sql, /^INSERT IGNORE INTO chat_reads \(user_id, last_read_message_id, updated_at\) VALUES \(\?, 0, \?\)$/);
  assert.match(db.log[1].sql, /UPDATE chat_reads SET last_read_message_id = GREATEST\(last_read_message_id, \?\), updated_at = \? WHERE user_id = \?/); assert.deepEqual(db.log[1].params, [12, '2026-10-14 05:00:00', 3]);
  assert.ok(!/VALUES\(last_read/i.test(db.log.map((q) => q.sql).join(' ')) && !/ON DUPLICATE KEY/i.test(db.log.map((q) => q.sql).join(' ')));
});
test('a person with no cursor row has read nothing; numbers come back as numbers', async () => {
  const none = createChatRepository(recording(() => [])); assert.equal(await none.readCursor(1), 0);
  const some = createChatRepository(recording(() => [{ cursor_id: '17' }])); assert.equal(await some.readCursor(1), 17);
  const latest = createChatRepository(recording(() => [{ latest: '0' }])); assert.equal(await latest.latestId(), 0);
  const cursors = createChatRepository(recording(() => [{ user_id: '3', cursor_id: '4' }])); assert.deepEqual(await cursors.activeCursors(), [{ userId: 3, cursor: 4 }]);
});
test('only ACTIVE accounts take part: the directory (mentions) and the read-by cursors are filtered to is_active = 1 in the SQL itself', async () => {
  const db = recording(); const r = createChatRepository(db); await r.activeUsers(); await r.activeCursors();
  assert.match(db.log[0].sql, /^SELECT id, name FROM users WHERE is_active = 1 ORDER BY id ASC$/);
  assert.match(db.log[1].sql, /FROM users u LEFT JOIN chat_reads r ON r\.user_id = u\.id WHERE u\.is_active = 1$/);
});
test('empty id lists never reach the database (an empty IN () would be a syntax error)', async () => {
  const db = recording(); const r = createChatRepository(db); assert.deepEqual(await r.byIds([]), []); assert.deepEqual(await r.mentionsFor([]), []); assert.equal(db.log.length, 0);
});
test('the repository never deletes anything and never reads employee IDs or password data', () => {
  const src = readSource();
  assert.ok(!/DELETE FROM|TRUNCATE|DROP /i.test(src)); assert.ok(!/employee_id|password_hash|email|phone/i.test(src));
});
import { readFileSync } from 'node:fs';
function readSource() { return readFileSync(new URL('../src/modules/chat/chat.repository.js', import.meta.url), 'utf8'); }
