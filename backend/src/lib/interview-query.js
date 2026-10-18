// Parses and validates the query string of the interview list / summary / overview endpoints.
import { isRealDate } from './validate-daily-report.js';
import { ATTENDANCE_VALUES, OUTCOME_VALUES } from './validate-interview.js';

export const WHEN_FILTERS = ['upcoming', 'today', 'needs_update'];
export const INTERESTED_FILTERS = ['yes', 'no', 'unknown'];
export const PAYMENT_FILTERS = ['yes', 'no'];

const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined ? '' : null); // null = wrong type (e.g. repeated param)
const posInt = (t) => (/^[1-9]\d{0,17}$/.test(t) ? t : null);
const posSmall = (t) => (/^[1-9]\d{0,8}$/.test(t) ? Number(t) : null);

export function parseInterviewQuery(query = {}, { admin = false } = {}) {
  const errors = {};
  const f = { q: '', attendance: null, outcome: null, interested: null, paymentConfirmed: null, when: null, scheduledFrom: null, scheduledTo: null, leadId: null, bdeId: null, today: null, page: 1, pageSize: 25 };

  const oneOf = (key, allowed, message) => {
    const v = str(query[key]);
    if (v === null || (v !== '' && v !== 'all' && !allowed.includes(v))) errors[key] = message;
    else if (v !== '' && v !== 'all') f[key] = v;
  };

  const q = str(query.q);
  if (q === null || q.length > 100) errors.q = 'Search text must be at most 100 characters.'; else f.q = q;

  oneOf('attendance', ATTENDANCE_VALUES, 'Invalid attendance filter.');
  oneOf('outcome', OUTCOME_VALUES, 'Invalid outcome filter.');
  oneOf('interested', INTERESTED_FILTERS, 'Invalid interest filter.');
  oneOf('paymentConfirmed', PAYMENT_FILTERS, 'Invalid payment filter.');
  oneOf('when', WHEN_FILTERS, 'Invalid date filter.');

  for (const key of ['scheduledFrom', 'scheduledTo']) {
    const v = str(query[key]);
    if (v === null || (v !== '' && !isRealDate(v))) errors[key] = 'Choose a valid date.';
    else if (v !== '') f[key] = v;
  }
  if (!errors.scheduledFrom && !errors.scheduledTo && f.scheduledFrom && f.scheduledTo && f.scheduledFrom > f.scheduledTo) {
    errors.scheduledTo = 'The "to" date must not be before the "from" date.';
  }

  const today = str(query.today);
  if (today === null || (today !== '' && !isRealDate(today))) errors.today = 'Invalid date for "today".';
  else if (today !== '') f.today = today;
  if (!errors.today && f.when && !f.today) errors.today = 'Today\'s date is required for this filter.';

  const lead = str(query.leadId);
  if (lead === null || (lead !== '' && posInt(lead) === null)) errors.leadId = 'Invalid lead filter.';
  else if (lead !== '') f.leadId = lead;

  if (admin) {
    const bde = str(query.bdeId);
    if (bde === null || (bde !== '' && posInt(bde) === null)) errors.bdeId = 'Invalid BDE filter.';
    else if (bde !== '') f.bdeId = bde;
  }

  const page = str(query.page);
  if (page === null || (page !== '' && posSmall(page) === null)) errors.page = 'Invalid page.'; else if (page !== '') f.page = Number(page);
  const size = str(query.pageSize);
  if (size === null || (size !== '' && (posSmall(size) === null || Number(size) > 100))) errors.pageSize = 'Page size must be 1 to 100.';
  else if (size !== '') f.pageSize = Number(size);

  return { ok: Object.keys(errors).length === 0, errors, value: f };
}

// Admin overview: optional range of interview dates.
export function parseOverviewQuery(query = {}) {
  const errors = {};
  const value = { scheduledFrom: null, scheduledTo: null };
  for (const key of ['scheduledFrom', 'scheduledTo']) {
    const v = str(query[key]);
    if (v === null || (v !== '' && !isRealDate(v))) errors[key] = 'Choose a valid date.';
    else if (v !== '') value[key] = v;
  }
  if (!errors.scheduledFrom && !errors.scheduledTo && value.scheduledFrom && value.scheduledTo && value.scheduledFrom > value.scheduledTo) {
    errors.scheduledTo = 'The "to" date must not be before the "from" date.';
  }
  return { ok: Object.keys(errors).length === 0, errors, value };
}
