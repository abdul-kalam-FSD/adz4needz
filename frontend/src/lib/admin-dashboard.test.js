import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardCards, todoItems } from './admin-dashboard.js';

test('cards use the loaded figures and show null (not zero) for what failed to load', () => {
  const all = dashboardCards({ calls: { totals: { totalCalls: 12, interestedLeads: 3, callsRecorded: 2, bdeCount: 5, conversionRate: 25 } }, interviews: { totals: { attended: 2, scheduled: 4, attendancePending: 1 } }, month: { revenue: '12500.00' } });
  assert.deepEqual(all.map((c) => c.value), [12, 3, '2 of 4', '12500.00']);
  assert.equal(all[0].note, '2 of 5 BDEs recorded calls'); assert.equal(all[1].note, '25% of calls'); assert.equal(all[2].note, '1 not marked yet');
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
