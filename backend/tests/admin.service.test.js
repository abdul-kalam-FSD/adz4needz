import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminService } from '../src/modules/admin/admin.service.js';

const row = (id, name, extra = {}) => ({ id, employee_id: 'E' + id, name, is_active: 1, report_id: null, total_calls: null, interested: null, not_interested: null, follow_up_required: null, no_response: null, ...extra });
const filled = (id, name, n) => row(id, name, { report_id: 100 + id, total_calls: n, interested: n / 10, not_interested: n / 5, follow_up_required: 1, no_response: 2 });

function make(rows = [], extra = {}) {
  const calls = {};
  const adminRepo = {
    listBdes: async () => rows,
    findBde: async (id) => rows.find((r) => String(r.id) === String(id)) || null,
    overviewForDate: async (d) => { calls.date = d; return rows; },
    ...extra
  };
  const reportRepo = { listByUser: async (id, limit) => { calls.listed = { id, limit }; return [{ id: 1, reportDate: '2026-10-10' }]; } };
  return { service: createAdminService({ adminRepo, reportRepo }), calls };
}

test('overview: bad or missing date -> 400 and no query runs', async () => {
  const { service, calls } = make([]);
  for (const bad of [undefined, '', '2026-02-30', '10/10/2026', ['2026-10-10'], null]) {
    await assert.rejects(service.dailyOverview(bad), (e) => e.status === 400 && Boolean(e.fields.date));
  }
  assert.equal(calls.date, undefined);
});
test('overview: totals add only submitted reports; missing reports show null, not zero', async () => {
  const { service } = make([filled(1, 'Anu', 50), row(2, 'Babu'), filled(3, 'Chitra', 100)]);
  const r = await service.dailyOverview('2026-10-10');
  assert.equal(r.date, '2026-10-10');
  assert.deepEqual(r.totals, { bdeCount: 3, reportsSubmitted: 2, totalCalls: 150, interested: 15, notInterested: 30, followUpRequired: 2, noResponse: 4 });
  const babu = r.bdes.find((b) => b.name === 'Babu');
  assert.equal(babu.submitted, false); assert.equal(babu.totalCalls, null);
  assert.equal(r.bdes.find((b) => b.name === 'Anu').submitted, true);
});
test('overview: a submitted report with all zeros still counts as submitted', async () => {
  const { service } = make([row(1, 'Zed', { report_id: 5, total_calls: 0, interested: 0, not_interested: 0, follow_up_required: 0, no_response: 0 })]);
  const r = await service.dailyOverview('2026-10-10');
  assert.equal(r.bdes[0].submitted, true); assert.equal(r.bdes[0].totalCalls, 0); assert.equal(r.totals.reportsSubmitted, 1);
});
test('overview: output never contains password hashes or session data', async () => {
  const { service } = make([{ ...filled(1, 'Anu', 10), password_hash: 'scrypt$x' }]);
  assert.ok(!JSON.stringify(await service.dailyOverview('2026-10-10')).match(/hash|password|token/i));
});
test('bde list maps fields and booleans', async () => {
  const { service } = make([row(1, 'Anu'), row(2, 'Babu', { is_active: 0 })]);
  const list = await service.listBdes();
  assert.deepEqual(list[1], { id: 2, employeeId: 'E2', name: 'Babu', isActive: false });
});
test('bde detail: invalid id -> 400, unknown id -> 404, found -> reports of THAT bde only', async () => {
  const { service, calls } = make([row(7, 'Anu')]);
  for (const bad of ['abc', '1; DROP TABLE users', '', '-1', undefined, '1'.repeat(30)]) {
    await assert.rejects(service.bdeDetail(bad), (e) => e.status === 400);
  }
  await assert.rejects(service.bdeDetail('99'), (e) => e.status === 404);
  const d = await service.bdeDetail('7', '10');
  assert.equal(d.bde.name, 'Anu'); assert.equal(calls.listed.id, 7); assert.equal(d.reports.length, 1);
});

// Source-level guard (Express is not installed here, so app.js cannot be executed in this environment):
// makes sure nobody mounts admin routes without the admin role check.
test('app.js mounts /admin only behind authenticate + authorize("admin")', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(src, /api\.use\('\/admin', authenticate, authorize\('admin'\), adminRouter\)/);
  assert.equal((src.match(/adminRouter\.get\(/g) || []).length, 14, 'admin GET routes: 3 BDE/report + 3 lead + 4 interview + 4 payment (update this number when adding a read-only admin route)');
  assert.equal((src.match(/adminRouter\.(post|put|patch|delete)\(/g) || []).length, 0, 'admin routes must stay read-only in this phase');
});
