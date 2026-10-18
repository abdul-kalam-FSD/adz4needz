import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHARS, unreadLabel, characterCount, nextPollDelay, messageSegments, dayLabel, buildThread, mergeMessages, shouldMarkRead, mentionQueryAt, filterMembers, insertMention, beginSend, sendSucceeded, sendFailed, initialSendState, formatMessageTime } from './chat.js';

const utc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const ids = () => { let n = 0; return () => `id-${++n}`; };

test('limits mirror the server', () => assert.equal(MAX_CHARS, 2000));
test('badge label: nothing, the number, or 99+', () => {
  assert.equal(unreadLabel(0), ''); assert.equal(unreadLabel(undefined), ''); assert.equal(unreadLabel(-3), ''); assert.equal(unreadLabel(7), '7'); assert.equal(unreadLabel(99), '99'); assert.equal(unreadLabel(100), '99+'); assert.equal(unreadLabel(5000), '99+');
});
test('character count is in characters people see (an emoji is one), like the server', () => { assert.equal(characterCount('abc'), 3); assert.equal(characterCount('😀😀'), 2); assert.equal(characterCount(''), 0); assert.equal(characterCount('வணக்கம்'.normalize('NFC')), [...'வணக்கம்'].length); });
test('poll delay doubles after each failure and stops at a minute; bad input falls back to the base delay', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((f) => nextPollDelay(5000, f)), [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  assert.equal(nextPollDelay(5000, -2), 5000); assert.equal(nextPollDelay(5000, NaN), 5000); assert.equal(nextPollDelay(30000, 1), 60000); assert.equal(nextPollDelay(5000, 1000), 60000);
});

test('segments: plain text stays one text piece; mentions become pieces at the exact server positions', () => {
  assert.deepEqual(messageSegments('hello', []), [{ type: 'text', text: 'hello' }]);
  const body = 'Hi @ravi.kumar and @asha.verma!';
  assert.deepEqual(messageSegments(body, [{ start: 3, end: 14, userId: 2, name: 'Ravi Kumar' }, { start: 19, end: 30, userId: 1, name: 'Asha Verma' }]),
    [{ type: 'text', text: 'Hi ' }, { type: 'mention', text: '@ravi.kumar', userId: 2, name: 'Ravi Kumar' }, { type: 'text', text: ' and ' }, { type: 'mention', text: '@asha.verma', userId: 1, name: 'Asha Verma' }, { type: 'text', text: '!' }]);
  assert.deepEqual(messageSegments('@a', [{ start: 0, end: 2, userId: 1, name: 'A' }]), [{ type: 'mention', text: '@a', userId: 1, name: 'A' }]);
});
test('segments: HTML and script text is only ever TEXT (the pieces carry strings, never markup), including inside and around mentions', () => {
  const body = '<img src=x onerror=alert(1)> @ravi <script>alert(1)</script>';
  const segs = messageSegments(body, [{ start: 29, end: 34, userId: 2, name: '<b>Ravi</b>' }]);
  assert.equal(segs.map((s) => s.text).join(''), body, 'nothing is lost, nothing is rewritten');
  assert.ok(segs.every((s) => s.type === 'text' || s.type === 'mention') && segs.every((s) => typeof s.text === 'string'));
  assert.equal(segs.find((s) => s.type === 'mention').name, '<b>Ravi</b>', 'a hostile name is still just a string for the screen to escape');
});
test('segments: a mention that does not fit is ignored (shown as text), never crashes or reorders text', () => {
  const body = 'hi @ravi';
  for (const bad of [{ start: -1, end: 3 }, { start: 3, end: 99 }, { start: 5, end: 4 }, { start: 0, end: 2 }, { start: 1.5, end: 4 }, { start: 3, end: 3 }, null, undefined, 'x', {}]) assert.deepEqual(messageSegments(body, [bad]), [{ type: 'text', text: body }], JSON.stringify(bad));
  assert.deepEqual(messageSegments(body, null), [{ type: 'text', text: body }]); assert.deepEqual(messageSegments(null, []), []); assert.deepEqual(messageSegments('', []), []);
  const overlap = messageSegments('@ravi.kumar', [{ start: 0, end: 11, userId: 2, name: 'R' }, { start: 3, end: 8, userId: 3, name: 'X' }]); assert.equal(overlap.length, 1);
});
test('segments: positions survive emoji and Tamil text (string offsets, like the server)', () => {
  const body = '😀 வணக்கம் @asha.verma'; const start = body.indexOf('@');
  const segs = messageSegments(body, [{ start, end: start + 11, userId: 1, name: 'Asha' }]); assert.equal(segs.at(-1).text, '@asha.verma'); assert.equal(segs[0].text, '😀 வணக்கம் ');
});

const msg = (id, d, o = {}) => ({ id, createdAt: utc(d), mine: false, ...o });
test('thread: a day heading before each new day, and one "New messages" line before the first unread message that is not mine', () => {
  const now = new Date(); const yday = new Date(now.getTime() - 26 * 3600e3); const old = new Date(now.getTime() - 5 * 86400e3);
  const items = buildThread([msg(1, old), msg(2, yday), msg(3, now, { mine: true }), msg(4, now), msg(5, now)], 2, now);
  assert.deepEqual(items.map((i) => i.type), ['day', 'message', 'day', 'message', 'day', 'message', 'new', 'message', 'message']);
  assert.equal(items.filter((i) => i.type === 'new').length, 1); assert.equal(items[items.findIndex((i) => i.type === 'new') + 1].message.id, 4, 'my own message 3 is never "new"');
  assert.equal(items.filter((i) => i.type === 'day').at(-1).label, 'Today');
});
test('thread: no "New messages" line when everything is read, nothing is unread but my own, or there are no messages', () => {
  const now = new Date();
  assert.equal(buildThread([msg(1, now), msg(2, now)], 2, now).some((i) => i.type === 'new'), false);
  assert.equal(buildThread([msg(5, now, { mine: true })], 0, now).some((i) => i.type === 'new'), false);
  assert.deepEqual(buildThread([], 0, now), []);
  assert.equal(buildThread([msg(1, now)], 0, now).some((i) => i.type === 'new'), true, 'a person who has read nothing sees the line at the top');
});
test('day labels: Today, Yesterday, then a date; an invalid time gives an empty label instead of "Invalid Date"', () => {
  // A fixed local noon, not the real clock: with new Date() this test failed whenever it ran between midnight and 02:00 (26 hours earlier was then two calendar days ago).
  const now = new Date(2026, 9, 18, 12, 0, 0); assert.equal(dayLabel(utc(now), now), 'Today'); assert.equal(dayLabel(utc(new Date(now.getTime() - 26 * 3600e3)), now), 'Yesterday');
  assert.match(dayLabel(utc(new Date(now.getTime() - 9 * 86400e3)), now), /\d{4}/); assert.equal(dayLabel('garbage', now), ''); assert.equal(formatMessageTime('garbage'), '');
  assert.equal(buildThread([{ id: 1, createdAt: 'garbage', mine: false }], 5, now)[0].key, 'day-unknown');
});
test('merge: no duplicates by id, always oldest first, newer data for the same id wins, inputs untouched', () => {
  const a = [{ id: 1, body: 'a' }, { id: 3, body: 'c' }]; const b = [{ id: 2, body: 'b' }, { id: 3, body: 'c2' }, { id: 4, body: 'd' }]; const copy = JSON.stringify([a, b]);
  assert.deepEqual(mergeMessages(a, b).map((m) => [m.id, m.body]), [[1, 'a'], [2, 'b'], [3, 'c2'], [4, 'd']]); assert.equal(JSON.stringify([a, b]), copy);
  assert.deepEqual(mergeMessages([], []), []); assert.deepEqual(mergeMessages([{ id: 5 }], [{ id: 5 }]).length, 1);
});
test('mark-read rule: only in the all-messages view, with the tab showing, at the bottom, and with something newer', () => {
  const ok = { view: 'all', tabVisible: true, atBottom: true, newestSeenId: 10, lastReadId: 7 }; assert.equal(shouldMarkRead(ok), true);
  for (const o of [{ view: 'announcement' }, { tabVisible: false }, { atBottom: false }, { newestSeenId: 7 }, { newestSeenId: 3 }, { newestSeenId: null }, { newestSeenId: undefined }, { tabVisible: undefined }]) assert.equal(shouldMarkRead({ ...ok, ...o }), false, JSON.stringify(o));
});

test('autocomplete trigger: only when the caret is right after an @word that starts the text or follows whitespace', () => {
  assert.deepEqual(mentionQueryAt('@as', 3), { start: 0, query: 'as' }); assert.deepEqual(mentionQueryAt('hi @', 4), { start: 3, query: '' }); assert.deepEqual(mentionQueryAt('hi\n@ra', 6), { start: 3, query: 'ra' });
  assert.deepEqual(mentionQueryAt('a @as and more', 5), { start: 2, query: 'as' }, 'the caret decides, not the end of the text');
  assert.deepEqual(mentionQueryAt('hi @ra.', 7), { start: 3, query: 'ra.' }, 'punctuation is part of what is being typed; matching decides later');
  for (const [text, caret] of [['mail me@x', 9], ['@as ', 4], ['no at', 5], ['a@b', 3], ['@@', 2]]) assert.equal(mentionQueryAt(text, caret), null, text);
  const tamil = 'வணக்கம் @மு'; assert.deepEqual(mentionQueryAt(tamil, tamil.length), { start: tamil.indexOf('@'), query: 'மு' });
});
const MEMBERS = [{ id: 1, name: 'Asha Verma', handle: 'asha.verma' }, { id: 2, name: 'Ravi Kumar', handle: 'ravi.kumar' }, { id: 3, name: 'Kumar Ashok', handle: 'kumar.ashok' }, { id: 4, name: 'Meera', handle: 'meera' }];
test('autocomplete matching: starts-with first, then contains; by handle, name, or any word of the name; empty query lists people by name', () => {
  assert.deepEqual(filterMembers(MEMBERS, 'ku').map((m) => m.id), [3, 2], '"Kumar Ashok" starts with ku; "Ravi Kumar" has a word that does');
  assert.deepEqual(filterMembers(MEMBERS, 'as').map((m) => m.id), [1, 3]); assert.deepEqual(filterMembers(MEMBERS, 'ver').map((m) => m.id), [1], '"ver" only appears inside Asha Verma');
  assert.deepEqual(filterMembers(MEMBERS, 'ASHA.V').map((m) => m.id), [1]); assert.deepEqual(filterMembers(MEMBERS, 'zzz'), []); assert.deepEqual(filterMembers(MEMBERS, '').map((m) => m.id), [1, 3, 4, 2]);
  assert.equal(filterMembers(MEMBERS, '', 2).length, 2);
});
test('inserting a mention replaces @query with @handle and a space, keeps the rest, and places the caret after it', () => {
  assert.deepEqual(insertMention('hi @as', 6, 3, MEMBERS[0]), { text: 'hi @asha.verma ', caret: 15 });
  assert.deepEqual(insertMention('hi @as there', 6, 3, MEMBERS[0]), { text: 'hi @asha.verma  there', caret: 15 }); assert.deepEqual(insertMention('@', 1, 0, MEMBERS[3]), { text: '@meera ', caret: 7 });
});

test('send: while a send is running, another is ignored (double click, double Enter)', () => {
  const a = beginSend(initialSendState(), 'hi', 'message', ids()); assert.ok(a.attempt); assert.equal(a.state.pending, true);
  const b = beginSend(a.state, 'hi', 'message', ids()); assert.equal(b.attempt, null); assert.equal(b.state, a.state);
});
test('send: success clears everything, so the next message is a new post with a new id', () => {
  const make = ids(); const a = beginSend(initialSendState(), 'hi', 'message', make); const done = sendSucceeded();
  assert.deepEqual(done, { pending: false, error: null, retry: null }); assert.notEqual(beginSend(done, 'hi', 'message', make).attempt.requestId, a.attempt.requestId);
});
test('send: after a lost connection or server error the SAME text and kind re-send the SAME request id (cannot post twice)', () => {
  const make = ids(); const a = beginSend(initialSendState(), 'hi', 'message', make);
  for (const status of [0, 500, 502, 408, 429]) { const failed = sendFailed(a.state, { status, message: 'x' }); assert.equal(failed.pending, false); assert.equal(beginSend(failed, 'hi', 'message', make).attempt.requestId, a.attempt.requestId, 'status ' + status); }
});
test('send: an edited text, a changed kind, or a clear refusal by the server starts with a NEW request id', () => {
  const make = ids(); const a = beginSend(initialSendState(), 'hi', 'message', make); const net = sendFailed(a.state, { status: 0, message: 'x' });
  assert.notEqual(beginSend(net, 'hi there', 'message', make).attempt.requestId, a.attempt.requestId); assert.notEqual(beginSend(net, 'hi', 'announcement', make).attempt.requestId, a.attempt.requestId);
  const refused = sendFailed(a.state, { status: 400, message: 'too long' }); assert.equal(refused.retry, null); assert.notEqual(beginSend(refused, 'hi', 'message', make).attempt.requestId, a.attempt.requestId);
  assert.equal(sendFailed(a.state, { status: 403, message: 'Only an admin' }).retry, null);
});
test('send: the error text comes from the server message, with a plain fallback; the typed text is never lost by this state (it lives in the box)', () => {
  const a = beginSend(initialSendState(), 'hi', 'message', ids());
  assert.equal(sendFailed(a.state, { status: 429, message: 'You are sending messages too quickly. Please wait a moment.' }).error, 'You are sending messages too quickly. Please wait a moment.');
  assert.match(sendFailed(a.state, null).error, /not sent/); assert.match(sendFailed(a.state, {}).error, /not sent/);
});
