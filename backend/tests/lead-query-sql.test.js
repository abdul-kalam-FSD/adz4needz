import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadQuery, parseSummaryQuery } from '../src/lib/lead-query.js';
import { buildLeadSearch, escapeLike } from '../src/lib/lead-search-sql.js';

const parse = (q, o) => parseLeadQuery(q, o);

test('query defaults', () => {
  const r = parse({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { q: '', statusId: null, followUp: null, followUpFrom: null, followUpTo: null, bdeId: null, today: null, page: 1, pageSize: 25 });
});
test('overdue/today/upcoming need a valid "today"; none/all do not', () => {
  for (const f of ['overdue', 'today', 'upcoming']) { assert.ok(parse({ followUp: f }).errors.today, f); assert.equal(parse({ followUp: f, today: '2026-10-10' }).ok, true); }
  assert.equal(parse({ followUp: 'none' }).ok, true); assert.equal(parse({ followUp: 'all' }).ok, true);
});
test('bad filters are rejected, repeated params (arrays) too', () => {
  for (const q of [{ followUp: 'soon' }, { statusId: 'x' }, { statusId: '0' }, { followUpFrom: '2026-02-30' }, { page: '0' }, { pageSize: '101' }, { pageSize: 'abc' }, { q: 'x'.repeat(101) }, { today: '10/10/2026' }, { q: ['a', 'b'] }, { statusId: ['1', '2'] }]) {
    assert.equal(parse(q).ok, false, JSON.stringify(q));
  }
});
test('date range: from after to is rejected', () => {
  assert.ok(parse({ followUpFrom: '2026-10-20', followUpTo: '2026-10-10' }).errors.followUpTo);
  assert.equal(parse({ followUpFrom: '2026-10-10', followUpTo: '2026-10-10' }).ok, true);
});
test('bdeId is honoured for admin only (BDE callers cannot widen scope with it)', () => {
  assert.equal(parse({ bdeId: '5' }, { admin: true }).value.bdeId, 5);
  assert.equal(parse({ bdeId: '5' }).value.bdeId, null);
  assert.ok(parse({ bdeId: 'x' }, { admin: true }).errors.bdeId);
});
test('summary needs a real today', () => {
  assert.equal(parseSummaryQuery({}).ok, false); assert.equal(parseSummaryQuery({ today: '2026-13-01' }).ok, false);
  assert.equal(parseSummaryQuery({ today: '2026-10-10' }).value.today, '2026-10-10');
});

const F = (o = {}) => ({ ...parse({ today: '2026-10-10' }).value, ...o });

test('SQL: BDE scope is ALWAYS present and uses a placeholder', () => {
  const r = buildLeadSearch({ scopeUserId: 7, filters: F() });
  assert.equal(r.whereSql, 'WHERE l.user_id = ?'); assert.deepEqual(r.params, [7]);
});
test('SQL: BDE scope cannot be overridden by a bdeId filter', () => {
  const r = buildLeadSearch({ scopeUserId: 7, filters: F({ bdeId: 99 }) });
  assert.deepEqual(r.params, [7]);
});
test('SQL: admin is team-wide unless a BDE filter is chosen', () => {
  assert.equal(buildLeadSearch({ scopeUserId: null, filters: F() }).whereSql, '');
  const r = buildLeadSearch({ scopeUserId: null, filters: F({ bdeId: 4 }) });
  assert.deepEqual(r.params, [4]);
});
test('SQL: search text is only ever a parameter, wildcards escaped', () => {
  const evil = "x' OR 1=1 --%_!";
  const r = buildLeadSearch({ scopeUserId: 1, filters: F({ q: evil }) });
  assert.ok(!r.whereSql.includes('OR 1=1'), 'user text must not appear in SQL');
  assert.equal(r.params.length, 5); assert.equal(r.params[1], "%x' OR 1=1 --!%!_!!%");
  assert.equal(escapeLike('50%_off!'), '50!%!_off!!');
});
test('SQL: status, overdue, today, upcoming, none and date range', () => {
  assert.deepEqual(buildLeadSearch({ scopeUserId: 1, filters: F({ statusId: 3 }) }).params, [1, 3]);
  let r = buildLeadSearch({ scopeUserId: 1, filters: F({ followUp: 'overdue' }) });
  assert.match(r.whereSql, /l\.follow_up_date < \? AND s\.closes_follow_up = 0/); assert.deepEqual(r.params, [1, '2026-10-10']);
  r = buildLeadSearch({ scopeUserId: 1, filters: F({ followUp: 'today' }) }); assert.deepEqual(r.params, [1, '2026-10-10']);
  r = buildLeadSearch({ scopeUserId: 1, filters: F({ followUp: 'upcoming' }) }); assert.deepEqual(r.params, [1, '2026-10-10', '2026-10-17']);
  r = buildLeadSearch({ scopeUserId: 1, filters: F({ followUp: 'none' }) }); assert.match(r.whereSql, /follow_up_date IS NULL/); assert.deepEqual(r.params, [1]);
  r = buildLeadSearch({ scopeUserId: 1, filters: F({ followUpFrom: '2026-10-01', followUpTo: '2026-10-31' }) }); assert.deepEqual(r.params, [1, '2026-10-01', '2026-10-31']);
});
test('SQL: placeholders always match params; combined filters', () => {
  const r = buildLeadSearch({ scopeUserId: 2, filters: F({ q: 'ab', statusId: 1, followUp: 'upcoming', followUpTo: '2026-12-31' }) });
  assert.equal((r.whereSql.match(/\?/g) || []).length, r.params.length);
});
