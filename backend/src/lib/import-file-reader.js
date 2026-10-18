// Reads an uploaded .xlsx or .csv into { headers, rows } (arrays of cell values). The first non-empty row is the header row.
// - CSV is parsed here (pure, unit-tested).
// - XLSX uses the `exceljs` package (declared in package.json). It is loaded lazily so that everything else in the app
//   (and the unit tests) works without it. The exceljs path could NOT be run in the authoring sandbox (npm registry was
//   unreachable): see HANDOFF.md "Unverified".
import { HttpError } from './http-error.js';
import { MAX_IMPORT_ROWS } from './lead-import.js';

export const IMPORT_MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv'
};
export const ALLOWED_IMPORT_MIME = Object.values(IMPORT_MIME);
export const MAX_COLUMNS = 60;

// Decides the format from the file CONTENT (zip signature => xlsx), not from the name or the declared type.
export function sniffFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05) ) return 'xlsx';
  if (buf.includes(0)) return null; // binary that is not a zip => not CSV
  return 'csv';
}

// RFC 4180 style: quoted fields, "" escapes, CR/LF/CRLF, UTF-8 BOM, delimiter , or ; (picked from the header line).
export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.split(/\r\n|\n|\r/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let field = ''; let inQ = false; let i = 0;
  const endRow = () => { row.push(field); field = ''; rows.push(row); row = []; };
  while (i < src.length) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i += 1; continue; }
      field += c; i += 1; continue;
    }
    if (c === '"' && field === '') { inQ = true; i += 1; continue; }
    if (c === delim) { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { endRow(); i += src[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (inQ) throw new HttpError(400, 'IMPORT_FILE_INVALID', 'The CSV file has an unclosed quote.');
  if (field !== '' || row.length) endRow();
  return rows;
}

function finish(allRows) {
  const nonEmpty = allRows.filter((r) => r.some((c) => String(c ?? '').trim() !== '' || c instanceof Date));
  if (nonEmpty.length === 0) throw new HttpError(400, 'IMPORT_FILE_EMPTY', 'The file has no data.');
  const headers = nonEmpty[0].map((h) => String(h ?? '').trim());
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  if (headers.length === 0) throw new HttpError(400, 'IMPORT_FILE_INVALID', 'The first row must contain column headings.');
  if (headers.length > MAX_COLUMNS) throw new HttpError(400, 'IMPORT_FILE_INVALID', `The file has more than ${MAX_COLUMNS} columns.`);
  const rows = nonEmpty.slice(1).map((r) => headers.map((_, i) => (r[i] === undefined ? '' : r[i])));
  if (rows.length === 0) throw new HttpError(400, 'IMPORT_FILE_EMPTY', 'The file has headings but no data rows.');
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, 'IMPORT_FILE_TOO_LARGE', `The file has ${rows.length} data rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`);
  return { headers, rows };
}

async function readXlsx(buf, loadExcelJs) {
  let ExcelJS;
  try { ExcelJS = await loadExcelJs(); } catch { throw new HttpError(500, 'IMPORT_UNAVAILABLE', 'Excel reading is not available on the server (the exceljs package is not installed).'); }
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw new HttpError(400, 'IMPORT_FILE_INVALID', 'This file could not be read as an Excel (.xlsx) workbook.'); }
  const sheet = wb.worksheets.find((s) => s.rowCount > 0) || wb.worksheets[0];
  if (!sheet) throw new HttpError(400, 'IMPORT_FILE_EMPTY', 'The workbook has no sheets.');
  const all = [];
  sheet.eachRow({ includeEmpty: false }, (row) => { all.push(row.values.slice(1)); }); // row.values is 1-based
  return finish(all);
}

// loadExcelJs is injectable for tests.
export async function readImportFile(buf, { loadExcelJs = async () => (await import('exceljs')).default } = {}) {
  const format = sniffFormat(buf);
  if (!format) throw new HttpError(400, 'IMPORT_FILE_INVALID', 'Upload an Excel (.xlsx) or CSV file.');
  if (format === 'xlsx') return { format, ...(await readXlsx(buf, loadExcelJs)) };
  return { format, ...finish(parseCsv(buf.toString('utf8'))) };
}
