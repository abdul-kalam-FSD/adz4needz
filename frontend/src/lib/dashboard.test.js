import test from 'node:test';
import assert from 'node:assert/strict';
import { todayLocal, reportForDay, attentionItems } from './dashboard.js';

test('todayLocal and reportForDay', () => {
  assert.equal(todayLocal(new Date(2026, 9, 3)), '2026-10-03');
  const rs = [{ reportDate: '2026-10-13', totalCalls: 5 }, { reportDate: '2026-10-12T00:00:00.000Z', totalCalls: 9 }];
  assert.equal(reportForDay(rs, '2026-10-13').totalCalls, 5); assert.equal(reportForDay(rs, '2026-10-12').totalCalls, 9);
  assert.equal(reportForDay(rs, '2026-10-11'), null); assert.equal(reportForDay(undefined, 'x'), null);
});
test('attentionItems lists only real, non-zero things in a stable order', () => {
  assert.deepEqual(attentionItems({ followUps: { overdue: 0, today: 0 }, interviews: { today: 0, needsUpdate: 0 }, proofs: { rejected: 0 }, reportSubmitted: true }), []);
  const items = attentionItems({ followUps: { overdue: 1, today: 3 }, interviews: { today: 1, needsUpdate: 2 }, proofs: { rejected: 2 }, reportSubmitted: false });
  assert.deepEqual(items.map((i) => i.key), ['report', 'overdue', 'fu-today', 'iv-update', 'iv-today', 'proofs']);
  assert.match(items[1].text, /^1 lead follow-up is overdue/); assert.match(items[2].text, /^3 follow-ups are due today/); assert.match(items[5].text, /2 payment proofs were rejected/);
  assert.deepEqual(attentionItems({}), []); // nothing known yet (still loading) -> nothing shown, and no "report missing" claim
});
