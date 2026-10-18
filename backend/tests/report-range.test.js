import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRange, MAX_RANGE_DAYS } from '../src/lib/report-range.js';
import { buildMonthlyReport } from '../src/lib/monthly-report.js';
import { exportFileName, buildSummaryTable } from '../src/lib/monthly-report-export.js';
import { createMonthlyReportService } from '../src/modules/monthly-reports/monthly-reports.service.js';
import { createMonthlyReportRepository } from '../src/modules/monthly-reports/monthly-reports.repository.js';

const admin = { id: 1, role: 'admin' }; const bde = { id: 2, role: 'bde' };

test('parseRange: one day, week, month-length and custom ranges; end is exclusive; label and key are readable', () => {
  const d = parseRange('2026-10-16', '2026-10-16').value;
  assert.deepEqual([d.start, d.endExclusive, d.days, d.label, d.title], ['2026-10-16', '2026-10-17', 1, '2026-10-16', 'Daily report']);
  const w = parseRange('2026-10-12', '2026-10-18').value;
  assert.deepEqual([w.endExclusive, w.days, w.month, w.startTs, w.endTs], ['2026-10-19', 7, '2026-10-12_to_2026-10-18', '2026-10-12 00:00:00', '2026-10-19 00:00:00']);
  assert.equal(parseRange('2026-12-30', '2027-01-02').value.endExclusive, '2027-01-03', 'crosses a year');
  assert.equal(parseRange('2028-02-28', '2028-03-01').value.days, 3, 'leap day counted');
  assert.equal(parseRange('2026-10-01', '2026-10-31').value.targetMonthStart, null);
});

test('parseRange: refuses missing, impossible, reversed, pre-2020 and over-long ranges with field errors', () => {
  assert.ok(parseRange(undefined, '2026-10-01').errors.from);
  assert.ok(parseRange('2026-02-30', '2026-03-01').errors.from);
  assert.ok(parseRange('2026-10-02', '2026-10-01').errors.to);
  assert.ok(parseRange('2019-12-31', '2020-01-02').errors.from);
  assert.ok(parseRange('2026-01-01', '2027-01-02').errors.to, `${MAX_RANGE_DAYS + 1} days`);
  assert.equal(parseRange('2026-01-01', '2026-12-31').ok, true, '365 days is allowed');
  assert.equal(parseRange('2026-01-01', '2027-01-01').ok, true, `${MAX_RANGE_DAYS} days is allowed`);
  assert.equal(parseRange('2026-10-1', '2026-10-2').ok, false);
});

test('service: admin only, validates before querying, passes the range through the SAME query path as the month report', async () => {
  const seen = [];
  const repo = { monthlyRows: async (m, scope) => { seen.push([m.start, m.endExclusive, m.targetMonthStart, scope]); return []; } };
  const svc = createMonthlyReportService({ repo });
  await assert.rejects(svc.rangeReport(bde, '2026-10-01', '2026-10-02'), (e) => e.status === 403);
  await assert.rejects(svc.rangeReport(admin, '2026-10-05', '2026-10-01'), (e) => e.status === 400 && Boolean(e.fields.to));
  assert.deepEqual(seen, [], 'nothing queried for refused requests');
  const r = await svc.rangeReport(admin, '2026-10-12', '2026-10-18');
  assert.deepEqual(seen, [['2026-10-12', '2026-10-19', null, null]]);
  assert.equal(r.kind, 'range'); assert.equal(r.label, '2026-10-12 to 2026-10-18');
  const m = await svc.teamReport(admin, '2026-10'); assert.equal(m.kind, 'month'); assert.equal(m.title, 'Monthly report');
});

test('repository: a range report joins NO target row (null month); the monthly report still joins its month', async () => {
  const calls = []; const db = { query: async (sql, params) => { calls.push(params); return []; } };
  const repo = createMonthlyReportRepository(db);
  await repo.monthlyRows(parseRange('2026-10-12', '2026-10-18').value, null);
  assert.equal(calls[0][8], null);
  assert.deepEqual(calls[0].slice(0, 2), ['2026-10-12 00:00:00', '2026-10-19 00:00:00']);
  await repo.monthlyRows({ start: '2026-10-01', endExclusive: '2026-11-01', startTs: 'a', endTs: 'b' }, null);
  assert.equal(calls[3][8], '2026-10-01');
});

test('exports: range files are titled and named as range reports, monthly files keep their old names', () => {
  const range = buildMonthlyReport(parseRange('2026-10-12', '2026-10-18').value, []);
  assert.equal(exportFileName(range, 'xlsx'), 'report-2026-10-12_to_2026-10-18.xlsx');
  assert.match(buildSummaryTable(range).title, /^Report - 2026-10-12 to 2026-10-18$/);
  const month = buildMonthlyReport({ month: '2026-10', label: 'October 2026', start: '2026-10-01', endExclusive: '2026-11-01' }, []);
  assert.equal(exportFileName(month, 'pdf'), 'monthly-report-2026-10.pdf');
  assert.match(buildSummaryTable(month).title, /^Monthly report - October 2026$/);
});

test('route is on the admin-only reports router', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /reportsAdminRouter\.get\('\/range', asyncHandler\(monthly\.range\)\)/);
});
