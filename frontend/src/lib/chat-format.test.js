import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChatDraft, newRequestId, splitMentions, mentionSuggestions, applyMention, mergeLatest, formatChatTime, CHAT_BODY_MAX } from './chat-format.js';

test('validateChatDraft: trims, rejects empty and over-long', () => {
  assert.deepEqual(validateChatDraft('  hi  '), { ok: true, value: 'hi' });
  assert.equal(validateChatDraft('   ').ok, false); assert.equal(validateChatDraft(undefined).ok, false);
  assert.equal(validateChatDraft('x'.repeat(CHAT_BODY_MAX + 1)).ok, false); assert.equal(validateChatDraft('x'.repeat(CHAT_BODY_MAX)).ok, true);
});

test('newRequestId: UUID-shaped and different each time', () => {
  const a = newRequestId(), b = newRequestId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i); assert.notEqual(a, b);
});

test('splitMentions: highlights only server-linked mentions; unknown IDs, e-mail addresses and punctuation stay plain', () => {
  const ments = [{ id: 3, employeeId: 'BDE-002', name: 'Demo BDE Two' }];
  assert.deepEqual(splitMentions('hi @bde-002, see @NOBODY and a@b.com', ments), [
    { text: 'hi ' }, { text: '@bde-002', mention: ments[0] }, { text: ', see @NOBODY and a@b.com' }]);
  assert.deepEqual(splitMentions('@BDE-002', ments), [{ text: '@BDE-002', mention: ments[0] }]);
  assert.deepEqual(splitMentions('thanks @BDE-002.', ments), [{ text: 'thanks ' }, { text: '@BDE-002', mention: ments[0] }, { text: '.' }]);
  assert.deepEqual(splitMentions('plain text', []), [{ text: 'plain text' }]);
  assert.deepEqual(splitMentions('<b>@BDE-002</b> <script>', ments).map((p) => p.text).join(''), '<b>@BDE-002</b> <script>'); // text is returned untouched (React escapes it)
});

test('mentionSuggestions / applyMention: trailing @token only, by ID or name prefix, max 6', () => {
  const people = [{ employeeId: 'BDE-001', name: 'Arun' }, { employeeId: 'BDE-002', name: 'Meera' }, { employeeId: 'ADM-1', name: 'Admin' }];
  assert.deepEqual(mentionSuggestions('hello @bde', people).map((p) => p.employeeId), ['BDE-001', 'BDE-002']);
  assert.deepEqual(mentionSuggestions('@me', people).map((p) => p.employeeId), ['BDE-002']);
  assert.deepEqual(mentionSuggestions('hello @', people).length, 3);
  assert.deepEqual(mentionSuggestions('no mention here', people), []);
  assert.deepEqual(mentionSuggestions('mail a@bde', people), []);        // not after whitespace
  assert.deepEqual(mentionSuggestions('@bde and more', people), []);     // cursor moved past the token
  assert.equal(mentionSuggestions('@', Array.from({ length: 20 }, (_, i) => ({ employeeId: 'E' + i, name: 'N' + i }))).length, 6);
  assert.equal(applyMention('hello @bde', people[1]), 'hello @BDE-002 ');
  assert.equal(applyMention('@m', people[1]), '@BDE-002 ');
});

test('mergeLatest: the newest page replaces the newest window (removed messages vanish), older loaded pages are kept, oldest -> newest', () => {
  const m = (id) => ({ id, body: 'm' + id });
  assert.deepEqual(mergeLatest([m(1), m(2), m(3), m(4)], [m(5), m(4), m(3)]).map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(mergeLatest([m(1), m(2), m(3), m(4)], [m(4), m(3)]).map((x) => x.id), [1, 2, 3, 4]);
  assert.deepEqual(mergeLatest([m(1), m(2), m(3)], [m(3)]).map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(mergeLatest([m(4), m(3)], [m(5), m(3)]).map((x) => x.id), [3, 5]);                // m4 was removed on the server
  assert.deepEqual(mergeLatest([m(1), m(2)], []), []);                                               // everything removed
  assert.deepEqual(mergeLatest([], [m(2), m(1)]).map((x) => x.id), [1, 2]);
});

test('formatChatTime: API UTC string -> readable local time; bad input -> empty string', () => {
  assert.match(formatChatTime('2026-10-14 10:00:00', { timeZone: 'Asia/Kolkata' }), /14 Oct.*3:30\s?pm/i);
  assert.equal(formatChatTime('garbage'), '');
});
