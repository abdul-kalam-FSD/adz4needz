// "Download Excel" / "Update leads from Excel" for admins. Pure functions only (no I/O); the thin Excel render lives in the service.
//
// WHAT THE SHEET CAN CHANGE: Status, Follow-up date and Next action of EXISTING leads. A blank cell means "keep what is there" (a blank can
// never clear a value). Nothing else is read from the sheet: names, phones, courses and owners are display-only, and rows without a known
// Lead ID are reported, never created. New students, interview booking and reassignment are separate features.
//
// SAFETY AGAINST STALE SHEETS: every row carries "Last updated (UTC)" as it was when the file was downloaded. If the lead changed since
// (a BDE edited it, a call moved its status), the row is a CONFLICT and is skipped, so an old sheet cannot overwrite newer work.
import { normHeader, normalizeDate, resolveStatus, safeCell } from './lead-import.js';

export const SHEET_HEADERS = ['Lead ID', 'Candidate', 'Phone', 'Course', 'BDE', 'Status', 'Follow-up date', 'Next action', 'Last updated (UTC)'];
export const NEXT_ACTION_MAX = 500;
const KEYS = { 'lead id': 'leadId', status: 'status', 'follow up date': 'followUp', 'next action': 'nextAction', 'last updated utc': 'stamp' };

export function sheetRows(leads) {
  return leads.map((l) => [Number(l.id), safeCell(l.candidate_name), safeCell(l.phone || ''), safeCell(l.course_or_internship), safeCell(`${l.bde_name} (${l.employee_id})`),
    l.status_name, l.follow_up_date ? String(l.follow_up_date).slice(0, 10) : '', safeCell(l.next_action || ''), String(l.updated_at)]);
}

const text = (v) => {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'object') return text(v.text !== undefined ? v.text : v.result !== undefined ? v.result : '');
  return String(v).trim();
};

// -> { ok:true, cols:{leadId, status, followUp, nextAction, stamp} } | { ok:false, message }
export function mapSheetHeaders(headers) {
  const cols = {};
  headers.forEach((h, i) => { const k = KEYS[normHeader(String(h).replace(/[()]/g, ' '))]; if (k && cols[k] === undefined) cols[k] = i; });
  const missing = ['leadId', 'stamp'].filter((k) => cols[k] === undefined);
  if (missing.length) return { ok: false, message: 'This does not look like a sheet downloaded from the Leads screen: the "Lead ID" and "Last updated (UTC)" columns are missing. Download a fresh sheet and edit that.' };
  if (cols.status === undefined && cols.followUp === undefined && cols.nextAction === undefined) return { ok: false, message: 'The sheet has none of the editable columns (Status, Follow-up date, Next action).' };
  return { ok: true, cols };
}

// parsed: { headers, rows }. leadsById: Map(String(id) -> current lead row). statuses: active statuses [{id, name}].
// Returns { rows:[{ rowNumber, leadId, candidate, state, changes, errors, update }], summary }.
// state: 'change' | 'unchanged' | 'error' | 'conflict' | 'unknown_lead'.
export function planSheetUpdates(parsed, { leadsById, statuses }) {
  const m = mapSheetHeaders(parsed.headers);
  if (!m.ok) return { ok: false, message: m.message };
  const { cols } = m;
  const seen = new Set(); const rows = [];
  parsed.rows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // row 1 is the heading
    const idText = text(raw[cols.leadId]);
    const base = { rowNumber, leadId: idText, candidate: '', state: 'error', changes: {}, errors: {}, update: null };
    if (!/^[1-9]\d{0,17}$/.test(idText)) { rows.push({ ...base, errors: { leadId: 'The Lead ID is missing or not a number.' } }); return; }
    if (seen.has(idText)) { rows.push({ ...base, errors: { leadId: 'This Lead ID appears more than once in the sheet.' } }); return; }
    seen.add(idText);
    const lead = leadsById.get(idText);
    if (!lead) { rows.push({ ...base, state: 'unknown_lead', errors: { leadId: 'No lead with this ID exists.' } }); return; }
    const row = { ...base, candidate: lead.candidate_name };
    if (text(raw[cols.stamp]) !== String(lead.updated_at)) { rows.push({ ...row, state: 'conflict', errors: { leadId: 'This lead was changed after the sheet was downloaded. Download a fresh sheet.' } }); return; }

    const next = { leadStatusId: Number(lead.lead_status_id), followUpDate: lead.follow_up_date ? String(lead.follow_up_date).slice(0, 10) : null, nextAction: lead.next_action ?? null };
    const changes = {}; const errors = {};
    const sText = cols.status === undefined ? '' : text(raw[cols.status]);
    if (sText !== '') {
      const r = resolveStatus(sText, statuses, null);
      if (r.error) errors.status = r.error;
      else if (Number(r.id) !== next.leadStatusId) { changes.status = { from: lead.status_name, to: statuses.find((s) => Number(s.id) === Number(r.id)).name }; next.leadStatusId = Number(r.id); }
    }
    const fRaw = cols.followUp === undefined ? '' : raw[cols.followUp];
    if (text(fRaw) !== '') {
      const d = normalizeDate(fRaw);
      if (d.error || !d.value) errors.followUpDate = 'Use a real date such as 2026-10-20 or 20/10/2026.';
      else if (d.value !== next.followUpDate) { changes.followUpDate = { from: next.followUpDate, to: d.value }; next.followUpDate = d.value; }
    }
    const nText = cols.nextAction === undefined ? '' : text(raw[cols.nextAction]);
    if (nText !== '') {
      if (nText.length > NEXT_ACTION_MAX) errors.nextAction = `Next action must be at most ${NEXT_ACTION_MAX} characters.`;
      else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(nText)) errors.nextAction = 'Next action contains characters that are not allowed.';
      else if (nText !== (next.nextAction ?? '')) { changes.nextAction = { from: next.nextAction, to: nText }; next.nextAction = nText; }
    }
    if (Object.keys(errors).length) { rows.push({ ...row, state: 'error', errors }); return; }
    if (Object.keys(changes).length === 0) { rows.push({ ...row, state: 'unchanged' }); return; }
    rows.push({ ...row, state: 'change', changes, update: { id: idText, leadStatusId: next.leadStatusId, followUpDate: next.followUpDate, nextAction: next.nextAction, expectedUpdatedAt: String(lead.updated_at) } });
  });
  const count = (s) => rows.filter((r) => r.state === s).length;
  return { ok: true, rows, summary: { total: rows.length, willChange: count('change'), unchanged: count('unchanged'), errors: count('error'), conflicts: count('conflict'), unknownLeads: count('unknown_lead') } };
}
