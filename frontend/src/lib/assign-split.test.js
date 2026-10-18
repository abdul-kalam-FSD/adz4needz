import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestSplit } from './assign-split.js';
test('suggestSplit favours the least-loaded BDEs and sums to the total', () => {
  assert.deepEqual(suggestSplit(4, [{ id: 1, openLeads: 0 }, { id: 2, openLeads: 0 }]), [{ id: 1, count: 2 }, { id: 2, count: 2 }]);
  assert.deepEqual(suggestSplit(3, [{ id: 1, openLeads: 0 }, { id: 2, openLeads: 10 }]), [{ id: 1, count: 3 }]);
  assert.deepEqual(suggestSplit(7, [{ id: 3, openLeads: 2 }, { id: 1, openLeads: 2 }, { id: 2, openLeads: 2 }]), [{ id: 1, count: 3 }, { id: 2, count: 2 }, { id: 3, count: 2 }]);
  assert.deepEqual(suggestSplit(0, [{ id: 1, openLeads: 0 }]), []); assert.deepEqual(suggestSplit(5, []), []);
});
