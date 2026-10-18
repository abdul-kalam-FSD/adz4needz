import test from 'node:test';
import assert from 'node:assert/strict';
import { columnLabels, rowLabels } from './table-labels.js';

test('columnLabels: one label per column, whitespace tidied, a spanning heading labels every column it covers', () => {
  assert.deepEqual(columnLabels([{ text: ' BDE ', colSpan: 1 }, { text: 'Total\n  calls', colSpan: 1 }, { text: 'Outcome', colSpan: 2 }]), ['BDE', 'Total calls', 'Outcome', 'Outcome']);
});
test('columnLabels: empty and malformed input never throws', () => {
  assert.deepEqual(columnLabels(undefined), []);
  assert.deepEqual(columnLabels([{ text: null, colSpan: 0 }, null]), ['', '']);
  assert.deepEqual(columnLabels([{ text: 'X', colSpan: 'abc' }]), ['X']);
});
test('rowLabels: follows colSpan so cells after a wide cell keep the right heading; extra cells get no label', () => {
  const labels = ['A', 'B', 'C'];
  assert.deepEqual(rowLabels(labels, [{ colSpan: 1 }, { colSpan: 1 }, { colSpan: 1 }]), ['A', 'B', 'C']);
  assert.deepEqual(rowLabels(labels, [{ colSpan: 2 }, { colSpan: 1 }]), ['A', 'C']);
  assert.deepEqual(rowLabels(labels, [{}, {}, {}, {}]), ['A', 'B', 'C', '']);
});
test('an actions column with an empty heading gets an empty label (the stylesheet then draws no label for it)', () => {
  assert.deepEqual(rowLabels(columnLabels([{ text: 'Name', colSpan: 1 }, { text: '', colSpan: 1 }]), [{}, {}]), ['Name', '']);
});
