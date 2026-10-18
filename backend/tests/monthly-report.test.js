import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMonth, toPaise, paiseText, percentOf, validateTargets, shapeBdeRow, buildMonthlyReport } from '../src/lib/monthly-report.js';

test('parseMonth: boundaries incl. December rollover and leap February', () => {
  assert.deepEqual(parseMonth('2026-10'), { month: '2026-10', start: '2026-10-01', endExclusive: '2026-11-01', startTs: '2026-10-01 00:00:00', endTs: '2026-11-01 00:00:00', label: 'October 2026', days: 31 });
  assert.equal(parseMonth('2026-12').endExclusive, '2027-01-01'); assert.equal(parseMonth('2028-02').days, 29); assert.equal(parseMonth('2027-02').days, 28);
  for (const bad of ['2026-13', '2026-00', '1999-12', '2026-1', '2026-10-01', '', null, undefined, 202610, '2026/10']) assert.equal(parseMonth(bad), null, String(bad));
});

test('money helpers are exact', () => {
  assert.equal(toPaise('12500.50'), 1250050n); assert.equal(toPaise('7'), 700n); assert.equal(toPaise(null), 0n); assert.equal(toPaise('0.10'), 10n);
  assert.throws(() => toPaise('1.234')); assert.throws(() => toPaise('abc'));
  assert.equal(paiseText(1250050n), '12500.50'); assert.equal(paiseText(5n), '0.05'); assert.equal(paiseText(0n), '0.00');
  assert.equal(paiseText(toPaise('0.10') + toPaise('0.20')), '0.30');
});

test('percentOf: one decimal, floor, not capped, null without a target', () => {
  assert.equal(percentOf(50, 200), 25); assert.equal(percentOf(1, 3), 33.3); assert.equal(percentOf(250, 200), 125); assert.equal(percentOf(0, 10), 0);
  assert.equal(percentOf(5, 0), null); assert.equal(percentOf(5, null), null); assert.equal(percentOf(toPaise('250.00'), toPaise('1000.00')), 25);
});

test('validateTargets: blanks clear a target; counts are integers; revenue is a positive 2-decimal amount', () => {
  assert.deepEqual(validateTargets({ targetCalls: '600', targetInterested: 40, targetInterviews: '', targetRevenue: '50000.5' }).value, { targetCalls: 600, targetInterested: 40, targetInterviews: null, targetRevenue: '50000.50' });
  assert.deepEqual(validateTargets({}).value, { targetCalls: null, targetInterested: null, targetInterviews: null, targetRevenue: null });
  assert.equal(validateTargets({ targetCalls: 0 }).value.targetCalls, 0);
  for (const bad of [{ targetCalls: -1 }, { targetCalls: 1.5 }, { targetCalls: 'abc' }, { targetCalls: 2_000_000 }, { targetRevenue: 0 }, { targetRevenue: '1.234' }, { targetRevenue: 'x' }]) assert.equal(validateTargets(bad).ok, false, JSON.stringify(bad));
  assert.equal(validateTargets([]).ok, false); assert.equal(validateTargets(null).ok, false);
});

const row = (o = {}) => ({ id: 10, employee_id: 'E10', name: 'Asha', is_active: 1, days_reported: '5', total_calls: '100', interested: '20', not_interested: '40', follow_up_required: '25', no_response: '15',
  leads_created: '12', interviews_scheduled: '6', interviews_attended: '4', interviews_no_show: '1', interviews_selected: '3', commitments: '2', committed: '30000.00', received: '12500.50',
  target_calls: 200, target_interested: 40, target_interviews: null, target_revenue: '25001.00', ...o });

test('shapeBdeRow: mysql2 string sums become numbers, achievement is calculated only where a target exists', () => {
  const b = shapeBdeRow(row());
  assert.equal(b.figures.calls.total, 100); assert.equal(b.figures.revenueReceived, '12500.50'); assert.equal(b.figures.payments.committedAmount, '30000.00');
  assert.deepEqual(b.achievement, { calls: 50, interested: 50, interviews: null, revenue: 50 });
  assert.equal(b.calculated.interestedPercentOfCalls, 20); assert.equal(b.calculated.averageCallsPerReportedDay, 20);
  const none = shapeBdeRow(row({ total_calls: null, interested: null, days_reported: null, received: null, committed: null, target_calls: null, target_interested: null, target_revenue: null }));
  assert.equal(none.figures.calls.total, 0); assert.equal(none.figures.revenueReceived, '0.00'); assert.equal(none.calculated.interestedPercentOfCalls, null);
  assert.deepEqual(none.achievement, { calls: null, interested: null, interviews: null, revenue: null });
});

test('buildMonthlyReport: team totals are sums; team target is the sum of targets that exist; money stays exact', () => {
  const r = buildMonthlyReport(parseMonth('2026-10'), [row(), row({ id: 11, employee_id: 'E11', name: 'Ravi', total_calls: '50', interested: '5', received: '0.10', target_calls: null, target_interested: null, target_revenue: null })]);
  assert.equal(r.month, '2026-10'); assert.equal(r.label, 'October 2026'); assert.equal(r.from, '2026-10-01'); assert.equal(r.toExclusive, '2026-11-01');
  assert.equal(r.total.figures.calls.total, 150); assert.equal(r.total.figures.calls.interested, 25); assert.equal(r.total.figures.revenueReceived, '12500.60');
  assert.equal(r.total.targets.calls, 200); assert.equal(r.total.achievement.calls, 75); assert.equal(r.total.bdesWithTargets, 1);
  assert.equal(r.total.targets.interviews, null); assert.equal(r.total.achievement.interviews, null);
  assert.ok(r.basis.achievement.startsWith('CALCULATED'));
  const empty = buildMonthlyReport(parseMonth('2026-10'), []);
  assert.equal(empty.bdes.length, 0); assert.equal(empty.total.figures.revenueReceived, '0.00'); assert.equal(empty.total.targets.calls, null);
});

// ---- Checkpoint 6: call-log figures in the monthly shape ----
test('target progress for "interested" is measured against interested LEADS, not interested calls', () => {
  const b = shapeBdeRow(row({ interested: '7', interested_calls: '9', target_interested: 10 }));
  assert.equal(b.figures.calls.interested, 7); assert.equal(b.figures.calls.interestedCalls, 9); assert.equal(b.achievement.interested, 70, '7 of 10, not 9 of 10');
  assert.equal(b.calculated.interestedPercentOfCalls, 7, '7 interested leads / 100 calls');
});
test('a legacy row without call-log columns is treated as manual-only: same numbers as before, days counted as manual days', () => {
  const b = shapeBdeRow(row()); const c = b.figures.calls;
  assert.equal(c.total, 100); assert.equal(c.interested, 20); assert.equal(c.interestedCalls, 20); assert.equal(c.distinctLeads, 0); assert.equal(c.repeatCalls, 0);
  assert.deepEqual(c.sources, { callLogDays: 0, manualOnlyDays: 5, mixedDays: 0, callLogCalls: 0, manualCalls: 100, manualIgnoredCalls: 0 });
  assert.equal(b.achievement.calls, 50); assert.equal(b.calculated.interestedPercentOfCalls, 20); assert.equal(b.calculated.averageCallsPerReportedDay, 20);
});
test('conversion in the monthly shape is the shared definition (one decimal, half-up), and the team row is total interested / total calls', () => {
  const r = buildMonthlyReport(parseMonth('2026-10'), [row({ id: 1, total_calls: '30', interested: '5' }), row({ id: 2, total_calls: '3', interested: '1' })]);
  assert.equal(r.bdes[0].calculated.interestedPercentOfCalls, 16.7); assert.equal(r.bdes[1].calculated.interestedPercentOfCalls, 33.3);
  assert.equal(r.total.calculated.interestedPercentOfCalls, 18.2, '6 / 33 = 18.18%, not the average of 16.7 and 33.3');
  assert.equal(r.total.figures.calls.distinctLeads, 0); assert.equal(r.total.figures.calls.sources.manualOnlyDays, 10);
});
test('the basis notes describe the single-source rule and the conversion formula (they are printed in the Excel "About" sheet)', () => {
  const r = buildMonthlyReport(parseMonth('2026-10'), [row()]);
  assert.match(r.basis.calls, /manual report is ignored \(never added\)/); assert.match(r.basis.conversion, /interested leads \/ total calls/); assert.match(r.basis.interested, /interested LEADS/);
});
