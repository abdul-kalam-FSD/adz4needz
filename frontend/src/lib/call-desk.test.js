import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOMES, outcomeLabel, formatPercent, newRequestId, formatCallTime, beginAttempt, succeedAttempt, failAttempt, describeSaved } from './call-desk.js';

const ids = () => { let n = 0; return () => `id-${++n}`; };
const ok = (outcome, extra = {}) => ({ call: { outcome, calledAt: '2026-10-13 05:00:00' }, duplicate: false, leadStatusUpdated: true, ...extra });

test('the four buttons are exactly the four daily-report categories, in a fixed order', () => {
  assert.deepEqual(OUTCOMES.map((o) => o.key), ['interested', 'not_interested', 'follow_up', 'no_response']);
  assert.deepEqual(OUTCOMES.map((o) => o.label), ['Interested', 'Not interested', 'Follow-up', 'No response']);
  assert.equal(outcomeLabel('follow_up'), 'Follow-up'); assert.equal(outcomeLabel('zzz'), 'zzz');
});
test('percent: one decimal; no calls (null) is a dash, never 0%; a real 0 is 0.0%', () => {
  assert.equal(formatPercent(0.1667), '16.7%'); assert.equal(formatPercent(1), '100.0%'); assert.equal(formatPercent(0), '0.0%'); assert.equal(formatPercent(0.25), '25.0%');
  assert.equal(formatPercent(null), '—'); assert.equal(formatPercent(undefined), '—');
});
test('request id: uses randomUUID when present, falls back to a valid v4 from getRandomValues, and refuses to invent a weak one', () => {
  assert.equal(newRequestId({ randomUUID: () => 'x-1' }), 'x-1');
  const fallback = newRequestId({ getRandomValues: (a) => { a.fill(255); return a; } });
  assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => newRequestId({}), /safe request id/); assert.throws(() => newRequestId(null), /safe request id/);
  assert.match(newRequestId(), /^[0-9a-f-]{36}$/);
});
test('time: the API sends UTC; an invalid value gives an empty string, not "Invalid Date"', () => {
  assert.equal(formatCallTime('garbage'), ''); assert.ok(formatCallTime('2026-10-13 05:00:00').length > 0);
});

test('double click: while a save is in progress, a second click on the same lead is ignored and starts nothing', () => {
  const makeId = ids();
  const a = beginAttempt({}, 7, 'interested', '', makeId); assert.ok(a.attempt); assert.equal(a.rows[7].pending, true);
  const b = beginAttempt(a.rows, 7, 'interested', '', makeId); assert.equal(b.attempt, null); assert.equal(b.rows, a.rows);
  const c = beginAttempt(a.rows, 7, 'not_interested', '', makeId); assert.equal(c.attempt, null, 'a different button is blocked too while saving');
  assert.ok(beginAttempt(a.rows, 8, 'interested', '', makeId).attempt, 'other leads are independent');
});
test('success: marks the row as saved with what the SERVER returned and clears the retry id, so the next click is a new call', () => {
  const makeId = ids();
  const a = beginAttempt({}, 7, 'interested', '', makeId);
  const done = succeedAttempt(a.rows, 7, ok('interested'));
  assert.equal(done[7].pending, false); assert.equal(done[7].error, null); assert.equal(done[7].retry, null); assert.equal(done[7].last.outcome, 'interested');
  const next = beginAttempt(done, 7, 'interested', '', makeId); assert.notEqual(next.attempt.requestId, a.attempt.requestId, 'a second real call gets a fresh id');
});
test('failure: no saved state is shown, the error is kept, buttons are usable again', () => {
  const a = beginAttempt({}, 7, 'interested', '', ids());
  const failed = failAttempt(a.rows, 7, { status: 0, message: 'Could not reach the server.' });
  assert.equal(failed[7].pending, false); assert.equal(failed[7].error, 'Could not reach the server.'); assert.equal(failed[7].last, null);
  assert.ok(beginAttempt(failed, 7, 'interested', '', ids()).attempt);
});
test('failure after an earlier success: the earlier "Saved" line is kept, the new error is shown next to it, and nothing is overwritten', () => {
  const makeId = ids();
  let rows = succeedAttempt(beginAttempt({}, 7, 'no_response', '', makeId).rows, 7, ok('no_response'));
  rows = failAttempt(beginAttempt(rows, 7, 'interested', '', makeId).rows, 7, { status: 500, message: 'Server error.' });
  assert.equal(rows[7].last.outcome, 'no_response'); assert.equal(rows[7].error, 'Server error.');
});
test('retry after a lost connection or server error re-sends the SAME request id for the same button (so it cannot be counted twice)', () => {
  const makeId = ids();
  const a = beginAttempt({}, 7, 'interested', '', makeId);
  for (const status of [0, 500, 502, 408, 429]) {
    const failed = failAttempt(a.rows, 7, { status, message: 'x' });
    assert.equal(beginAttempt(failed, 7, 'interested', '', makeId).attempt.requestId, a.attempt.requestId, 'status ' + status);
  }
});
test('retry uses a NEW request id when the button, the follow-up date, or the server\'s verdict changed', () => {
  const makeId = ids();
  const a = beginAttempt({}, 7, 'follow_up', '2026-10-20', makeId);
  const netFail = failAttempt(a.rows, 7, { status: 0, message: 'x' });
  assert.notEqual(beginAttempt(netFail, 7, 'no_response', '', makeId).attempt.requestId, a.attempt.requestId, 'different button');
  assert.notEqual(beginAttempt(netFail, 7, 'follow_up', '2026-10-21', makeId).attempt.requestId, a.attempt.requestId, 'different date');
  const refused = failAttempt(a.rows, 7, { status: 400, message: 'bad date' });
  assert.equal(refused[7].retry, null);
  assert.notEqual(beginAttempt(refused, 7, 'follow_up', '2026-10-20', makeId).attempt.requestId, a.attempt.requestId, 'the server refused it, start fresh');
});
test('the follow-up date travels with the attempt (empty -> null)', () => {
  assert.equal(beginAttempt({}, 1, 'follow_up', '2026-10-20', ids()).attempt.followUpDate, '2026-10-20');
  assert.equal(beginAttempt({}, 1, 'follow_up', '', ids()).attempt.followUpDate, null);
});
test('messages: saved, duplicate (ignored click) and a status that could not be updated are all stated plainly', () => {
  assert.match(describeSaved({ outcome: 'interested', duplicate: false, leadStatusUpdated: true, calledAt: '2026-10-13 05:00:00' }), /^Saved: Interested at /);
  assert.match(describeSaved({ outcome: 'interested', duplicate: true, leadStatusUpdated: null }), /Already saved: Interested \(the repeated click was ignored\)/);
  assert.match(describeSaved({ outcome: 'no_response', duplicate: false, leadStatusUpdated: false }), /lead status was not changed/);
  assert.equal(describeSaved(null), '');
});

// ---- lead list refresh (CAL-01) --------------------------------------------------------------------------------------------
import { beginListLoad, finishListLoad, failListLoad, listShowsRows } from './call-desk.js';

const loaded = finishListLoad({ leads: [{ id: 1 }, { id: 2 }], total: 2, pageSize: 20 });
test('refresh after a call: the rows already on screen stay visible and the data is kept (this is what keeps focus and scroll position)', () => {
  const during = beginListLoad(loaded, { background: true });
  assert.equal(during.state, 'refreshing'); assert.equal(listShowsRows(during), true); assert.equal(during.data, loaded.data);
});
test('a normal load (first visit, new filter, new page) still shows the loading message and hides the old rows, as before', () => {
  const during = beginListLoad(loaded);
  assert.equal(during.state, 'loading'); assert.equal(listShowsRows(during), false);
  assert.equal(beginListLoad({ state: 'loading', data: null }, { background: true }).state, 'loading', 'nothing to keep on screen yet, so a background load behaves like a normal one');
});
test('a refresh that fails keeps the rows and reports the problem; a normal load that fails shows the error and no rows', () => {
  const kept = failListLoad(beginListLoad(loaded, { background: true }), 'Network down', { background: true });
  assert.equal(kept.state, 'ready'); assert.equal(listShowsRows(kept), true); assert.equal(kept.refreshError, 'Network down'); assert.equal(kept.data, loaded.data);
  const hard = failListLoad(beginListLoad(loaded), 'Network down');
  assert.equal(hard.state, 'error'); assert.equal(hard.data, null); assert.equal(listShowsRows(hard), false);
});
test('a finished refresh clears an earlier refresh error', () => {
  const kept = failListLoad(loaded, 'x', { background: true });
  assert.equal(beginListLoad(kept, { background: true }).refreshError, '');
  assert.equal(finishListLoad({ leads: [] }).refreshError, '');
});
