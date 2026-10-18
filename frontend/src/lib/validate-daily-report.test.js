import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDailyReport, isRealDate } from './validate-daily-report.js';

const good = { reportDate: '2026-10-10', totalCalls: 50, interested: 10, notInterested: 20, followUpRequired: 5, noResponse: 15 };
const v = (o) => validateDailyReport({ ...good, ...o });

test('valid report passes and keeps numbers', () => {
  const r = v({}); assert.equal(r.ok, true); assert.equal(r.value.totalCalls, 50); assert.equal(r.value.reportDate, '2026-10-10');
});
test('numeric strings and zero are accepted', () => {
  assert.equal(v({ totalCalls: ' 7 ' }).value.totalCalls, 7);
  assert.equal(v({ totalCalls: 0, interested: '0', notInterested: 0, followUpRequired: 0, noResponse: 0 }).ok, true);
});
test('categories are NOT required to match total calls', () => {
  assert.equal(v({ totalCalls: 1, interested: 99, notInterested: 99 }).ok, true);
});
test('rejects blank, negative, decimal, text, exponent, boolean, null, object', () => {
  for (const bad of ['', '   ', -1, '-1', 2.5, '2.5', 'abc', '1e3', '+5', true, null, undefined, {}, [], NaN, Infinity]) {
    const r = v({ totalCalls: bad });
    assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
    assert.ok(r.errors.totalCalls);
  }
});
test('rejects numbers above the database limit', () => {
  assert.equal(v({ totalCalls: 4294967295 }).ok, true);
  assert.equal(v({ totalCalls: 4294967296 }).ok, false);
  assert.equal(v({ totalCalls: '99999999999999999999' }).ok, false);
});
test('date must be a real YYYY-MM-DD date', () => {
  for (const bad of ['', '10/10/2026', '2026-02-30', '2026-13-01', '2026-1-1', 20261010, null]) assert.equal(v({ reportDate: bad }).ok, false);
  assert.equal(isRealDate('2028-02-29'), true); assert.equal(isRealDate('2027-02-29'), false);
});
test('reports every bad field, and ignores unknown/extra fields like userId', () => {
  const r = validateDailyReport({ reportDate: '', totalCalls: '', interested: 'x', notInterested: 1, followUpRequired: -2, noResponse: 1, userId: 5 });
  assert.deepEqual(Object.keys(r.errors).sort(), ['followUpRequired', 'interested', 'reportDate', 'totalCalls']);
  assert.equal('userId' in v({ userId: 5 }).value, false);
});
test('non-object bodies are rejected', () => {
  for (const b of [null, undefined, 'x', 5, []]) assert.equal(validateDailyReport(b).ok, false);
});
