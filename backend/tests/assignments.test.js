import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssignmentService, suggestSplit } from '../src/modules/assignments/assignments.service.js';
import { createAssignmentRepository } from '../src/modules/assignments/assignments.repository.js';

const admin = { id: 1, role: 'admin' };
const bdes = { 10: { id: 10, name: 'Asha', is_active: 1 }, 11: { id: 11, name: 'Bala', is_active: 1 }, 12: { id: 12, name: 'Off', is_active: 0 } };

function make({ ids = ['1', '2', '3', '4', '5'], fail = null } = {}) {
  const moves = [];
  const repo = {
    workload: async () => [{ id: 10, employee_id: 'B1', name: 'Asha', open_leads: '4', overdue: '1', reassignable: '3', calls_today: 2 }],
    findBde: async (id) => bdes[id] || null,
    reassignableIds: async (from, limit) => ids.slice(0, limit),
    moveLeads: async (a) => { if (fail) throw Object.assign(new Error('x'), { code: fail }); moves.push(a); return { moved: a.allocations.reduce((n, x) => n + x.leadIds.length, 0) }; }
  };
  return { moves, svc: createAssignmentService({ repo }) };
}

test('admin only; overview needs a real date and returns numbers, not strings', async () => {
  const { svc } = make();
  await assert.rejects(svc.overview({ id: 2, role: 'bde' }, '2026-10-16'), (e) => e.status === 403);
  await assert.rejects(svc.assign({ id: 2, role: 'bde' }, {}), (e) => e.status === 403);
  await assert.rejects(svc.overview(admin, '2026-02-31'), (e) => e.status === 400);
  const o = await svc.overview(admin, '2026-10-16');
  assert.deepEqual(o.bdes[0], { id: 10, employeeId: 'B1', name: 'Asha', openLeads: 4, overdue: 1, reassignable: 3, callsToday: 2 });
});

test('assign: validation errors move nothing', async () => {
  const { svc, moves } = make();
  const bad = (b) => assert.rejects(svc.assign(admin, b), (e) => e.status === 400 && Boolean(e.fields));
  await assert.rejects(svc.assign(admin, null), (e) => e.status === 400); await bad({}); await bad({ fromBdeId: 'x', allocations: [{ toBdeId: 11, count: 1 }] });
  await bad({ fromBdeId: 10, allocations: [] }); await bad({ fromBdeId: 10, allocations: [{ toBdeId: 11, count: 0 }] });
  await bad({ fromBdeId: 10, allocations: [{ toBdeId: 11, count: 1.5 }] }); await bad({ fromBdeId: 10, allocations: [{ toBdeId: 11, count: '2' }] });
  await bad({ fromBdeId: 10, allocations: [{ toBdeId: 10, count: 1 }] }); await bad({ fromBdeId: 10, allocations: [{ toBdeId: 11, count: 1 }, { toBdeId: '11', count: 1 }] });
  await bad({ fromBdeId: 10, allocations: [{ toBdeId: 11, count: 5001 }] });
  assert.deepEqual(moves, []);
});

test('assign: unknown source/target is 404; a switched-off BDE cannot receive leads (409); nothing moves', async () => {
  const { svc, moves } = make();
  await assert.rejects(svc.assign(admin, { fromBdeId: 99, allocations: [{ toBdeId: 11, count: 1 }] }), (e) => e.status === 404);
  await assert.rejects(svc.assign(admin, { fromBdeId: 10, allocations: [{ toBdeId: 98, count: 1 }] }), (e) => e.status === 404);
  await assert.rejects(svc.assign(admin, { fromBdeId: 10, allocations: [{ toBdeId: 12, count: 1 }] }), (e) => e.status === 409 && e.code === 'BDE_INACTIVE');
  assert.deepEqual(moves, []);
});

test('assign: asking for more than can be moved is refused whole (no partial move) and says how many are available', async () => {
  const { svc, moves } = make({ ids: ['1', '2'] });
  await assert.rejects(svc.assign(admin, { fromBdeId: 10, allocations: [{ toBdeId: 11, count: 3 }] }), (e) => e.status === 409 && e.code === 'NOT_ENOUGH_LEADS' && e.details.available === 2);
  assert.deepEqual(moves, []);
});

test('assign: hands out distinct leads in order, one slice per BDE, in a single repository call; source may be a switched-off BDE', async () => {
  const { svc, moves } = make();
  const r = await svc.assign(admin, { fromBdeId: 12, allocations: [{ toBdeId: 10, count: 2 }, { toBdeId: 11, count: 3 }] });
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { fromUserId: '12', allocations: [{ toUserId: '10', leadIds: ['1', '2'] }, { toUserId: '11', leadIds: ['3', '4', '5'] }] });
  assert.equal(r.moved, 5); assert.deepEqual(r.to.map((t) => t.count), [2, 3]);
});

test('assign: a lead set that changed during the move becomes a clean 409', async () => {
  const { svc } = make({ fail: 'LEADS_CHANGED' });
  await assert.rejects(svc.assign(admin, { fromBdeId: 10, allocations: [{ toBdeId: 11, count: 1 }] }), (e) => e.status === 409 && e.code === 'LEADS_CHANGED');
  const { svc: s2 } = make({ fail: 'ECONNRESET' });
  await assert.rejects(s2.assign(admin, { fromBdeId: 10, allocations: [{ toBdeId: 11, count: 1 }] }), (e) => e.code === 'ECONNRESET');
});

test('suggestSplit: fills the least-loaded BDEs first, never differs by more than one beyond the starting gap, sums to the total', () => {
  assert.deepEqual(suggestSplit(4, [{ id: 1, openLeads: 0 }, { id: 2, openLeads: 0 }]), [{ id: '1', count: 2 }, { id: '2', count: 2 }]);
  assert.deepEqual(suggestSplit(3, [{ id: 1, openLeads: 0 }, { id: 2, openLeads: 10 }]), [{ id: '1', count: 3 }], 'the busy BDE gets none until the gap closes');
  const s = suggestSplit(7, [{ id: 3, openLeads: 2 }, { id: 1, openLeads: 2 }, { id: 2, openLeads: 2 }]);
  assert.equal(s.reduce((n, x) => n + x.count, 0), 7); assert.deepEqual(s, [{ id: '1', count: 3 }, { id: '2', count: 2 }, { id: '3', count: 2 }]);
  assert.deepEqual(suggestSplit(0, [{ id: 1, openLeads: 0 }]), []); assert.deepEqual(suggestSplit(5, []), []);
});

test('repository SQL: parameters only, no-children rule repeated in the UPDATE, one transaction, rollback signal when fewer rows move', async () => {
  const log = []; let affected = 2;
  const tx = { query: async (sql, p) => { log.push([sql.replace(/\s+/g, ' ').trim(), p]); return { affectedRows: affected }; } };
  const db = { query: async (sql, p) => { log.push([sql.replace(/\s+/g, ' ').trim(), p]); return [{ id: 5 }, { id: 6 }]; }, transaction: async (fn) => fn(tx) };
  const repo = createAssignmentRepository(db);
  assert.deepEqual(await repo.reassignableIds('10', 2), ['5', '6']);
  assert.match(log[0][0], /ORDER BY l\.id ASC LIMIT 2$/); assert.deepEqual(log[0][1], ['10']);
  assert.deepEqual(await repo.moveLeads({ fromUserId: '10', allocations: [{ toUserId: '11', leadIds: ['5', '6'] }] }), { moved: 2 });
  const upd = log[1]; assert.deepEqual(upd[1], ['11', '10', '5', '6']);
  assert.match(upd[0], /l\.id IN \(\?, \?\)/); for (const t of ['call_logs', 'interviews', 'payments']) assert.match(upd[0], new RegExp(`NOT EXISTS \\(SELECT 1 FROM ${t} `));
  affected = 1;
  await assert.rejects(repo.moveLeads({ fromUserId: '10', allocations: [{ toUserId: '11', leadIds: ['5', '6'] }] }), (e) => e.code === 'LEADS_CHANGED');
  await assert.rejects(repo.reassignableIds('10', '2; DROP TABLE leads'), /internal/);
  await assert.rejects(repo.reassignableIds('10', 5001), /internal/);
  assert.ok(log.every(([s]) => !/DROP|TRUNCATE|DELETE/i.test(s)));
});
