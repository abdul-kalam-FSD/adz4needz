// Server-side validation for an interview (the real one; the frontend has a mirror copy for quick feedback).
import { isRealDate } from './validate-daily-report.js';

export const ATTENDANCE_VALUES = ['pending', 'attended', 'did_not_attend'];
export const OUTCOME_VALUES = ['pending', 'selected', 'not_selected'];

// ASSUMPTION (TL to confirm): an outcome (Selected / Not Selected) can only be recorded for a candidate who attended.
// Set to false to drop this rule; nothing else depends on it.
export const OUTCOME_REQUIRES_ATTENDANCE = true;

const MIN_YEAR = 1000; // MySQL DATETIME range
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::00)?$/;
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// forCreate = true: leadId is required and omitted optional fields get defaults.
// forCreate = false (update): the whole record is replaced, so every field must be sent (no silent resets) and
// leadId is ignored (an interview never moves to another lead).
export function validateInterview(body, { forCreate = true } = {}) {
  const errors = {};
  const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  }

  if (forCreate) {
    const lid = body.leadId;
    if (blank(lid)) errors.leadId = 'Choose the lead this interview is for.';
    else if ((typeof lid === 'number' && Number.isSafeInteger(lid) && lid > 0) || (typeof lid === 'string' && /^[1-9]\d{0,17}$/.test(lid.trim()))) value.leadId = String(lid).trim();
    else errors.leadId = 'Choose a valid lead.';
  }

  // Date and time (wall-clock, minute precision), e.g. "2026-06-15T14:30"
  if (blank(body.scheduledAt)) errors.scheduledAt = 'Interview date and time are required.';
  else {
    const m = typeof body.scheduledAt === 'string' ? DATE_TIME.exec(body.scheduledAt.trim()) : null;
    if (!m || !isRealDate(m[1]) || Number(m[1].slice(0, 4)) < MIN_YEAR || Number(m[2]) > 23 || Number(m[3]) > 59) {
      errors.scheduledAt = 'Enter a valid interview date and time.';
    } else value.scheduledAt = `${m[1]} ${m[2]}:${m[3]}:00`;
  }

  const required = (key, msg) => { if (!forCreate && body[key] === undefined) { errors[key] = msg; return true; } return false; };

  // Attendance
  if (!required('attendance', 'Attendance is required.')) {
    if (body.attendance === undefined) value.attendance = 'pending';
    else if (ATTENDANCE_VALUES.includes(body.attendance)) value.attendance = body.attendance;
    else errors.attendance = 'Choose Pending, Attended or Did Not Attend.';
  }

  // Outcome
  if (!required('outcome', 'Outcome is required.')) {
    if (body.outcome === undefined) value.outcome = 'pending';
    else if (OUTCOME_VALUES.includes(body.outcome)) value.outcome = body.outcome;
    else errors.outcome = 'Choose Pending, Selected or Not Selected.';
  }
  if (OUTCOME_REQUIRES_ATTENDANCE && !errors.attendance && !errors.outcome && value.outcome !== 'pending' && value.attendance !== 'attended') {
    errors.outcome = 'An outcome can only be recorded after the candidate has attended.';
  }

  // Interested in joining: true / false / null (not recorded yet)
  if (!required('interestedInJoining', 'Interest in joining is required (use null if not known yet).')) {
    const v = body.interestedInJoining;
    if (v === undefined || v === null) value.interestedInJoining = null;
    else if (typeof v === 'boolean') value.interestedInJoining = v;
    else errors.interestedInJoining = 'Choose Yes, No or Not recorded.';
  }

  // NOTE (Phase 6): "payment confirmed" is no longer entered here. It is derived from payment records (see lib/payment-confirmed-sql.js),
  // so a paymentConfirmed value in the request body is ignored, like the owner fields.

  return { ok: Object.keys(errors).length === 0, errors, value };
}
