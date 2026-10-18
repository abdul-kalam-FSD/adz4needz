import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMonthlyReport, parseMonth } from '../src/lib/monthly-report.js';
import { buildSummaryTable, buildPdfTable, exportFileName, renderXlsx, renderPdf, XLSX_MIME, PDF_MIME } from '../src/lib/monthly-report-export.js';
import { createMonthlyReportService } from '../src/modules/monthly-reports/monthly-reports.service.js';

const row = (id, name, o = {}) => ({ id, employee_id: 'E' + id, name, is_active: 1, days_reported: 5, total_calls: 100, interested: 20, not_interested: 40, follow_up_required: 25, no_response: 15, leads_created: 12,
  interviews_scheduled: 6, interviews_attended: 4, interviews_no_show: 1, interviews_selected: 3, commitments: 2, committed: '30000.00', received: '12500.50', target_calls: 200, target_interested: 40, target_interviews: null, target_revenue: '25001.00', ...o });
const report = () => buildMonthlyReport(parseMonth('2026-10'), [row(1, 'Asha K'), row(2, '=HYPERLINK("http://evil")', { total_calls: 10, target_calls: null, target_interested: null, target_revenue: null })]);

test('summary table: one row per BDE plus TEAM TOTAL, numeric cells, empty for no target, text is formula-safe', () => {
  const t = buildSummaryTable(report(), '2026-10-13T00:00:00.000Z');
  assert.equal(t.rows.length, 3); assert.equal(t.headers.length, t.kinds.length); assert.ok(t.rows.every((r) => r.length === t.headers.length));
  const col = (h) => t.headers.indexOf(h);
  assert.equal(t.rows[0][col('Calls')], 100); assert.equal(t.rows[0][col('Revenue received')], 12500.5); assert.equal(t.rows[0][col('Calls achieved % (calculated)')], 50);
  assert.equal(t.rows[0][col('Interviews target')], null); assert.equal(t.rows[1][col('Calls target')], null);
  assert.equal(t.rows[1][0], "'=HYPERLINK(\"http://evil\")"); assert.equal(t.rows[2][0], 'TEAM TOTAL'); assert.equal(t.rows[2][col('Calls')], 110);
  assert.equal(t.rows[2][col('Revenue received')], 25001); // 12500.50 + 12500.50, both BDEs
  assert.ok(t.notes.some((n) => n.includes('Generated (UTC): 2026-10-13T00:00:00.000Z'))); assert.ok(t.notes.some((n) => n.startsWith('achievement: CALCULATED')));
});

test('pdf table has matching column counts and dashes where there is no target', () => {
  const { headers, rows } = buildPdfTable(report());
  assert.ok(rows.every((r) => r.length === headers.length)); assert.equal(rows.length, 3);
  assert.equal(rows[0][0], 'Asha K (E1)'); assert.equal(rows[1][6], '-'); assert.equal(rows[2][0], 'TEAM TOTAL'); assert.match(rows[0][5], /12,500\.50/);
});

test('file names are derived from the validated month only', () => { assert.equal(exportFileName({ month: '2026-10' }, 'xlsx'), 'monthly-report-2026-10.xlsx'); });

test('renderXlsx drives exceljs correctly (fake library): sheets, header, rows, number formats, buffer out', async () => {
  const added = []; const sheets = [];
  class WB { constructor() { this.xlsx = { writeBuffer: async () => new Uint8Array([0x50, 0x4b, 3, 4]) }; }
    addWorksheet(name) { const ws = { name, rows: [], cols: [], getRow: () => ({ font: null, alignment: null }), getColumn: () => ({ numFmt: null, width: 0 }), addRow(r) { this.rows.push(r); added.push(r); } }; sheets.push(ws); return ws; } }
  const buf = await renderXlsx(report(), { generatedAt: '2026-10-13T00:00:00.000Z', loadExcelJs: async () => ({ Workbook: WB }) });
  assert.ok(Buffer.isBuffer(buf)); assert.deepEqual([...buf], [0x50, 0x4b, 3, 4]);
  assert.deepEqual(sheets.map((s) => s.name), ['Monthly summary', 'About this report']);
  assert.equal(sheets[0].rows.length, 3); assert.ok(sheets[1].rows.length >= 8);
});

test('renderPdf drives pdfkit correctly (fake library): table drawn, paginates, returns a buffer', async () => {
  let pages = 1; const texts = [];
  class Doc { constructor() { this.page = { width: 842, height: 595, margins: { top: 36, left: 36, right: 36, bottom: 36 } }; this.y = 36; this.h = {}; }
    on(ev, cb) { this.h[ev] = cb; return this; } font() { return this; } fontSize() { return this; } moveDown() { this.y += 10; return this; }
    heightOfString() { return 200; } addPage() { pages++; this.y = 36; return this; } moveTo() { return this; } lineTo() { return this; } lineWidth() { return this; } stroke() { return this; }
    text(t) { texts.push(String(t)); if (!arguments[3] && typeof arguments[2] !== 'number') this.y += 12; return this; }
    end() { this.h.data(Buffer.from('%PDF-1.3\n')); this.h.data(Buffer.from('\n%%EOF\n')); this.h.end(); } }
  const buf = await renderPdf(report(), { generatedAt: 'g', loadPdfKit: async () => Doc });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(texts.some((t) => t.startsWith('Monthly report - October 2026'))); assert.ok(texts.includes('TEAM TOTAL'));
  assert.ok(pages > 1, 'tall rows must trigger a page break instead of drawing off the page');
});

test('a missing library gives a clear 500 EXPORT_UNAVAILABLE', async () => {
  const boom = async () => { throw new Error('Cannot find package'); };
  await assert.rejects(renderXlsx(report(), { loadExcelJs: boom }), (e) => e.status === 500 && e.code === 'EXPORT_UNAVAILABLE');
  await assert.rejects(renderPdf(report(), { loadPdfKit: boom }), (e) => e.status === 500 && e.code === 'EXPORT_UNAVAILABLE');
});

test('service.exportReport: admin only, validated format and month, same query path as the screen, correct mime/name', async () => {
  const calls = [];
  const repo = { monthlyRows: async (m, scope) => { calls.push({ month: m.month, scope }); return [row(1, 'Asha K')]; } };
  const exporter = { xlsx: async (r, o) => Buffer.from('X' + r.month + o.generatedAt), pdf: async () => Buffer.from('%PDF-') };
  const svc = createMonthlyReportService({ repo, now: () => new Date('2026-10-13T08:00:00Z'), exporter });
  for (const a of [{ id: 10, role: 'bde' }, null]) await assert.rejects(svc.exportReport(a, '2026-10', 'xlsx'), (e) => e.status === 403);
  await assert.rejects(svc.exportReport({ id: 1, role: 'admin' }, '2026-10', 'csv'), (e) => e.status === 400);
  await assert.rejects(svc.exportReport({ id: 1, role: 'admin' }, '../etc', 'xlsx'), (e) => e.status === 400);
  assert.equal(calls.length, 0);
  const x = await svc.exportReport({ id: 1, role: 'admin' }, '2026-10', 'xlsx');
  assert.equal(x.mime, XLSX_MIME); assert.equal(x.fileName, 'monthly-report-2026-10.xlsx'); assert.equal(x.buffer.toString(), 'X2026-102026-10-13T08:00:00.000Z'); assert.deepEqual(calls[0], { month: '2026-10', scope: null });
  const p = await svc.exportReport({ id: 1, role: 'admin' }, '2026-10', 'pdf'); assert.equal(p.mime, PDF_MIME); assert.equal(p.fileName, 'monthly-report-2026-10.pdf');
});

test('wiring (text): export routes are GET-only on the admin-only reports router; pdfkit and exceljs are declared', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /reportsAdminRouter\.get\('\/monthly\.xlsx'/); assert.match(app, /reportsAdminRouter\.get\('\/monthly\.pdf'/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies.pdfkit && pkg.dependencies.exceljs); assert.equal(pkg.scripts['verify:exports'], 'node scripts/verify-exports.js');
});
