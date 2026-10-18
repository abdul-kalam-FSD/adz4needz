import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage, parseId, baseHandle, buildDirectory, parseMentions, validateListQuery, isUnread, MAX_BODY_CHARS, MAX_MENTIONS, MAX_PAGE, DEFAULT_PAGE, CHAT_KINDS } from '../src/lib/chat.js';

const RID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const ok = (o = {}) => ({ body: 'Hello team', clientRequestId: RID, ...o });

test('kinds: exactly message and announcement', () => assert.deepEqual(CHAT_KINDS, ['message', 'announcement']));

test('validateMessage: a good message is accepted; kind defaults to message; the request id is lower-cased', () => {
  const r = validateMessage(ok({ clientRequestId: RID.toUpperCase() }));
  assert.equal(r.ok, true); assert.deepEqual(r.value, { body: 'Hello team', kind: 'message', clientRequestId: RID });
  assert.equal(validateMessage(ok({ kind: 'announcement' })).value.kind, 'announcement');
  assert.equal(validateMessage(ok({ kind: null })).value.kind, 'message');
});
test('validateMessage: body is trimmed, CRLF becomes LF, inner newlines and tabs are kept', () => {
  assert.equal(validateMessage(ok({ body: '  hi\r\nthere\tyou\r\n  ' })).value.body, 'hi\nthere\tyou');
});
test('validateMessage: empty, blank, missing or non-string bodies are refused', () => {
  for (const body of [undefined, null, '', '   ', '\n\t\n', 5, ['x'], {}]) assert.ok(validateMessage(ok({ body })).errors.body, String(body));
});
test('validateMessage: length counts characters, not bytes (2000 emoji is fine, 2001 is not)', () => {
  assert.equal(validateMessage(ok({ body: 'a'.repeat(MAX_BODY_CHARS) })).ok, true);
  assert.equal(validateMessage(ok({ body: '😀'.repeat(MAX_BODY_CHARS) })).ok, true);
  assert.match(validateMessage(ok({ body: 'a'.repeat(MAX_BODY_CHARS + 1) })).errors.body, /at most 2000/);
  assert.equal(validateMessage(ok({ body: ' '.repeat(50) + 'a'.repeat(MAX_BODY_CHARS) })).ok, true, 'padding is trimmed before counting');
});
test('validateMessage: control characters are refused; ordinary text, newlines and unicode are fine', () => {
  for (const bad of ['a\u0000b', 'a\u0001b', 'a\u001Bb', 'a\u007Fb', 'a\u000Bb']) assert.ok(validateMessage(ok({ body: bad })).errors.body, JSON.stringify(bad));
  for (const good of ['வணக்கம் 👋', 'line1\nline2', 'tab\there', 'a\u200Db', 'quotes " \' ` and \\ backslash']) assert.equal(validateMessage(ok({ body: good })).ok, true, good);
});
test('validateMessage: HTML and script text is accepted AS TEXT and returned unchanged (it is escaped on display, never executed)', () => {
  for (const evil of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg/onload=alert(1)>', 'javascript:alert(1)', '&lt;b&gt;x&lt;/b&gt;']) assert.equal(validateMessage(ok({ body: evil })).value.body, evil);
});
test('validateMessage: unknown kinds and bad request ids are refused; sender fields in the body are ignored and never copied', () => {
  for (const kind of ['', 'Announcement', 'broadcast', 5, ['message']]) assert.ok(validateMessage(ok({ kind })).errors.kind, String(kind));
  for (const clientRequestId of [undefined, '', 'abc', RID + 'x', 5]) assert.ok(validateMessage(ok({ clientRequestId })).errors.clientRequestId, String(clientRequestId));
  const r = validateMessage(ok({ senderId: 99, sender_id: 99, userId: 99, createdAt: '2001-01-01', id: 5, mentions: [{ userId: 1 }], role: 'admin' }));
  assert.deepEqual(Object.keys(r.value).sort(), ['body', 'clientRequestId', 'kind']);
  for (const body of [null, undefined, 'x', [], 5]) assert.equal(validateMessage(body).ok, false);
});

test('parseId: positive safe integers and digit strings only', () => {
  assert.equal(parseId(5), 5); assert.equal(parseId('42'), 42); assert.equal(parseId('9007199254740'), 9007199254740);
  for (const bad of [0, -1, 1.5, '0', '01', '-3', '1e3', ' 4', 'abc', '', null, undefined, [], {}, 9007199254740993, '12345678901234567']) assert.equal(parseId(bad), null, String(bad));
});

test('handles: derived from the name, lower case, words joined by dots, odd characters removed', () => {
  assert.equal(baseHandle('Asha Verma'), 'asha.verma'); assert.equal(baseHandle('  Ravi   K. Kumar '), 'ravi.k.kumar'); assert.equal(baseHandle("D'Souza-Rao"), 'dsouza-rao');
  assert.equal(baseHandle('Ａｓｈａ'), 'asha', 'full-width letters are normalised'); assert.equal(baseHandle('!!!'), ''); assert.equal(baseHandle(null), '');
  assert.equal(baseHandle('a'.repeat(60)).length, 32);
});
test('handles keep Tamil and Hindi names intact (vowel signs are combining marks)', () => {
  assert.equal(baseHandle('முருகன்'), 'முருகன்'); assert.equal(baseHandle('सुनील कुमार'), 'सुनील.कुमार');
});
test('directory: the lowest id keeps the plain handle, later duplicates get -<id>, empty names get user<id>; handles are unique', () => {
  const d = buildDirectory([{ id: 9, name: 'Asha Verma' }, { id: 3, name: 'asha  verma' }, { id: 20, name: 'ASHA VERMA' }, { id: 4, name: '???' }, { id: 5, name: 'Ravi' }]);
  assert.deepEqual(d.map((x) => [x.id, x.handle]), [[3, 'asha.verma'], [4, 'user4'], [5, 'ravi'], [9, 'asha.verma-9'], [20, 'asha.verma-20']]);
  assert.equal(new Set(d.map((x) => x.handle)).size, d.length);
});
test('directory: a new person joining does not change anyone existing handle; ids may arrive as strings', () => {
  const before = buildDirectory([{ id: 1, name: 'Asha Verma' }, { id: 2, name: 'Ravi' }]);
  const after = buildDirectory([{ id: 1, name: 'Asha Verma' }, { id: 2, name: 'Ravi' }, { id: 3, name: 'Asha Verma' }]);
  assert.deepEqual(after.slice(0, 2), before); assert.equal(buildDirectory([{ id: '7', name: 'Z' }])[0].id, 7);
});
test('directory: long colliding names stay within 32 characters', () => {
  const name = 'x'.repeat(60); const d = buildDirectory([{ id: 1, name }, { id: 123456, name }]);
  assert.ok(d.every((x) => x.handle.length <= 32)); assert.notEqual(d[0].handle, d[1].handle);
});

const DIR = buildDirectory([{ id: 1, name: 'Asha Verma' }, { id: 2, name: 'Ravi Kumar' }, { id: 3, name: 'Ravi' }, { id: 4, name: 'முருகன்' }]);
const found = (body) => parseMentions(body, DIR).mentions.map((m) => [body.slice(m.start, m.end), m.userId]);

test('mentions: found by handle, case-insensitive, with exact offsets', () => {
  assert.deepEqual(found('Hi @asha.verma and @RAVI.KUMAR!'), [['@asha.verma', 1], ['@RAVI.KUMAR', 2]]);
  assert.deepEqual(parseMentions('@asha.verma', DIR).mentions, [{ start: 0, end: 11, userId: 1 }]);
});
test('mentions: trailing sentence punctuation is not part of the handle; other punctuation ends it', () => {
  assert.deepEqual(found('thanks @asha.verma.'), [['@asha.verma', 1]]); assert.deepEqual(found('(@ravi)'), [['@ravi', 3]]);
  assert.deepEqual(found('@ravi, @ravi: @ravi? @ravi- @ravi_'), [['@ravi', 3], ['@ravi', 3], ['@ravi', 3], ['@ravi', 3], ['@ravi', 3]]);
  assert.deepEqual(found("@ravi's"), [['@ravi', 3]]);
});
test('mentions: strict matching: partial handles, unknown people, extra characters and email-like text are NOT mentions', () => {
  assert.deepEqual(found('@asha'), [], 'only part of the handle'); assert.deepEqual(found('@nobody @everyone @all'), []);
  assert.deepEqual(found('@asha.vermax'), []); assert.deepEqual(found('mail ravi@ravi.example'), [], 'an @ inside a word is not a mention');
  assert.deepEqual(found('a.@ravi'), [], '@ right after a handle character is not a mention'); assert.deepEqual(found('@'), []); assert.deepEqual(found('@@ravi'), [['@ravi', 3]]);
  assert.deepEqual(found('@ravi.kumar'), [['@ravi.kumar', 2]], '"ravi" and "ravi.kumar" are different people; the longer handle wins');
});
test('mentions: the same person twice gives two entries; Tamil handles work; offsets are right after emoji', () => {
  assert.deepEqual(found('@ravi and @ravi again'), [['@ravi', 3], ['@ravi', 3]]);
  assert.deepEqual(found('வணக்கம் @முருகன், நன்றி'), [['@முருகன்', 4]]);
  const body = '😀😀 @asha.verma'; const m = parseMentions(body, DIR).mentions[0]; assert.equal(body.slice(m.start, m.end), '@asha.verma', 'offsets are string (UTF-16) offsets, so slicing works after emoji');
});
test('mentions: more than 20 are flagged tooMany and capped', () => {
  const r = parseMentions('@ravi '.repeat(MAX_MENTIONS + 3), DIR); assert.equal(r.tooMany, true); assert.equal(r.mentions.length, MAX_MENTIONS);
  assert.equal(parseMentions('@ravi '.repeat(MAX_MENTIONS), DIR).tooMany, false);
});
test('mentions: an empty directory finds nothing; HTML around a mention does not matter', () => {
  assert.deepEqual(parseMentions('@ravi', []).mentions, []); assert.deepEqual(found('<b>@ravi</b>'), [['@ravi', 3]]);
});

test('validateListQuery: defaults; kind, after, before, limit validated; repeated or conflicting parameters refused', () => {
  assert.deepEqual(validateListQuery({}).value, { kind: 'all', afterId: null, beforeId: null, limit: DEFAULT_PAGE });
  const r = validateListQuery({ kind: 'announcement', after: '12', limit: '30' }); assert.equal(r.ok, true); assert.deepEqual(r.value, { kind: 'announcement', afterId: 12, beforeId: null, limit: 30 });
  assert.equal(validateListQuery({ before: '9' }).value.beforeId, 9);
  assert.equal(validateListQuery({ limit: String(MAX_PAGE) }).ok, true);
  for (const q of [{ kind: 'x' }, { kind: ['all', 'all'] }, { after: 'abc' }, { after: '0' }, { before: '-1' }, { after: '1', before: '2' }, { limit: '0' }, { limit: String(MAX_PAGE + 1) }, { limit: 'many' }, { after: ['1', '2'] }]) assert.equal(validateListQuery(q).ok, false, JSON.stringify(q));
  assert.equal(validateListQuery({ after: '', before: '', limit: '' }).ok, true, 'empty values mean "not given"');
});
test('unread rule: newer than the cursor and not sent by me', () => {
  assert.equal(isUnread({ id: 11, senderId: 2 }, 1, 10), true); assert.equal(isUnread({ id: 10, senderId: 2 }, 1, 10), false); assert.equal(isUnread({ id: 11, senderId: 1 }, 1, 10), false); assert.equal(isUnread({ id: 5, senderId: 2 }, 1, 0), true);
});
