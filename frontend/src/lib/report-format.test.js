import test from 'node:test';
import assert from 'node:assert/strict';
import { currentMonth, shiftMonth, formatPercent, formatCount, formatAmount, barWidth, targetInput, callSourceNote, distinctLeadsNote } from './report-format.js';

test('months', () => {
  assert.equal(currentMonth(new Date(2026, 9, 13)), '2026-10');
  assert.equal(shiftMonth('2026-12', 1), '2027-01'); assert.equal(shiftMonth('2026-01', -1), '2025-12'); assert.equal(shiftMonth('bad', 1), 'bad');
  assert.equal(shiftMonth('2000-01', -1), '2000-01', 'stays inside the supported range');
});
test('formatting keeps "no target" visibly different from zero', () => {
  assert.equal(formatPercent(null), '—'); assert.equal(formatPercent(0), '0%'); assert.equal(formatPercent(125.5), '125.5%');
  assert.equal(formatCount(undefined), '—'); assert.equal(formatCount(0), '0'); assert.equal(formatAmount(null), '—');
  assert.match(formatAmount('12500.50'), /12,?500\.50/);
  assert.equal(barWidth(null), 0); assert.equal(barWidth(140), 100); assert.equal(barWidth(-3), 0); assert.equal(barWidth(42.5), 42.5);
});
test('targetInput', () => {
  assert.deepEqual(targetInput('', 'count'), { value: null }); assert.deepEqual(targetInput(' 600 ', 'count'), { value: 600 }); assert.ok(targetInput('1.5', 'count').error);
  assert.deepEqual(targetInput('50000.5', 'money'), { value: '50000.5' }); assert.ok(targetInput('0', 'money').error); assert.ok(targetInput('1.234', 'money').error); assert.ok(targetInput('abc', 'money').error);
});

test('call source note: says how many days came from the Call desk and from a manual report, and that a mixed day was not added twice', () => {
  const calls = (o) => ({ daysReported: 3, repeatCalls: 1, sources: { callLogDays: 2, manualOnlyDays: 1, mixedDays: 0 }, ...o });
  assert.equal(callSourceNote(calls()), '3 days with activity: 2 from the Call desk, 1 from a manual report');
  assert.match(callSourceNote(calls({ sources: { callLogDays: 2, manualOnlyDays: 1, mixedDays: 1 } })), /1 day had both \(the manual report was ignored, not added\)/);
  assert.equal(callSourceNote(calls({ daysReported: 1, sources: { callLogDays: 0, manualOnlyDays: 1, mixedDays: 0 } })), '1 day with activity: 0 from the Call desk, 1 from a manual report');
  assert.equal(callSourceNote(calls({ daysReported: 0 })), 'No days with activity');
  assert.equal(callSourceNote({ daysReported: 4 }), '4 days with activity: 0 from the Call desk, 4 from a manual report', 'older API answer without sources = manual');
});
test('distinct leads note never shows a misleading zero for manual-only BDEs', () => {
  assert.equal(distinctLeadsNote({ repeatCalls: 2, sources: { callLogDays: 3 } }), '2 repeat calls; Call desk days only');
  assert.equal(distinctLeadsNote({ repeatCalls: 1, sources: { callLogDays: 1 } }), '1 repeat call; Call desk days only');
  assert.equal(distinctLeadsNote({ repeatCalls: 0, sources: { callLogDays: 0 } }), 'Call desk days only; none this month');
  assert.equal(distinctLeadsNote({}), 'Call desk days only; none this month');
});
