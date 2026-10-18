import { HttpError } from '../../lib/http-error.js';
import { readImportFile } from '../../lib/import-file-reader.js';
import { SHEET_HEADERS, planSheetUpdates, sheetRows } from '../../lib/lead-sheet.js';
import { SHEET_MAX_LEADS } from './lead-sheets.repository.js';

export const SHEET_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const requireAdmin = (actor) => { if (!actor || actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an admin can use lead sheets.'); };
const MAX_DETAIL_ROWS = 500;

async function renderSheet(rows, generatedAt, loadExcelJs) {
  let ExcelJS;
  try { ExcelJS = await loadExcelJs(); } catch { throw new HttpError(500, 'EXPORT_UNAVAILABLE', 'This export is not available on the server (a required package is not installed).'); }
  const wb = new ExcelJS.Workbook(); wb.creator = 'ADZ4NEEDZ BDE Tracker'; wb.created = new Date(generatedAt);
  const ws = wb.addWorksheet('Update leads', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = SHEET_HEADERS.map((h, i) => ({ header: h, key: 'c' + i, width: [9, 24, 16, 26, 22, 20, 16, 40, 20][i] }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  // Only these three columns are meant to be edited; the others are shaded as read-only context (not locked: Excel protection is not a security control).
  for (const col of [6, 7, 8]) ws.getColumn(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
  const about = wb.addWorksheet('How to use');
  about.getColumn(1).width = 110;
  for (const line of ['Edit ONLY the green columns: Status, Follow-up date, Next action. Leave a cell as it is to keep its value (a blank cell never clears anything).',
    'Do not change Lead ID or Last updated (UTC): they are how the upload recognises the lead and detects that it was changed after this download.',
    'Status must be one of the statuses shown on the Leads screen. Dates: 2026-10-20 or 20/10/2026.',
    'Upload the file on the Leads screen. You see every change before anything is saved. Rows that changed meanwhile are skipped.',
    'This sheet cannot add new leads, change owners, or change names, phones or courses.', `Generated (UTC): ${generatedAt}`]) about.addRow([line]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function createLeadSheetService({ repo, now = () => new Date(), loadExcelJs = async () => (await import('exceljs')).default, readFile = readImportFile }) {
  async function plan(body) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'IMPORT_FILE_INVALID', 'Upload an Excel (.xlsx) or CSV file.');
    const parsed = await readFile(body);
    const ids = [...new Set(parsed.rows.map((r) => String(r[parsed.headers.findIndex((h) => /^lead id$/i.test(h))] ?? '').trim()).filter((v) => /^[1-9]\d{0,17}$/.test(v)))];
    const found = ids.length ? await repo.findLeads(ids) : [];
    const result = planSheetUpdates(parsed, { leadsById: new Map(found.map((l) => [String(l.id), l])), statuses: await repo.listStatuses() });
    if (!result.ok) throw new HttpError(400, 'SHEET_INVALID', result.message);
    return result;
  }
  const detail = (r) => ({ rowNumber: r.rowNumber, leadId: r.leadId, candidate: r.candidate, state: r.state, changes: r.changes, errors: r.errors });
  return {
    async exportSheet(actor, bdeIdText) {
      requireAdmin(actor);
      let bdeId = null; let label = 'all-bdes';
      if (bdeIdText !== undefined && bdeIdText !== '') {
        if (!/^[1-9]\d{0,17}$/.test(String(bdeIdText))) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid BDE.', { bdeId: 'Choose a valid BDE.' });
        const b = await repo.findBde(String(bdeIdText));
        if (!b) throw new HttpError(404, 'NOT_FOUND', 'BDE not found.');
        bdeId = String(b.id); label = String(b.employee_id).replace(/[^A-Za-z0-9._-]/g, '');
      }
      const leads = await repo.listForSheet(bdeId);
      if (leads.length > SHEET_MAX_LEADS) throw new HttpError(409, 'SHEET_TOO_LARGE', `More than ${SHEET_MAX_LEADS} leads match. Choose one BDE to download a smaller sheet.`);
      const at = now().toISOString();
      return { buffer: await renderSheet(sheetRows(leads), at, loadExcelJs), fileName: `update-leads-${label}-${at.slice(0, 10)}.xlsx`, mime: SHEET_XLSX_MIME, count: leads.length };
    },

    // Shows every change; writes nothing.
    async preview(actor, { body }) {
      requireAdmin(actor);
      const p = await plan(body);
      const shown = p.rows.filter((r) => r.state !== 'unchanged');
      return { summary: p.summary, rows: shown.slice(0, MAX_DETAIL_ROWS).map(detail), rowsTruncated: shown.length > MAX_DETAIL_ROWS };
    },

    // Re-reads the SAME file, re-plans against the database as it is NOW, and writes only rows that are still unchanged since download.
    // Each lead is its own atomic UPDATE guarded by the sheet's "last updated" stamp; one failing row never rolls back the others (they are reported).
    async apply(actor, { body }) {
      requireAdmin(actor);
      const p = await plan(body);
      let applied = 0; let conflictsAtWrite = 0;
      for (const r of p.rows) {
        if (r.state !== 'change') continue;
        if (await repo.applyUpdate(r.update)) applied += 1; else conflictsAtWrite += 1;
      }
      return { applied, summary: { ...p.summary, conflicts: p.summary.conflicts + conflictsAtWrite, willChange: 0 }, conflictsAtWrite, skipped: p.summary.errors + p.summary.conflicts + p.summary.unknownLeads };
    }
  };
}
