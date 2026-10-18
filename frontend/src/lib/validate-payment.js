// Server-side validation for payment records and instalments.
import { isRealDate } from './validate-daily-report.js';
import { parseMoney } from './money.js';

export const LIMITS = { course: 150 };
const CONTROL = /[\u0000-\u001F\u007F]/;
const MIN_YEAR = 1000; // MySQL DATE range
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const okDate = (d) => typeof d === 'string' && isRealDate(d.trim()) && Number(d.trim().slice(0, 4)) >= MIN_YEAR;

function amountField(raw, label, errors, key, value, valueKey) {
  if (blank(raw)) { errors[key] = `${label} is required.`; return; }
  const paise = parseMoney(raw);
  if (paise === null) errors[key] = `${label} must be a positive amount with at most 2 decimals (up to 9999999999.99).`;
  else value[valueKey] = paise;
}

// forCreate = true: leadId is required. forCreate = false (update): leadId is ignored (a payment never moves to another lead).
export function validatePayment(body, { forCreate = true } = {}) {
  const errors = {}; const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };

  if (forCreate) {
    const lid = body.leadId;
    if (blank(lid)) errors.leadId = 'Choose the lead this payment is for.';
    else if ((typeof lid === 'number' && Number.isSafeInteger(lid) && lid > 0) || (typeof lid === 'string' && /^[1-9]\d{0,17}$/.test(lid.trim()))) value.leadId = String(lid).trim();
    else errors.leadId = 'Choose a valid lead.';
  }

  if (blank(body.courseOrInternship)) errors.courseOrInternship = 'Course or internship is required.';
  else if (typeof body.courseOrInternship !== 'string' || CONTROL.test(body.courseOrInternship)) errors.courseOrInternship = 'Course or internship contains invalid characters.';
  else if (body.courseOrInternship.trim().length > LIMITS.course) errors.courseOrInternship = `Course or internship must be at most ${LIMITS.course} characters.`;
  else value.courseOrInternship = body.courseOrInternship.trim();

  amountField(body.amountCommitted, 'Committed amount', errors, 'amountCommitted', value, 'amountCommitted');

  if (blank(body.commitmentDate)) errors.commitmentDate = 'Commitment date is required.';
  else if (!okDate(body.commitmentDate)) errors.commitmentDate = 'Commitment date is not valid. Choose a date from the calendar.';
  else value.commitmentDate = body.commitmentDate.trim();

  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function validateInstalment(body) {
  const errors = {}; const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  amountField(body.amount, 'Amount received', errors, 'amount', value, 'amount');
  if (blank(body.paidOn)) errors.paidOn = 'Payment date is required.';
  else if (!okDate(body.paidOn)) errors.paidOn = 'Payment date is not valid. Choose a date from the calendar.';
  else value.paidOn = body.paidOn.trim();
  value.confirmDuplicate = body.confirmDuplicate === true; // only the boolean true counts
  return { ok: Object.keys(errors).length === 0, errors, value };
}
