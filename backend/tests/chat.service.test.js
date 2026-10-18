import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatService } from '../src/modules/chat/chat.service.js';
import { fakeChatRepo } from './helpers/fake-chat-repo.js';

const admin = { id: 1, role: 'admin', employeeId: 'ADM', name: 'Admin One' };
const asha = { id: 10, role: 'bde', employeeId: 'E10', name: 'Asha Verma' };
const ravi = { id: 11, role: 'bde', employeeId: 'E11', name: 'Ravi Kumar' };
let n = 0; const rid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const NOW = Date.UTC(2026, 9, 14, 5, 0, 0);
function make(opts = {}) { const repo = fakeChatRepo(opts); const clock = { t: NOW }; return { repo, clock, svc: createChatService({ repo, now: () => clock.t }) }; }
const msg = (body, extra = {}) => ({ body, clientRequestId: rid(), ...extra });
const status = (p, s, code) => assert.rejects(p, (e) => e.status === s && (!code || e.code === code));

test('send: the sender is the SESSION user, whatever the body claims; the stored time is UTC from the server clock', async () => {
  const { svc, repo } = make();
  const r = await svc.send(asha, msg('Hello', { senderId: 11, sender_id: 11, userId: 1, role: 'admin', createdAt: '2001-01-01 00:00:00', id: 999, sender: { id: 1, name: 'Admin One' } }));
  assert.equal(r.duplicate, false); assert.equal(r.message.sender.id, 10); assert.equal(r.message.sender.name, 'Asha Verma'); assert.equal(r.message.sender.role, 'bde');
  assert.equal(repo.state.messages[0].sender_id, 10); assert.equal(repo.state.messages[0].created_at, '2026-10-14 05:00:00'); assert.equal(r.message.createdAt, '2026-10-14 05:00:00'); assert.notEqual(r.message.id, 999);
  assert.equal(r.message.mine, true); assert.equal(r.message.kind, 'message');
});
test('send: admins and BDEs may chat; anonymous or unknown roles may not (and nothing is stored)', async () => {
  const { svc, repo } = make();
  await svc.send(admin, msg('from admin')); await svc.send(ravi, msg('from bde'));
  for (const who of [undefined, null, { id: 5, role: 'visitor' }, { id: 5 }]) { await status(svc.send(who, msg('x')), 403); await status(svc.list(who, {}), 403); await status(svc.unread(who), 403); await status(svc.members(who), 403); await status(svc.markRead(who, { upTo: 1 }), 403); }
  assert.equal(repo.state.messages.length, 2);
});
test('announcements: admin only. A BDE gets 403 and nothing is stored, even with a valid body; admins can still send ordinary messages', async () => {
  const { svc, repo } = make();
  await status(svc.send(asha, msg('Everyone listen', { kind: 'announcement' })), 403, 'FORBIDDEN');
  assert.equal(repo.state.messages.length, 0);
  const a = await svc.send(admin, msg('Office closed Friday', { kind: 'announcement' })); assert.equal(a.message.kind, 'announcement'); assert.equal(a.message.sender.role, 'admin');
  assert.equal((await svc.send(admin, msg('just chatting'))).message.kind, 'message');
  assert.equal(repo.state.messages.length, 2);
});
test('send: invalid input is 400 with field messages and nothing is stored', async () => {
  const { svc, repo } = make();
  for (const body of [{}, msg(''), msg('   '), { body: 'x' }, msg('x', { kind: 'shout' }), msg('x'.repeat(2001)), msg('bad\u0000char'), null, 'text']) await assert.rejects(svc.send(asha, body), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');
  assert.equal(repo.state.messages.length, 0);
});
test('send: HTML and script text is stored and returned exactly as typed (it is escaped when shown, never executed)', async () => {
  const { svc } = make(); const evil = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)> &amp; "quotes"';
  const r = await svc.send(asha, msg(evil)); assert.equal(r.message.body, evil);
  assert.equal((await svc.list(ravi, {})).messages[0].body, evil);
});

test('mentions: found by the SERVER from the text, stored with exact positions and the person\'s current name', async () => {
  const { svc, repo } = make();
  const body = 'Hi @ravi.kumar and @Admin.One, thanks!'; const r = await svc.send(asha, msg(body));
  assert.deepEqual(r.message.mentions.map((m) => [body.slice(m.start, m.end), m.userId, m.name]), [['@ravi.kumar', 11, 'Ravi Kumar'], ['@Admin.One', 1, 'Admin One']]);
  assert.equal(repo.state.mentions.length, 2);
});
test('mentions: unknown people, inactive people, partial handles and email-like text are NOT mentions', async () => {
  const { svc, repo } = make();
  const r = await svc.send(asha, msg('@nobody @old.timer @ravi write to ravi@example.com'));
  assert.deepEqual(r.message.mentions, []); assert.equal(repo.state.mentions.length, 0);
});
test('mentions: a client cannot claim a mention; the "mentions" field in the request is ignored', async () => {
  const { svc, repo } = make();
  const r = await svc.send(asha, msg('no names here', { mentions: [{ userId: 11, start: 0, end: 2 }], mentionedUserIds: [11] }));
  assert.deepEqual(r.message.mentions, []); assert.equal(repo.state.mentions.length, 0);
});
test('mentions: more than 20 in one message is refused (400) and nothing is stored', async () => {
  const { svc, repo } = make();
  await assert.rejects(svc.send(asha, msg('@ravi.kumar '.repeat(21))), (e) => e.status === 400 && Boolean(e.fields.body));
  assert.equal(repo.state.messages.length, 0); assert.equal((await svc.send(asha, msg('@ravi.kumar '.repeat(20)))).message.mentions.length, 20);
});
test('mentions: renaming a person later changes the displayed name but never the stored positions (history is stable)', async () => {
  const { svc, repo } = make(); const body = 'ping @ravi.kumar now'; await svc.send(asha, msg(body));
  repo.state.users.find((u) => u.id === 11).name = 'Ravindran K';
  const m = (await svc.list(asha, {})).messages[0].mentions[0];
  assert.equal(m.name, 'Ravindran K'); assert.equal(body.slice(m.start, m.end), '@ravi.kumar');
});
test('members: id, name and handle only (never employee IDs or roles); inactive people are excluded', async () => {
  const { svc } = make(); const { members } = await svc.members(ravi);
  assert.deepEqual(members, [{ id: 1, name: 'Admin One', handle: 'admin.one' }, { id: 10, name: 'Asha Verma', handle: 'asha.verma' }, { id: 11, name: 'Ravi Kumar', handle: 'ravi.kumar' }]);
  for (const m of members) assert.deepEqual(Object.keys(m).sort(), ['handle', 'id', 'name']);
});

test('duplicate send: the same request id is ONE message; the second answer says duplicate; the author sees the original', async () => {
  const { svc, repo } = make(); const body = msg('once only');
  const a = await svc.send(asha, body); const b = await svc.send(asha, body);
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(b.message.id, a.message.id); assert.equal(repo.state.messages.length, 1);
  assert.equal((await svc.list(ravi, {})).messages.length, 1);
});
test('duplicate send arriving at the same moment (database says duplicate key): the winner is returned, no error, no second message', async () => {
  const { svc, repo } = make(); const body = msg('race');
  repo.state.racingWinner = { id: 77, sender_id: 10, kind: 'message', body: 'race', client_request_id: body.clientRequestId, created_at: '2026-10-14 05:00:00' };
  repo.state.failNextInsertWith = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
  const r = await svc.send(asha, body); assert.equal(r.duplicate, true); assert.equal(r.message.id, 77); assert.equal(repo.state.messages.length, 1);
});
test('a request id reused for a DIFFERENT message or kind is refused (409), never returned as success', async () => {
  const { svc, repo } = make(); const body = msg('first'); await svc.send(admin, body);
  await status(svc.send(admin, { ...body, body: 'second' }), 409, 'REQUEST_ID_REUSED'); await status(svc.send(admin, { ...body, kind: 'announcement' }), 409, 'REQUEST_ID_REUSED');
  assert.equal(repo.state.messages.length, 1);
});
test('the same request id used by two people is two independent messages', async () => {
  const { svc, repo } = make(); const id = rid();
  await svc.send(asha, { body: 'a', clientRequestId: id }); await svc.send(ravi, { body: 'b', clientRequestId: id }); assert.equal(repo.state.messages.length, 2);
});
test('an unexpected database failure is reported, never shown as success; a fresh attempt then works', async () => {
  const { svc, repo } = make(); repo.state.failNextInsertWith = new Error('connection lost');
  await assert.rejects(svc.send(asha, msg('x')), /connection lost/); assert.equal(repo.state.messages.length, 0);
  assert.equal((await svc.send(asha, msg('x'))).duplicate, false);
});
test('a duplicate-key error with no saved message behind it is NOT hidden (it would be a bug)', async () => {
  const { svc, repo } = make(); repo.state.failNextInsertWith = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
  await assert.rejects(svc.send(asha, msg('x')), (e) => e.code === 'ER_DUP_ENTRY');
});

async function seed(svc, count, sender = ravi) { for (let i = 1; i <= count; i++) await svc.send(sender, msg(`m${i}`)); }
test('list: newest page, oldest first; hasMore says whether older messages exist; before= pages backwards without gaps or repeats', async () => {
  const { svc } = make(); await seed(svc, 7);
  const p1 = await svc.list(asha, { limit: '3' }); assert.deepEqual(p1.messages.map((m) => m.body), ['m5', 'm6', 'm7']); assert.equal(p1.hasMore, true);
  const p2 = await svc.list(asha, { limit: '3', before: String(p1.messages[0].id) }); assert.deepEqual(p2.messages.map((m) => m.body), ['m2', 'm3', 'm4']); assert.equal(p2.hasMore, true);
  const p3 = await svc.list(asha, { limit: '3', before: String(p2.messages[0].id) }); assert.deepEqual(p3.messages.map((m) => m.body), ['m1']); assert.equal(p3.hasMore, false);
  assert.equal((await svc.list(asha, {})).messages.length, 7);
});
test('list: after= returns only newer messages, oldest first; nothing new gives an empty list', async () => {
  const { svc } = make(); await seed(svc, 4); const all = (await svc.list(asha, {})).messages;
  const fresh = await svc.list(asha, { after: String(all[1].id) }); assert.deepEqual(fresh.messages.map((m) => m.body), ['m3', 'm4']); assert.equal(fresh.hasMore, false);
  assert.deepEqual((await svc.list(asha, { after: String(all[3].id) })).messages, []);
});
test('list: after= with more than 200 new messages returns 200 and says more: true so the screen asks again', async () => {
  const { svc } = make(); await seed(svc, 203);
  const r = await svc.list(asha, { after: '1' }); assert.equal(r.messages.length, 200); assert.equal(r.more, true); assert.equal(r.messages[0].id, 2);
  const r2 = await svc.list(asha, { after: String(r.messages[199].id) }); assert.equal(r2.messages.length, 2, 'ids 202 and 203 remain'); assert.equal(r2.more, false);
});
test('list: kind=announcement shows only announcements, and paging still works inside that filter', async () => {
  const { svc } = make(); await svc.send(ravi, msg('chat')); await svc.send(admin, msg('A1', { kind: 'announcement' })); await svc.send(ravi, msg('chat2')); await svc.send(admin, msg('A2', { kind: 'announcement' }));
  const r = await svc.list(asha, { kind: 'announcement', limit: '1' }); assert.deepEqual(r.messages.map((m) => m.body), ['A2']); assert.equal(r.hasMore, true);
  assert.deepEqual((await svc.list(asha, { kind: 'announcement', before: String(r.messages[0].id) })).messages.map((m) => m.body), ['A1']);
});
test('list: bad parameters are 400 and nothing is read', async () => {
  const { svc } = make();
  for (const q of [{ kind: 'x' }, { after: 'abc' }, { before: '0' }, { after: '1', before: '2' }, { limit: '101' }, { limit: '0' }, { after: ['1', '2'] }]) await assert.rejects(svc.list(asha, q), (e) => e.status === 400, JSON.stringify(q));
});
test('list: "mine" and "mentionsMe" are worked out for the viewer', async () => {
  const { svc } = make(); await svc.send(asha, msg('hello @ravi.kumar')); await svc.send(ravi, msg('reply'));
  const forRavi = (await svc.list(ravi, {})).messages; assert.deepEqual(forRavi.map((m) => [m.mine, m.mentionsMe]), [[false, true], [true, false]]);
  const forAsha = (await svc.list(asha, {})).messages; assert.deepEqual(forAsha.map((m) => [m.mine, m.mentionsMe]), [[true, false], [false, false]]);
});

test('unread: nobody has read anything at first; your own messages are never unread for you', async () => {
  const { svc } = make(); await svc.send(asha, msg('a1')); await svc.send(ravi, msg('r1')); await svc.send(ravi, msg('r2'));
  assert.deepEqual((await svc.unread(asha)).unread, { unread: 2, announcements: 0, mentions: 0 });
  assert.deepEqual((await svc.unread(ravi)).unread, { unread: 1, announcements: 0, mentions: 0 });
});
test('unread: announcements and mentions are counted separately', async () => {
  const { svc } = make(); await svc.send(admin, msg('Meeting at 5', { kind: 'announcement' })); await svc.send(ravi, msg('@asha.verma are you there?')); await svc.send(ravi, msg('@asha.verma @asha.verma twice in one message'));
  assert.deepEqual((await svc.unread(asha)).unread, { unread: 3, announcements: 1, mentions: 2 }, 'a message that mentions you twice is one unread mention');
  assert.equal((await svc.unread(admin)).unread.mentions, 0);
});
test('unread: mentioning yourself does not make your own message unread', async () => {
  const { svc } = make(); await svc.send(asha, msg('note to self @asha.verma')); assert.deepEqual((await svc.unread(asha)).unread, { unread: 0, announcements: 0, mentions: 0 });
});
test('markRead: moves the cursor, clears unread, never goes backwards, never passes the newest message, is harmless to repeat', async () => {
  const { svc } = make(); await seed(svc, 5); const all = (await svc.list(asha, {})).messages; const id = (i) => all[i].id;
  let s = await svc.markRead(asha, { upTo: id(2) }); assert.equal(s.lastReadMessageId, id(2)); assert.equal(s.unread.unread, 2);
  s = await svc.markRead(asha, { upTo: id(0) }); assert.equal(s.lastReadMessageId, id(2), 'an older id never moves it back');
  s = await svc.markRead(asha, { upTo: id(2) }); assert.equal(s.lastReadMessageId, id(2));
  s = await svc.markRead(asha, { upTo: 999999 }); assert.equal(s.lastReadMessageId, id(4), 'clamped to the newest message'); assert.equal(s.unread.unread, 0);
  assert.equal(s.latestId, id(4));
});
test('markRead: one person reading does not change anyone else\'s unread; new messages after reading are unread again', async () => {
  const { svc } = make(); await seed(svc, 2); await svc.markRead(asha, { upTo: 2 });
  assert.equal((await svc.unread(asha)).unread.unread, 0); assert.equal((await svc.unread(admin)).unread.unread, 2);
  await svc.send(ravi, msg('new')); assert.equal((await svc.unread(asha)).unread.unread, 1);
});
test('markRead: upTo must be a message id (400 otherwise) and nothing changes', async () => {
  const { svc, repo } = make(); await seed(svc, 2);
  for (const body of [undefined, {}, { upTo: 0 }, { upTo: -1 }, { upTo: 'x' }, { upTo: 1.5 }, { upTo: [1] }, { upTo: null }]) await assert.rejects(svc.markRead(asha, body), (e) => e.status === 400, JSON.stringify(body));
  assert.equal(repo.state.reads.size, 0);
});
test('markRead: with no messages at all it is harmless (cursor stays 0)', async () => {
  const { svc } = make(); const s = await svc.markRead(asha, { upTo: 5 }); assert.equal(s.lastReadMessageId, 0); assert.equal(s.latestId, 0);
});

test('read-by on announcements: admins see how many people have read it (the sender and inactive people are not counted); BDEs never see it', async () => {
  const { svc } = make(); const a = (await svc.send(admin, msg('Policy update', { kind: 'announcement' }))).message;
  assert.deepEqual(a.readBy, { count: 0, total: 2 }, 'total = every active person except the sender');
  await svc.markRead(asha, { upTo: a.id });
  const seenByAdmin = (await svc.list(admin, { kind: 'announcement' })).messages[0]; assert.deepEqual(seenByAdmin.readBy, { count: 1, total: 2 });
  await svc.markRead(ravi, { upTo: a.id }); assert.deepEqual((await svc.list(admin, {})).messages[0].readBy, { count: 2, total: 2 });
  const seenByBde = (await svc.list(asha, {})).messages[0]; assert.equal('readBy' in seenByBde, false);
  await svc.send(ravi, msg('ordinary')); assert.equal('readBy' in (await svc.list(admin, {})).messages[1], false, 'only announcements carry it');
});
test('read-by: a person who has read only older messages has not read the announcement', async () => {
  const { svc } = make(); const first = (await svc.send(ravi, msg('older'))).message; const a = (await svc.send(admin, msg('A', { kind: 'announcement' }))).message;
  await svc.markRead(asha, { upTo: first.id }); assert.equal((await svc.list(admin, {})).messages[1].readBy.count, 0);
  await svc.markRead(asha, { upTo: a.id }); assert.equal((await svc.list(admin, {})).messages[1].readBy.count, 1);
});
