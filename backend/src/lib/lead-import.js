// Pure (no I/O) logic for the admin Excel/CSV lead import: header auto-mapping, row normalisation, validation and
// duplicate detection. The file READING lives in import-file-reader.js; the database work lives in the imports module.
// Everything here is unit-tested without any dependency or database.
import { validateLead } from './validate-lead.js';
import { isRealDate } from './validate-daily-report.js';

export const MAX_IMPORT_ROWS = 5000;

// Target fields an uploaded column can be mapped to. `required` fields must be present for a row to be valid
// (contact = phone OR email, enforced by validateLead).
export const IMPORT_FIELDS = [
  { key: 'candidateName', label: 'Candidate name', required: true },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'courseOrInternship', label: 'Course / internship', required: false }, // may come from the batch default course
  { key: 'status', label: 'Lead status', required: false },
  { key: 'followUpDate', label: 'Follow-up date', required: false },
  { key: 'nextAction', label: 'Next action / notes', required: false },
  { key: 'employeeId', label: 'BDE employee ID', required: false }
];
export const FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key);

const ALIASES = {
  candidateName: ['name', 'candidate name', 'candidate', 'student name', 'student', 'full name', 'candidate full name'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'mobile no', 'contact', 'contact number', 'contact no', 'whatsapp', 'whatsapp number'],
  email: ['email', 'email id', 'email address', 'e-mail', 'mail', 'mail id'],
  courseOrInternship: ['course', 'internship', 'course/internship', 'course or internship', 'interested course', 'interested in', 'program', 'programme', 'domain', 'course interested'],
  status: ['status', 'lead status', 'response', 'outcome', 'call status', 'call response'],
  followUpDate: ['follow up date', 'follow-up date', 'followup date', 'follow up', 'follow-up', 'next follow up', 'next follow up date'],
  nextAction: ['next action', 'remarks', 'remark', 'notes', 'note', 'comments', 'comment'],
  employeeId: ['employee id', 'emp id', 'employee', 'bde', 'bde id', 'bde employee id', 'assigned to', 'assigned bde']
};

// Synonyms used when the status text in the file does not exactly match a configured lead status name.
const STATUS_SYNONYMS = {
  'interested': 'Interested', 'not interested': 'Not Interested', 'notinterested': 'Not Interested',
  'follow up': 'Follow-up Required', 'followup': 'Follow-up Required', 'follow-up': 'Follow-up Required', 'follow up required': 'Follow-up Required',
  'no response': 'No Response / Not Reachable', 'not reachable': 'No Response / Not Reachable', 'not answering': 'No Response / Not Reachable', 'new': 'New'
};

export const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim();
const normLoose = (h) => normHeader(h).replace(/ /g, '');

// headers: array of header cell values (in column order). Returns { mapping: {fieldKey: columnIndex}, unmapped: [colIndex] }.
// Matching is exact on the normalised header (spaces/underscores/dashes ignored); each column is used at most once.
export function autoMapHeaders(headers) {
  const mapping = {};
  const used = new Set();
  const cols = headers.map((h, i) => ({ i, strict: normHeader(h), loose: normLoose(h) }));
  for (const key of FIELD_KEYS) {
    const wanted = ALIASES[key].map((a) => ({ strict: normHeader(a), loose: normLoose(a) }));
    const hit = cols.find((c) => !used.has(c.i) && c.loose !== '' && wanted.some((w) => w.strict === c.strict || w.loose === c.loose));
    if (hit) { mapping[key] = hit.i; used.add(hit.i); }
  }
  const unmapped = cols.filter((c) => !used.has(c.i) && c.loose !== '').map((c) => c.i);
  return { mapping, unmapped };
}

// Validates a mapping supplied by the admin: known keys only, integer column indexes inside the header range, no column
// used twice. Returns { ok, errors, value }.
export function validateMapping(raw, columnCount) {
  const errors = {};
  const value = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: { _form: 'Mapping must be an object.' }, value };
  const seen = new Set();
  for (const [key, idx] of Object.entries(raw)) {
    if (!FIELD_KEYS.includes(key)) { errors[key] = 'Unknown field.'; continue; }
    if (idx === null || idx === '' || idx === undefined) continue; // "not mapped"
    if (!Number.isInteger(idx) || idx < 0 || idx >= columnCount) { errors[key] = 'Choose a column from the file.'; continue; }
    if (seen.has(idx)) { errors[key] = 'This column is already used for another field.'; continue; }
    seen.add(idx); value[key] = idx;
  }
  if (value.candidateName === undefined && !errors.candidateName) errors.candidateName = 'Map a column to Candidate name.';
  if (value.phone === undefined && value.email === undefined && !errors.phone) errors.phone = 'Map a Phone or an Email column (at least one contact column is needed).';
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// ---- cell normalisation -------------------------------------------------------------------------------------------

function cellText(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : String(v)) : '';
  if (typeof v === 'object') { // exceljs rich text / hyperlink / formula result cells
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
    return '';
  }
  return String(v).trim();
}

const pad = (n) => String(n).padStart(2, '0');

// Accepts a Date (Excel date cell), YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY. Returns 'YYYY-MM-DD' or null.
// Indian-style day-first is assumed for dd/mm/yyyy (documented in README).
export function normalizeDate(v) {
  if (v === undefined || v === null || v === '') return { value: null };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { error: true };
    const s = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return isRealDate(s) ? { value: s } : { error: true };
  }
  const t = cellText(v);
  if (t === '') return { value: null };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(t);
  let s = null;
  if (m) s = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  else if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t))) s = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return s && isRealDate(s) ? { value: s } : { error: true };
}

function cellPhone(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v)); // Excel stores 9876543210 as a number
  return cellText(v);
}

// statuses: [{id, name}] active statuses. Returns { id } | { error }. Empty -> default status id.
export function resolveStatus(text, statuses, defaultStatusId) {
  const t = String(text ?? '').trim();
  if (t === '') return { id: defaultStatusId };
  const key = normHeader(t);
  const direct = statuses.find((s) => normHeader(s.name) === key);
  if (direct) return { id: direct.id };
  const syn = STATUS_SYNONYMS[key] || STATUS_SYNONYMS[normLoose(t)];
  const viaSyn = syn && statuses.find((s) => normHeader(s.name) === normHeader(syn));
  return viaSyn ? { id: viaSyn.id } : { error: `Unknown status "${t.slice(0, 40)}". Allowed: ${statuses.map((s) => s.name).join(', ')}.` };
}

// ---- row processing -----------------------------------------------------------------------------------------------

// rawRow: array of cell values. ctx: { mapping, statuses, defaultStatusId, defaultCourse, defaultBdeId, bdeByEmployeeId: Map(lower employeeId -> {id}) }
// Returns { status: 'valid'|'invalid', errors: {field: message}, lead: {...normalised...}|null, bdeId }.
export function processRow(rawRow, ctx) {
  const get = (key) => (ctx.mapping[key] === undefined ? undefined : rawRow[ctx.mapping[key]]);
  const errors = {};
  const body = {
    candidateName: cellText(get('candidateName')),
    phone: cellPhone(get('phone')),
    email: cellText(get('email')),
    courseOrInternship: cellText(get('courseOrInternship')) || ctx.defaultCourse || '',
    nextAction: cellText(get('nextAction'))
  };
  const st = resolveStatus(cellText(get('status')), ctx.statuses, ctx.defaultStatusId);
  if (st.error) errors.status = st.error; else body.leadStatusId = st.id;
  const d = normalizeDate(get('followUpDate'));
  if (d.error) errors.followUpDate = 'Follow-up date is not valid. Use YYYY-MM-DD or DD-MM-YYYY.'; else body.followUpDate = d.value || '';

  const v = validateLead(body);
  if (!v.ok) {
    for (const [k, msg] of Object.entries(v.errors)) if (!errors[k === 'leadStatusId' ? 'status' : k]) errors[k === 'leadStatusId' ? 'status' : k] = msg;
  }

  let bdeId = ctx.defaultBdeId ?? null;
  const emp = cellText(get('employeeId'));
  if (emp !== '') {
    const hit = ctx.bdeByEmployeeId.get(emp.toLowerCase());
    if (!hit) errors.employeeId = `No active BDE with employee ID "${emp.slice(0, 32)}".`;
    else bdeId = hit.id;
  }
  if (bdeId === null && !errors.employeeId) errors.employeeId = 'No BDE to assign this lead to: choose a default BDE or map an employee ID column.';

  if (Object.keys(errors).length) return { status: 'invalid', errors, lead: null, bdeId };
  return { status: 'valid', errors: {}, lead: (({ confirmDuplicate, ...rest }) => rest)(v.value), bdeId };
}

// Marks later rows that repeat the phone/email key of an earlier VALID row in the same file. Mutates and returns results.
// results: array of processRow outputs (index = file order). First occurrence wins.
export function markInFileDuplicates(results) {
  const seenPhone = new Map(); const seenEmail = new Map();
  results.forEach((r, i) => {
    if (r.status !== 'valid') return;
    const pk = r.lead.phoneKey; const ek = r.lead.emailKey;
    const byPhone = pk ? seenPhone.get(pk) : undefined;
    const byEmail = ek ? seenEmail.get(ek) : undefined;
    const first = byPhone !== undefined ? byPhone : byEmail;
    if (first !== undefined) {
      r.status = 'duplicate_in_file';
      r.duplicateOf = first; // 0-based index of the first occurrence
      return;
    }
    if (pk) seenPhone.set(pk, i);
    if (ek) seenEmail.set(ek, i);
  });
  return results;
}

// Tally by status for the preview header.
export function summarize(statuses) {
  const out = { total: 0, valid: 0, invalid: 0, duplicateInFile: 0, duplicateExisting: 0 };
  for (const s of statuses) {
    out.total += 1;
    if (s === 'valid') out.valid += 1;
    else if (s === 'invalid') out.invalid += 1;
    else if (s === 'duplicate_in_file') out.duplicateInFile += 1;
    else if (s === 'duplicate_existing') out.duplicateExisting += 1;
  }
  return out;
}

// Spreadsheet formula injection guard for any exported cell text (used by exports and the invalid-rows download).
export function safeCell(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
