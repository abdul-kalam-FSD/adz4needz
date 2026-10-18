import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, fromDecimalString, formatMoney, sumMoney, paymentStatus } from '../src/lib/money.js';

test('parseMoney accepts positive amounts with at most 2 decimals, as numbers or strings', () => {
  assert.equal(parseMoney(12500), 1250000n);
  assert.equal(parseMoney('12500.5'), 1250050n);
  assert.equal(parseMoney(' 0.01 '), 1n);
  assert.equal(parseMoney('9999999999.99'), 999999999999n);
  assert.equal(parseMoney(1000.5), 100050n);
  assert.equal(parseMoney('007'), 700n);
});
test('parseMoney rejects zero, negatives, 3+ decimals, huge values, exponents, separators and non-numbers', () => {
  for (const bad of [0, '0', '0.00', -1, '-5', '1.234', 0.1 + 0.2, '10000000000', 1e21, 1e-7, '1e3', '1,000', '₹100', '12 000', '+5', '', ' ', '.5', '5.', 'abc', NaN, Infinity, null, undefined, true, [], {}, '١٢٣']) {
    assert.equal(parseMoney(bad), null, JSON.stringify(bad));
  }
});
test('fromDecimalString / formatMoney round-trip exactly (no floating point)', () => {
  for (const t of ['0.00', '0.01', '0.10', '12500.00', '9999999999.99', '123456.70']) assert.equal(formatMoney(fromDecimalString(t)), t);
  assert.equal(fromDecimalString('0'), 0n); assert.equal(fromDecimalString('1250'), 125000n); assert.equal(fromDecimalString(null), 0n);
  assert.equal(formatMoney(fromDecimalString('0.10') + fromDecimalString('0.20')), '0.30', 'classic 0.1 + 0.2 problem does not occur');
  assert.equal(formatMoney(-150n), '-1.50');
  assert.throws(() => fromDecimalString('abc')); assert.throws(() => fromDecimalString('1.234'));
  assert.equal(fromDecimalString('1.500'), 150n, 'trailing zeros beyond 2 decimals are harmless');
});
test('sumMoney adds BigInt amounts', () => { assert.equal(sumMoney([100n, 250n, 1n]), 351n); assert.equal(sumMoney([]), 0n); });
test('paymentStatus: Pending / Partially Paid / Paid derived from amounts', () => {
  assert.equal(paymentStatus(100000n, 0n), 'pending');
  assert.equal(paymentStatus(100000n, 1n), 'partially_paid');
  assert.equal(paymentStatus(100000n, 99999n), 'partially_paid');
  assert.equal(paymentStatus(100000n, 100000n), 'paid');
  assert.equal(paymentStatus(100000n, 100001n), 'paid', 'cannot normally happen (rejected on entry) but never reads as partial');
});
