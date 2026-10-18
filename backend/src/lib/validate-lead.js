// Server-side validation for a lead (the real one; the frontend has a mirror copy for quick feedback).
import { isRealDate } from './validate-daily-report.js';

export const LIMITS = { name: 120, course: 150, email: 254, phone: 20, nextAction: 500 };
const CONTROL = /[\u0000-\u001F\u007F]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F]/;

// Matching keys used ONLY to flag possible duplicates (never to merge anything).
// Phone key = digits only, last 10 digits when there are 10 or more (so "+91 98765 43210" and "9876543210" match).
export function normalizePhoneKey(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}
export const normalizeEmailKey = (email) => String(email).trim().toLowerCase();

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function validateLead(body) {
  const errors = {};
  const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  }

  // Candidate name
  if (blank(body.candidateName)) errors.candidateName = 'Candidate name is required.';
  else if (typeof body.candidateName !== 'string' || CONTROL.test(body.candidateName)) errors.candidateName = 'Candidate name contains invalid characters.';
  else if (body.candidateName.trim().length > LIMITS.name) errors.candidateName = `Candidate name must be at most ${LIMITS.name} characters.`;
  else value.candidateName = body.candidateName.trim();

  // Phone (optional)
  value.phone = null; value.phoneKey = null;
  if (!blank(body.phone)) {
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const digits = phone.replace(/\D/g, '');
    if (!/^[0-9+\-().\s]{1,20}$/.test(phone) || digits.length < 7 || digits.length > 15) {
      errors.phone = 'Enter a valid phone number (7 to 15 digits).';
    } else { value.phone = phone; value.phoneKey = normalizePhoneKey(phone); }
  }

  // Email (optional)
  value.email = null; value.emailKey = null;
  if (!blank(body.email)) {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email.length > LIMITS.email || CONTROL.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Enter a valid email address.';
    } else { value.email = email; value.emailKey = normalizeEmailKey(email); }
  }

  // ASSUMPTION (TL to confirm): at least one contact detail is required.
  if (!errors.phone && !errors.email && value.phone === null && value.email === null) {
    errors.phone = 'Enter a phone number or an email address (at least one contact detail is needed).';
  }

  // Course / internship (free text for now; a fixed list needs TL confirmation)
  if (blank(body.courseOrInternship)) errors.courseOrInternship = 'Course or internship is required.';
  else if (typeof body.courseOrInternship !== 'string' || CONTROL.test(body.courseOrInternship)) errors.courseOrInternship = 'Course or internship contains invalid characters.';
  else if (body.courseOrInternship.trim().length > LIMITS.course) errors.courseOrInternship = `Course or internship must be at most ${LIMITS.course} characters.`;
  else value.courseOrInternship = body.courseOrInternship.trim();

  // Lead status (id from the lead_statuses table)
  const sid = body.leadStatusId;
  if (blank(sid)) errors.leadStatusId = 'Choose a lead status.';
  else if ((typeof sid === 'number' && Number.isInteger(sid) && sid > 0) || (typeof sid === 'string' && /^[1-9]\d{0,8}$/.test(sid.trim()))) value.leadStatusId = Number(sid);
  else errors.leadStatusId = 'Choose a valid lead status.';

  // Follow-up date (optional)
  value.followUpDate = null;
  if (!blank(body.followUpDate)) {
    const d = typeof body.followUpDate === 'string' ? body.followUpDate.trim() : '';
    if (!isRealDate(d)) errors.followUpDate = 'Follow-up date is not valid. Choose a date from the calendar.';
    else value.followUpDate = d;
  }

  // Next action (optional)
  value.nextAction = null;
  if (!blank(body.nextAction)) {
    if (typeof body.nextAction !== 'string' || CONTROL_EXCEPT_NEWLINE.test(body.nextAction)) errors.nextAction = 'Next action contains invalid characters.';
    else if (body.nextAction.trim().length > LIMITS.nextAction) errors.nextAction = `Next action must be at most ${LIMITS.nextAction} characters.`;
    else value.nextAction = body.nextAction.trim();
  }

  value.confirmDuplicate = body.confirmDuplicate === true;
  return { ok: Object.keys(errors).length === 0, errors, value };
}
