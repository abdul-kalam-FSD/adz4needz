import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInterviewQuery, parseOverviewQuery } from '../src/lib/interview-query.js';
import { buildInterviewSearch, buildOverviewRange } from '../src/lib/interview-search-sql.js';

const parse = (q, o) => parseInterviewQuery(q, o);

test('query defaults', () => {
  const r = parse({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { q: '', attendance: null, outcome: null, interested: null, paymentConfirmed: null, when: null, scheduledFrom: null, scheduledTo: null, leadId: null, bdeId: null, today: null, page: 1, pageSize: 25 });
});
test('"when" filters need a valid today; others do not', () => {
  for (const w of ['upcoming', 'today', 'needs_update']) { assert.ok(parse({ when: w }).errors.today, w); assert.equal(parse({ when: w, today: '2026-06-15' }).ok, true); }
  assert.equal(parse({ attendance: 'attended' }).ok, true);
});
test('bad filters are rejected, repeated params (arrays) too', () => {
  const bad = [{ attendance: 'present' }, { outcome: 'won' }, { interested: 'maybe' }, { paymentConfirmed: 'partial' }, { when: 'soon' }, { scheduledFrom: '2026-02-30' },
    { leadId: 'x' }, { leadId: '0' }, { page: '0' }, { pageSize: '101' }, { q: 'x'.repeat(101) }, { today: '15/06/2026' }, { attendance: ['attended', 'pending'] }, { leadId: ['1', '2'] }];
  for (const q of bad) assert.equal(parse(q).ok, false, JSON.stringify(q));
});
test('"all" or empty means no filter', () => {
  const r = parse({ attendance: 'all', outcome: '', when: 'all' });
  assert.equal(r.ok, true); assert.equal(r.value.attendance, null); assert.equal(r.value.when, null);
});
test('date range: from after to is rejected', () => {
  assert.ok(parse({ scheduledFrom: '2026-06-20', scheduledTo: '2026-06-10' }).errors.scheduledTo);
  assert.equal(parse({ scheduledFrom: '2026-06-10', scheduledTo: '2026-06-10' }).ok, true);
  assert.ok(parseOverviewQuery({ scheduledFrom: '2026-06-20', scheduledTo: '2026-06-10' }).errors.scheduledTo);
  assert.equal(parseOverviewQuery({}).ok, true);
});
test('bdeId is honoured for admin only', () => {
  assert.equal(parse({ bdeId: '5' }, { admin: true }).value.bdeId, '5');
  assert.equal(parse({ bdeId: '5' }).value.bdeId, null);
  assert.ok(parse({ bdeId: 'x' }, { admin: true }).errors.bdeId);
});

const F = (over = {}) => ({ q: '', attendance: null, outcome: null, interested: null, paymentConfirmed: null, when: null, scheduledFrom: null, scheduledTo: null, leadId: null, bdeId: null, today: null, ...over });

test('SQL: BDE scope is always applied and ignores bdeId; admin scope uses bdeId only if given', () => {
  let r = buildInterviewSearch({ scopeUserId: 7, filters: F({ bdeId: '9' }) });
  assert.equal(r.whereSql, 'WHERE i.user_id = ?'); assert.deepEqual(r.params, [7]);
  r = buildInterviewSearch({ scopeUserId: null, filters: F() });
  assert.equal(r.whereSql, ''); assert.deepEqual(r.params, []);
  r = buildInterviewSearch({ scopeUserId: null, filters: F({ bdeId: '9' }) });
  assert.deepEqual(r.params, ['9']);
});
test('SQL: user text only ever lands in params (placeholders), wildcards escaped', () => {
  const evil = "x' OR 1=1 -- 50%_";
  const r = buildInterviewSearch({ scopeUserId: 1, filters: F({ q: evil }) });
  assert.ok(!r.whereSql.includes('OR 1=1') && !r.whereSql.includes('x'));
  assert.equal(r.params[1], "%x' OR 1=1 -- 50!%!_%");
  assert.equal(r.params.length, 5);
});
test('SQL: when = today / upcoming / needs_update use day boundaries', () => {
  let r = buildInterviewSearch({ scopeUserId: 1, filters: F({ when: 'today', today: '2026-12-31' }) });
  assert.deepEqual(r.params, [1, '2026-12-31 00:00:00', '2027-01-01 00:00:00']);
  r = buildInterviewSearch({ scopeUserId: 1, filters: F({ when: 'upcoming', today: '2026-06-15' }) });
  assert.deepEqual(r.params, [1, '2026-06-16 00:00:00']);
  r = buildInterviewSearch({ scopeUserId: 1, filters: F({ when: 'needs_update', today: '2026-06-15' }) });
  assert.match(r.whereSql, /i\.scheduled_at < \? AND i\.attendance = 'pending'/); assert.deepEqual(r.params, [1, '2026-06-15 00:00:00']);
});
test('SQL: enum, interest, payment and range filters', () => {
  const r = buildInterviewSearch({ scopeUserId: 1, filters: F({ attendance: 'attended', outcome: 'selected', interested: 'unknown', paymentConfirmed: 'yes', leadId: '4', scheduledFrom: '2026-06-01', scheduledTo: '2026-06-30' }) });
  assert.match(r.whereSql, /i\.attendance = \?/); assert.match(r.whereSql, /i\.outcome = \?/);
  assert.match(r.whereSql, /i\.interested_in_joining IS NULL/); assert.match(r.whereSql, /EXISTS \(SELECT 1 FROM payments pc WHERE pc\.lead_id = i\.lead_id\)/, 'derived from payment records');
  assert.doesNotMatch(r.whereSql, /payment_confirmed/, 'the legacy stored column is no longer used');
  assert.deepEqual(r.params, [1, '4', 'attended', 'selected', '2026-06-01 00:00:00', '2026-07-01 00:00:00']);
  const no = buildInterviewSearch({ scopeUserId: 1, filters: F({ interested: 'yes', paymentConfirmed: 'no' }) }).whereSql;
  assert.match(no, /NOT EXISTS \(SELECT 1 FROM payments pc/); assert.match(no, /i\.interested_in_joining = 1/);
});
test('overview range goes into the JOIN condition (inclusive end date)', () => {
  assert.deepEqual(buildOverviewRange({ scheduledFrom: null, scheduledTo: null }), { onSql: '', params: [] });
  const r = buildOverviewRange({ scheduledFrom: '2026-06-01', scheduledTo: '2026-06-30' });
  assert.deepEqual(r.params, ['2026-06-01 00:00:00', '2026-07-01 00:00:00']);
  assert.match(r.onSql, /^ AND /);
});
