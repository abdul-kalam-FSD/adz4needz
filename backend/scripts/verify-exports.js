// Run AFTER `npm install`: generates a REAL .xlsx and .pdf from a sample report with the installed libraries and checks them.
// Usage: npm run verify:exports      (writes the two files to the OS temp folder and prints their paths)
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMonthlyReport, parseMonth } from '../src/lib/monthly-report.js';
import { renderXlsx, renderPdf } from '../src/lib/monthly-report-export.js';

const row = (id, name, o = {}) => ({ id, employee_id: 'E' + id, name, is_active: 1, days_reported: 5, total_calls: 100, interested: 20, not_interested: 40, follow_up_required: 25, no_response: 15, leads_created: 12,
  interviews_scheduled: 6, interviews_attended: 4, interviews_no_show: 1, interviews_selected: 3, commitments: 2, committed: '30000.00', received: '12500.50', target_calls: 200, target_interested: 40, target_interviews: null, target_revenue: '25001.00', ...o });
const report = buildMonthlyReport(parseMonth('2026-10'), [row(1, 'Asha K'), row(2, '=HYPERLINK("http://x")', { total_calls: 10, target_calls: null, target_interested: null, target_revenue: null })]);
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

const xlsx = await renderXlsx(report);
if (!(xlsx[0] === 0x50 && xlsx[1] === 0x4b)) fail('xlsx is not a zip file');
const { default: ExcelJS } = await import('exceljs');
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx);
const ws = wb.getWorksheet('Monthly summary');
if (!ws || !wb.getWorksheet('About this report')) fail('expected sheets are missing');
if (ws.getRow(1).getCell(1).value !== 'BDE') fail('header row is wrong');
if (ws.rowCount !== 4) fail('expected 1 header + 2 BDE rows + 1 team total, got ' + ws.rowCount);
if (String(ws.getRow(3).getCell(1).value).startsWith('=')) fail('formula text was not neutralised');
if (ws.getRow(2).getCell(4).value !== 100) fail('calls cell is wrong');

const pdf = await renderPdf(report);
if (pdf.subarray(0, 5).toString() !== '%PDF-') fail('pdf header missing');
if (!pdf.subarray(-32).toString().includes('%%EOF')) fail('pdf trailer missing');
if (pdf.length < 1500) fail('pdf is suspiciously small');

const dir = await mkdtemp(path.join(tmpdir(), 'bde-export-'));
await writeFile(path.join(dir, 'monthly-report-2026-10.xlsx'), xlsx); await writeFile(path.join(dir, 'monthly-report-2026-10.pdf'), pdf);
console.log('OK. Open these files and look at them:', dir);
