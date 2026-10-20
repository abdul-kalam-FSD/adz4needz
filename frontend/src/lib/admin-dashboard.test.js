import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardCards, todoItems } from './admin-dashboard.js';
import { formatPercent } from './call-desk.js';

test('cards use the loaded figures and show null (not zero) for what failed to load', () => {
  const all = dashboardCards({ calls: { totals: { totalCalls: 12, interestedLeads: 3, callsRecorded: 2, bdeCount: 5, conversionRate: 0.25 } }, interviews: { totals: { attended: 2, scheduled: 4, attendancePending: 1 } }, month: { revenue: '12500.00' } });
  assert.deepEqual(all.map((c) => c.value), [12, 3, '2 of 4', '12500.00']);
  assert.equal(all[0].note, '2 of 5 BDEs recorded calls'); assert.equal(all[1].note, '25.0% of calls'); assert.equal(all[2].note, '1 not marked yet');
  const none = dashboardCards({ calls: null, interviews: null, month: null });
  assert.deepEqual(none.map((c) => c.value), [null, null, null, null]); assert.ok(none.every((c) => c.note === ''));
  assert.equal(dashboardCards({ calls: { totals: { totalCalls: 0, interestedLeads: 0, callsRecorded: 0, bdeCount: 0, conversionRate: null } } })[1].note, '');
});
test('to-do lists only real, non-zero, loaded counts; singular and plural text', () => {
  assert.deepEqual(todoItems({}), []);
  assert.deepEqual(todoItems({ leads: { overdue: 0 }, interviews: { needsUpdate: 0 }, calls: { totals: { noActivity: 0 } } }), []);
  const t = todoItems({ leads: { overdue: 1 }, interviews: { needsUpdate: 3 }, calls: { totals: { noActivity: 11 } } });
  assert.deepEqual(t.map((i) => [i.key, i.count, i.to]), [['overdue', 1, '/admin/leads'], ['unmarked', 3, '/admin/interviews'], ['idle', 11, '/admin/bdes']]);
  assert.equal(t[0].text, 'follow-up is overdue'); assert.equal(t[1].text, 'past interviews are not marked');
});

test('conversion note: the API sends a fraction, so 0.214 is shown as 21.4% (not 0.214%), exactly like the per-BDE table', () => {
  const note = (conversionRate) => dashboardCards({ calls: { totals: { totalCalls: 70, interestedLeads: 15, callsRecorded: 1, bdeCount: 3, conversionRate } } })[1].note;
  assert.equal(note(0.214), '21.4% of calls');
  assert.equal(note(0.167), '16.7% of calls');
  assert.equal(note(1), '100.0% of calls');
  assert.equal(note(0), '0.0% of calls');   // calls were made and none was interested: a real 0%, not "no data"
  assert.equal(note(0.214), `${formatPercent(0.214)} of calls`);
});
test('conversion note: null (no calls), missing and invalid values give no note instead of NaN% or a made-up figure', () => {
  const note = (conversionRate) => dashboardCards({ calls: { totals: { totalCalls: 0, interestedLeads: 0, callsRecorded: 0, bdeCount: 3, conversionRate } } })[1].note;
  for (const bad of [null, undefined, NaN, Infinity, '0.2', {}, 'abc']) assert.equal(note(bad), '', 'no note for ' + String(bad));
});
