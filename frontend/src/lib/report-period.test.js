import test from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, rangeProblem, shiftDay } from './report-period.js';

test('day, week (Monday to Sunday) and month ranges', () => {
  assert.deepEqual(periodRange('day', '2026-10-16'), { from: '2026-10-16', to: '2026-10-16' });
  assert.deepEqual(periodRange('week', '2026-10-16'), { from: '2026-10-12', to: '2026-10-18' }, 'Friday 16 Oct 2026');
  assert.deepEqual(periodRange('week', '2026-10-18'), { from: '2026-10-12', to: '2026-10-18' }, 'Sunday belongs to the week that started Monday');
  assert.deepEqual(periodRange('week', '2026-10-12'), { from: '2026-10-12', to: '2026-10-18' }, 'Monday');
  assert.deepEqual(periodRange('week', '2026-01-01'), { from: '2025-12-29', to: '2026-01-04' }, 'crosses a year');
  assert.deepEqual(periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodRange('month', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' }, 'leap year');
  assert.equal(periodRange('custom', '2026-10-16'), null);
});
test('rangeProblem mirrors the server rules', () => {
  assert.equal(rangeProblem('2026-10-01', '2026-10-31'), '');
  assert.match(rangeProblem('', '2026-10-31'), /both/); assert.match(rangeProblem('2026-10-05', '2026-10-01'), /before/);
  assert.match(rangeProblem('2026-01-01', '2027-01-02'), /at most 366/); assert.equal(rangeProblem('2026-01-01', '2027-01-01'), '');
});
test('shiftDay moves across month ends', () => { assert.equal(shiftDay('2026-10-31', 1), '2026-11-01'); assert.equal(shiftDay('2026-03-01', -1), '2026-02-28'); });
