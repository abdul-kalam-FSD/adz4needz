import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityService } from '../src/modules/activity/activity.service.js';
import { createActivityRepository } from '../src/modules/activity/activity.repository.js';
import { ACTIVITY_KINDS, describeEvent } from '../src/lib/activity-events.js';

const admin = { id: 1, role: 'admin' };
const q = { from: '2026-10-10', to: '2026-10-16' };

test('service: admin only; validates dates, window length, kind, person and limit before any query', async () => {
  let calls = 0; const svc = createActivityService({ repo: { feed: async () => { calls += 1; return []; } } });
  await assert.rejects(svc.feed({ id: 2, role: 'bde' }, q), (e) => e.status === 403);
  const bad = (o) => assert.rejects(svc.feed(admin, { ...q, ...o }), (e) => e.status === 400 && Boolean(e.fields));
  await bad({ from: undefined }); await bad({ to: '2026-13-01' }); await bad({ to: '2026-10-09' }); await bad({ from: '2026-09-01' });
  await bad({ kind: 'login' }); await bad({ actorId: 'abc' }); await bad({ limit: '0' }); await bad({ limit: '501' }); await bad({ limit: '2.5' });
  assert.equal(calls, 0);
  await svc.feed(admin, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(calls, 1, '31 days is allowed');
});

test('service: window is [from 00:00, day after to 00:00), shapes events, flags truncation', async () => {
  let seen; const rows = [{ at: '2026-10-16 10:00:00', kind: 'call', actor_id: '7', actor_name: 'Priya', actor_employee_id: 'B7', actor_role: 'bde', subject: 'Kavin K.', extra: 'interested' }];
  const svc = createActivityService({ repo: { feed: async (a) => { seen = a; return rows; } } });
  const r = await svc.feed(admin, { ...q, limit: '1', actorId: '7', kind: 'call' });
  assert.deepEqual([seen.fromTs, seen.toTs, seen.kind, seen.actorId, seen.limit], ['2026-10-10 00:00:00', '2026-10-17 00:00:00', 'call', '7', 1]);
  assert.equal(r.truncated, true); assert.deepEqual(r.events[0].actor, { id: 7, name: 'Priya', employeeId: 'B7', role: 'bde' });
  assert.equal(r.events[0].title, 'Recorded a call'); assert.equal(r.events[0].detail, 'Kavin K.: Interested');
  assert.match(r.basis, /not recorded anywhere yet/);
});

test('describeEvent: every kind has a readable title; unknown values never throw', () => {
  for (const kind of ACTIVITY_KINDS) { const d = describeEvent({ kind, subject: 'X', extra: '5' }); assert.ok(d.title && d.title !== kind, kind); }
  assert.equal(describeEvent({ kind: 'receipt_reviewed', subject: 'A', extra: 'rejected' }).title, 'Receipt rejected');
  assert.equal(describeEvent({ kind: 'payment_committed', subject: 'A', extra: '12500.00' }).detail, 'A: \u20B912,500');
  assert.equal(describeEvent({ kind: 'weird', subject: 'S' }).title, 'weird');
});

test('repository: one parameterised SELECT per kind, merged newest first, actors attached, no write statements', async () => {
  const log = [];
  const db = { query: async (sql, p) => {
    const s = sql.replace(/\s+/g, ' ').trim(); log.push([s, p]);
    if (s.startsWith('SELECT id, name, employee_id, role FROM users')) return [{ id: 7, name: 'Priya', employee_id: 'B7', role: 'bde' }];
    if (s.includes("'call' AS kind")) return [{ at: '2026-10-16 09:00:00', kind: 'call', actor_id: 7, subject: 'A', extra: 'interested' }];
    if (s.includes("'lead_added' AS kind")) return [{ at: '2026-10-16 11:00:00', kind: 'lead_added', actor_id: 7, subject: 'B', extra: '' }];
    return [];
  } };
  const repo = createActivityRepository(db);
  const rows = await repo.feed({ fromTs: '2026-10-16 00:00:00', toTs: '2026-10-17 00:00:00', kind: null, actorId: null, limit: 50 });
  assert.deepEqual(rows.map((r) => r.kind), ['lead_added', 'call']); assert.equal(rows[0].actor_name, 'Priya');
  assert.equal(log.length, ACTIVITY_KINDS.length + 1, 'one query per kind plus one for the people');
  assert.ok(log.every(([s]) => /^SELECT /.test(s) && !/\b(UNION|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(s)));
  assert.ok(log.slice(0, -1).every(([s, p]) => s.endsWith('LIMIT 50') && p.length === 2));
  log.length = 0;
  await repo.feed({ fromTs: 'a', toTs: 'b', kind: 'call', actorId: '7', limit: 5 });
  assert.equal(log.length, 2); assert.deepEqual(log[0][1], ['a', 'b', '7']); assert.match(log[0][0], /AND c\.user_id = \? ORDER BY/);
  await assert.rejects(repo.feed({ fromTs: 'a', toTs: 'b', kind: null, actorId: null, limit: '5; DROP' }), /internal/);
  assert.deepEqual(await createActivityRepository({ query: async () => [] }).feed({ fromTs: 'a', toTs: 'b', kind: null, actorId: null, limit: 5 }), []);
});
