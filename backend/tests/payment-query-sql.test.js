import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentQuery, parsePaymentRangeQuery } from '../src/lib/payment-query.js';
import { buildPaymentSearch, buildRangeFilters, STATUS_SQL, PAID_JOIN } from '../src/lib/payment-search-sql.js';

const parse = (q, o) => parsePaymentQuery(q, o);
const F = (over = {}) => ({ q: '', status: null, leadId: null, bdeId: null, commitmentFrom: null, commitmentTo: null, missingProof: false, ...over });

test('query defaults', () => {
  const r = parse({}); assert.equal(r.ok, true);
  assert.deepEqual(r.value, { q: '', status: null, leadId: null, bdeId: null, commitmentFrom: null, commitmentTo: null, missingProof: false, page: 1, pageSize: 25 });
});
test('bad filters are rejected, repeated params (arrays) too; "all"/empty mean no filter', () => {
  for (const q of [{ status: 'done' }, { status: ['paid', 'pending'] }, { leadId: 'x' }, { leadId: '0' }, { commitmentFrom: '2026-02-30' }, { missingProof: 'no' }, { page: '0' }, { pageSize: '101' }, { q: 'x'.repeat(101) }]) assert.equal(parse(q).ok, false, JSON.stringify(q));
  assert.equal(parse({ status: 'all' }).value.status, null); assert.equal(parse({ status: '' }).ok, true);
  for (const s of ['pending', 'partially_paid', 'paid']) assert.equal(parse({ status: s }).value.status, s);
  assert.equal(parse({ missingProof: 'yes' }).value.missingProof, true);
});
test('date range order and bdeId (admin only)', () => {
  assert.ok(parse({ commitmentFrom: '2026-06-20', commitmentTo: '2026-06-10' }).errors.commitmentTo);
  assert.equal(parse({ commitmentFrom: '2026-06-10', commitmentTo: '2026-06-10' }).ok, true);
  assert.equal(parse({ bdeId: '5' }, { admin: true }).value.bdeId, '5'); assert.equal(parse({ bdeId: '5' }).value.bdeId, null);
  assert.ok(parse({ bdeId: 'x' }, { admin: true }).errors.bdeId);
  assert.ok(parsePaymentRangeQuery({ dateFrom: '2026-07-01', dateTo: '2026-06-01' }).errors.dateTo);
  assert.equal(parsePaymentRangeQuery({}).ok, true); assert.ok(parsePaymentRangeQuery({ dateFrom: 'nope' }).errors.dateFrom);
});
test('SQL: BDE scope always applied and ignores bdeId; admin team-wide unless bdeId given', () => {
  let r = buildPaymentSearch({ scopeUserId: 7, filters: F({ bdeId: '9' }) });
  assert.equal(r.whereSql, 'WHERE p.user_id = ?'); assert.deepEqual(r.params, [7]);
  r = buildPaymentSearch({ scopeUserId: null, filters: F() }); assert.equal(r.whereSql, ''); assert.deepEqual(r.params, []);
  assert.deepEqual(buildPaymentSearch({ scopeUserId: null, filters: F({ bdeId: '9' }) }).params, ['9']);
});
test('SQL: user text only lands in params, wildcards escaped', () => {
  const evil = "x' OR 1=1 -- 50%_";
  const r = buildPaymentSearch({ scopeUserId: 1, filters: F({ q: evil }) });
  assert.ok(!r.whereSql.includes('OR 1=1')); assert.equal(r.params[1], "%x' OR 1=1 -- 50!%!_%"); assert.equal(r.params.length, 5);
});
test('SQL: status uses the derived expression; ranges are inclusive; missing-proof is a subquery', () => {
  const r = buildPaymentSearch({ scopeUserId: 1, filters: F({ status: 'partially_paid', commitmentFrom: '2026-06-01', commitmentTo: '2026-06-30', leadId: '4', missingProof: true }) });
  assert.ok(r.whereSql.includes(STATUS_SQL)); assert.match(r.whereSql, /p\.commitment_date >= \?/); assert.match(r.whereSql, /p\.commitment_date <= \?/);
  assert.match(r.whereSql, /NOT EXISTS \(SELECT 1 FROM payment_receipts/);
  assert.deepEqual(r.params, [1, '4', 'partially_paid', '2026-06-01', '2026-06-30']);
});
test('status expression and paid join: grouped sub-query (a payment is never multiplied by its instalments)', () => {
  assert.match(PAID_JOIN, /GROUP BY payment_id/); assert.match(STATUS_SQL, /'pending'.*'partially_paid'.*'paid'/s);
});
test('overview range: commitments by commitment_date, money by paid_on, both inclusive', () => {
  assert.deepEqual(buildRangeFilters({ dateFrom: null, dateTo: null }), { commit: { sql: '', params: [] }, paid: { sql: '', params: [] } });
  const r = buildRangeFilters({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
  assert.match(r.commit.sql, /p\.commitment_date >= \?.*p\.commitment_date <= \?/s); assert.match(r.paid.sql, /i\.paid_on >= \?.*i\.paid_on <= \?/s);
  assert.deepEqual(r.commit.params, ['2026-06-01', '2026-06-30']); assert.deepEqual(r.paid.params, ['2026-06-01', '2026-06-30']);
});
