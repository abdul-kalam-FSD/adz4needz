import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMonthlyReportService } from '../src/modules/monthly-reports/monthly-reports.service.js';

const admin = { id: 1, role: 'admin' }; const bde = { id: 10, role: 'bde' };
const baseRow = (id, name, o = {}) => ({ id, employee_id: 'E' + id, name, is_active: 1, days_reported: 2, total_calls: 60, interested: 9, not_interested: 20, follow_up_required: 20, no_response: 11, leads_created: 4,
  interviews_scheduled: 3, interviews_attended: 2, interviews_no_show: 1, interviews_selected: 1, commitments: 1, committed: '10000.00', received: '4000.00',
  target_calls: null, target_interested: null, target_interviews: null, target_revenue: null, ...o });

function fakeRepo() {
  const calls = { rows: [], upserts: [] }; const targets = new Map();
  return {
    calls,
    findBde: async (id) => (['10', '11'].includes(String(id)) ? { id: Number(id), employee_id: 'E' + id, name: 'B' + id, is_active: 1 } : null),
    monthlyRows: async (m, scope) => {
      calls.rows.push({ month: m.month, scope });
      const all = [baseRow(10, 'Asha'), baseRow(11, 'Ravi', { total_calls: 40 })].map((r) => ({ ...r, ...(targets.get(`${r.id}|${m.start}`) || {}) }));
      return scope === null ? all : all.filter((r) => r.id === Number(scope));
    },
    upsertTarget: async ({ userId, monthStart, targets: t, setBy }) => {
      calls.upserts.push({ userId, monthStart, t, setBy });
      targets.set(`${userId}|${monthStart}`, { target_calls: t.targetCalls, target_interested: t.targetInterested, target_interviews: t.targetInterviews, target_revenue: t.targetRevenue });
    }
  };
}
const make = () => { const repo = fakeRepo(); return { repo, svc: createMonthlyReportService({ repo, now: () => new Date('2026-10-13T08:00:00Z') }) }; };
const code = (p, status) => assert.rejects(p, (e) => e.status === status);

test('team report is admin-only; BDE report is BDE-only', async () => {
  const { svc } = make();
  for (const a of [bde, null, { id: 3, role: 'x' }]) { await code(svc.teamReport(a, '2026-10'), 403); await code(svc.setTargets(a, {}), 403); }
  for (const a of [admin, null]) await code(svc.ownReport(a, '2026-10'), 403);
});

test('team report: all BDEs, totals, month defaults to the current UTC month', async () => {
  const { svc, repo } = make();
  const r = await svc.teamReport(admin, undefined);
  assert.equal(r.month, '2026-10'); assert.equal(r.bdes.length, 2); assert.equal(r.total.figures.calls.total, 100); assert.equal(r.total.figures.revenueReceived, '8000.00');
  assert.deepEqual(repo.calls.rows[0], { month: '2026-10', scope: null });
});

test("own report: scoped to the caller's id from the session; a BDE can never ask for another BDE", async () => {
  const { svc, repo } = make();
  const r = await svc.ownReport(bde, '2026-09');
  assert.equal(r.bdes.length, 1); assert.equal(r.bdes[0].id, 10); assert.equal(repo.calls.rows[0].scope, 10);
  assert.equal(svc.ownReport.length <= 2, true); // signature has no BDE-id parameter
});

test('invalid months are rejected before any query', async () => {
  const { svc, repo } = make();
  for (const m of ['2026-13', '26-10', '2026-10-01', 'abc', '1999-01']) { await code(svc.teamReport(admin, m), 400); await code(svc.ownReport(bde, m), 400); }
  assert.equal(repo.calls.rows.length, 0);
});

test('setTargets: validates, saves for the right BDE+month, returns achievement calculated from database figures', async () => {
  const { svc, repo } = make();
  const b = await svc.setTargets(admin, { month: '2026-10', bdeId: 10, targetCalls: '120', targetInterested: 18, targetInterviews: '', targetRevenue: '8000' });
  assert.deepEqual(repo.calls.upserts[0], { userId: 10, monthStart: '2026-10-01', t: { targetCalls: 120, targetInterested: 18, targetInterviews: null, targetRevenue: '8000.00' }, setBy: 1 });
  assert.deepEqual(b.achievement, { calls: 50, interested: 50, interviews: null, revenue: 50 }); assert.equal(b.figures.calls.total, 60);
  const cleared = await svc.setTargets(admin, { month: '2026-10', bdeId: '10' });
  assert.deepEqual(cleared.targets, { calls: null, interested: null, interviews: null, revenue: null });
});

test('setTargets: bad month / bde / values give field errors; unknown or non-BDE user is 404; nothing saved on error', async () => {
  const { svc, repo } = make();
  await assert.rejects(svc.setTargets(admin, { month: 'x', bdeId: 'abc', targetCalls: -5, targetRevenue: '0' }), (e) => e.status === 400 && Boolean(e.fields.month && e.fields.bdeId && e.fields.targetCalls && e.fields.targetRevenue));
  await code(svc.setTargets(admin, null), 400); await code(svc.setTargets(admin, []), 400);
  await code(svc.setTargets(admin, { month: '2026-10', bdeId: 999 }), 404);
  assert.equal(repo.calls.upserts.length, 0);
});

test('wiring (text): BDE route is BDE-only, admin report routes sit on a separate admin-only router mounted before /admin, adminRouter still has no write routes', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /api\.get\('\/reports\/monthly', authenticate, authorize\('bde'\)/);
  assert.match(app, /api\.use\('\/admin\/reports', authenticate, authorize\('admin'\), reportsAdminRouter\)/);
  assert.ok(app.indexOf("api.use('/admin/reports'") < app.indexOf("api.use('/admin', authenticate"));
  assert.equal((app.match(/adminRouter\.(post|put|patch|delete)\(/g) || []).length, 0);
  assert.equal((app.match(/reportsAdminRouter\.put\(/g) || []).length, 1); assert.equal((app.match(/reportsAdminRouter\.(post|patch|delete)\(/g) || []).length, 0);
  const sql = readFileSync(new URL('../db/migrations/013_monthly_targets.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 1); assert.match(sql, /PRIMARY KEY \(user_id, month_start\)/);
});
