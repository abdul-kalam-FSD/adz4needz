// Monthly report export (Excel + PDF). The table CONTENT is built by pure functions (unit-tested here). Only the thin render functions
// touch the libraries: `exceljs` (xlsx) and `pdfkit` (pdf), loaded lazily. The library calls could NOT be run in the authoring sandbox
// (npm registry unreachable): run `npm run verify:exports` after `npm install` to generate and check real files.
import { HttpError } from './http-error.js';
import { safeCell } from './lead-import.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_MIME = 'application/pdf';

const num = (v) => (v === null || v === undefined ? null : Number(v));

// Column definitions for the Excel summary. kind: text | int | money | pct (percentage points, calculated).
const COLUMNS = [
  ['BDE', 'text', (b) => b.name], ['Employee ID', 'text', (b) => b.employeeId],
  ['Days with activity', 'int', (b) => b.figures.calls.daysReported], ['Calls', 'int', (b) => b.figures.calls.total],
  ['Interested', 'int', (b) => b.figures.calls.interested], ['Conversion % (interested / calls, calculated)', 'pct', (b) => b.calculated.interestedPercentOfCalls],
  ['Distinct leads called', 'int', (b) => b.figures.calls.distinctLeads], ['Repeat calls', 'int', (b) => b.figures.calls.repeatCalls],
  ['Not interested', 'int', (b) => b.figures.calls.notInterested],
  ['Follow-up required', 'int', (b) => b.figures.calls.followUpRequired], ['No response', 'int', (b) => b.figures.calls.noResponse],
  ['Days from Call desk', 'int', (b) => b.figures.calls.sources.callLogDays], ['Days from manual report only', 'int', (b) => b.figures.calls.sources.manualOnlyDays],
  ['Days with both (manual ignored)', 'int', (b) => b.figures.calls.sources.mixedDays], ['Manual calls ignored (same day had Call desk calls)', 'int', (b) => b.figures.calls.sources.manualIgnoredCalls],
  ['Leads added', 'int', (b) => b.figures.leadsCreated],
  ['Interviews scheduled', 'int', (b) => b.figures.interviews.scheduled], ['Interviews attended', 'int', (b) => b.figures.interviews.attended],
  ['Interviews not attended', 'int', (b) => b.figures.interviews.didNotAttend], ['Selected', 'int', (b) => b.figures.interviews.selected],
  ['Payment commitments', 'int', (b) => b.figures.payments.commitments], ['Amount committed', 'money', (b) => num(b.figures.payments.committedAmount)],
  ['Revenue received', 'money', (b) => num(b.figures.revenueReceived)],
  ['Calls target', 'int', (b) => b.targets.calls], ['Calls achieved % (calculated)', 'pct', (b) => b.achievement.calls],
  ['Interested target', 'int', (b) => b.targets.interested], ['Interested achieved % (calculated)', 'pct', (b) => b.achievement.interested],
  ['Interviews target', 'int', (b) => b.targets.interviews], ['Interviews achieved % (calculated)', 'pct', (b) => b.achievement.interviews],
  ['Revenue target', 'money', (b) => num(b.targets.revenue)], ['Revenue achieved % (calculated)', 'pct', (b) => b.achievement.revenue]
];

// -> { title, headers:[...], kinds:[...], rows:[[cell,...]] (BDE rows then a TEAM TOTAL row), notes:[string] }. Text cells are formula-safe.
export function buildSummaryTable(report, generatedAt) {
  const rows = report.bdes.map((b) => COLUMNS.map(([, kind, get]) => (kind === 'text' ? safeCell(get(b)) : get(b))));
  const total = { ...report.total, name: 'TEAM TOTAL', employeeId: '' };
  rows.push(COLUMNS.map(([, kind, get]) => (kind === 'text' ? get(total) : get(total))));
  const notes = [
    `${report.title || 'Monthly report'}: ${report.label} (${report.from} to the day before ${report.toExclusive})`,
    `Generated (UTC): ${generatedAt}`,
    ...Object.entries(report.basis).map(([k, v]) => `${k}: ${v}`),
    'Empty target or achievement cells mean no target was set. Team target = sum of the targets that were set.'
  ];
  return { title: `${report.title || 'Monthly report'} - ${report.label}`, headers: COLUMNS.map((c) => c[0]), kinds: COLUMNS.map((c) => c[1]), rows, notes };
}

// Compact table for the PDF (landscape A4 has room for about 9 columns).
export function buildPdfTable(report) {
  const money = (t) => (t === null || t === undefined ? '-' : Number(t).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (p) => (p === null || p === undefined ? '-' : `${p}%`);
  // The first nine columns keep their original order; the two new ones are appended.
  const headers = ['BDE', 'Calls', 'Interested', 'Interviews (sched./selected)', 'Commitments', 'Revenue received', 'Calls achieved', 'Interested achieved', 'Revenue achieved', 'Conversion', 'Distinct leads'];
  const line = (b) => [String(b.name), String(b.figures.calls.total), String(b.figures.calls.interested), `${b.figures.interviews.scheduled} / ${b.figures.interviews.selected}`,
    String(b.figures.payments.commitments), money(b.figures.revenueReceived), pct(b.achievement.calls), pct(b.achievement.interested), pct(b.achievement.revenue),
    pct(b.calculated.interestedPercentOfCalls), String(b.figures.calls.distinctLeads)];
  const rows = report.bdes.map((b) => line({ ...b, name: `${b.name} (${b.employeeId})` }));
  rows.push(line({ ...report.total, name: 'TEAM TOTAL' }));
  return { headers, rows };
}

export function exportFileName(report, ext) { return `${report.kind === 'range' ? 'report' : 'monthly-report'}-${report.month}.${ext}`; }

// ---- renderers (library calls) ----
const libError = () => new HttpError(500, 'EXPORT_UNAVAILABLE', 'This export is not available on the server (a required package is not installed).');

export async function renderXlsx(report, { generatedAt = new Date().toISOString(), loadExcelJs = async () => (await import('exceljs')).default } = {}) {
  let ExcelJS;
  try { ExcelJS = await loadExcelJs(); } catch { throw libError(); }
  const t = buildSummaryTable(report, generatedAt);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ADZ4NEEDZ BDE Tracker'; wb.created = new Date(generatedAt);
  const ws = wb.addWorksheet('Monthly summary', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  ws.columns = t.headers.map((h, i) => ({ header: h, key: 'c' + i, width: i === 0 ? 26 : Math.max(12, Math.min(26, h.length)) }));
  ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { wrapText: true, vertical: 'top' };
  for (const r of t.rows) ws.addRow(r);
  t.kinds.forEach((k, i) => {
    const col = ws.getColumn(i + 1);
    if (k === 'money') col.numFmt = '#,##0.00'; else if (k === 'pct') col.numFmt = '0.0'; else if (k === 'int') col.numFmt = '0';
  });
  ws.getRow(t.rows.length + 1).font = { bold: true }; // TEAM TOTAL
  const about = wb.addWorksheet('About this report');
  about.getColumn(1).width = 120;
  for (const n of t.notes) about.addRow([n]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function renderPdf(report, { generatedAt = new Date().toISOString(), loadPdfKit = async () => (await import('pdfkit')).default } = {}) {
  let PDFDocument;
  try { PDFDocument = await loadPdfKit(); } catch { throw libError(); }
  const { headers, rows } = buildPdfTable(report);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `${report.title || 'Monthly report'} ${report.label}`, Author: 'ADZ4NEEDZ BDE Tracker' } });
  const chunks = [];
  const done = new Promise((resolve, reject) => { doc.on('data', (c) => chunks.push(c)); doc.on('end', resolve); doc.on('error', reject); });
  const left = doc.page.margins.left; const width = doc.page.width - left - doc.page.margins.right; const bottom = () => doc.page.height - doc.page.margins.bottom;
  doc.font('Helvetica-Bold').fontSize(16).text(`${report.title || 'Monthly report'} - ${report.label}`, left, doc.y);
  doc.font('Helvetica').fontSize(9).text(`Generated (UTC): ${generatedAt}   |   Team: ${report.total.figures.calls.total} calls, ${report.total.figures.calls.interested} interested leads (${report.total.calculated.interestedPercentOfCalls === null ? '-' : report.total.calculated.interestedPercentOfCalls + '%'} conversion), revenue received ${report.total.figures.revenueReceived}`);
  doc.moveDown(0.8);
  const colW = [width * 0.2, ...Array(headers.length - 1).fill((width * 0.8) / (headers.length - 1))];
  const drawRow = (cells, bold) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: colW[i] - 4 }))) + 6;
    if (y + h > bottom() && y > doc.page.margins.top + 1) { doc.addPage(); return drawRow(cells, bold); } // (a row taller than a page is drawn anyway, never loops)
    let x = left;
    cells.forEach((c, i) => { doc.text(c, x + 2, y + 3, { width: colW[i] - 4 }); x += colW[i]; });
    doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.3).stroke('#999999');
    doc.y = y + h;
  };
  drawRow(headers, true);
  rows.forEach((r, i) => drawRow(r, i === rows.length - 1));
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(8).text(`Figures come from the database. Calls = Call desk calls plus manual reports (one source per BDE per day, never both). Interested = interested leads; Conversion = interested / calls. "Achieved" is CALCULATED as actual / target; "-" means no target was set. Revenue = money recorded as received, placed by date paid.`, left, doc.y, { width });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
