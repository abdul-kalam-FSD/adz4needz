// Builds SQL fragments for the interview list and overview. Pure functions: user input only ever goes into
// `params` (placeholders), never into the SQL text. Easy to unit-test without a database.
import { addDays } from './dates.js';
import { escapeLike } from './lead-search-sql.js';
import { PAYMENT_CONFIRMED_SQL } from './payment-confirmed-sql.js';

const start = (date) => `${date} 00:00:00`;

// Interview-date conditions (scheduled_at is a wall-clock DATETIME; ranges keep the index usable).
function dateConditions(filters, column) {
  const where = []; const params = [];
  if (filters.when === 'today') { where.push(`${column} >= ? AND ${column} < ?`); params.push(start(filters.today), start(addDays(filters.today, 1))); }
  else if (filters.when === 'upcoming') { where.push(`${column} >= ?`); params.push(start(addDays(filters.today, 1))); }
  else if (filters.when === 'needs_update') { where.push(`${column} < ? AND i.attendance = 'pending'`); params.push(start(filters.today)); }
  if (filters.scheduledFrom) { where.push(`${column} >= ?`); params.push(start(filters.scheduledFrom)); }
  if (filters.scheduledTo) { where.push(`${column} < ?`); params.push(start(addDays(filters.scheduledTo, 1))); }
  return { where, params };
}

// scopeUserId: a number restricts to that BDE (always set for BDE callers); null = team-wide (admin).
export function buildInterviewSearch({ scopeUserId, filters }) {
  const where = []; const params = [];

  if (scopeUserId !== null && scopeUserId !== undefined) { where.push('i.user_id = ?'); params.push(scopeUserId); }
  else if (filters.bdeId) { where.push('i.user_id = ?'); params.push(filters.bdeId); }
  if (filters.leadId) { where.push('i.lead_id = ?'); params.push(filters.leadId); }

  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    where.push("(l.candidate_name LIKE ? ESCAPE '!' OR l.phone LIKE ? ESCAPE '!' OR l.email LIKE ? ESCAPE '!' OR l.course_or_internship LIKE ? ESCAPE '!')");
    params.push(like, like, like, like);
  }
  if (filters.attendance) { where.push('i.attendance = ?'); params.push(filters.attendance); }
  if (filters.outcome) { where.push('i.outcome = ?'); params.push(filters.outcome); }
  if (filters.interested === 'yes') where.push('i.interested_in_joining = 1');
  else if (filters.interested === 'no') where.push('i.interested_in_joining = 0');
  else if (filters.interested === 'unknown') where.push('i.interested_in_joining IS NULL');
  // Derived from payment records (Phase 6), not from the legacy stored column.
  if (filters.paymentConfirmed === 'yes') where.push(PAYMENT_CONFIRMED_SQL);
  else if (filters.paymentConfirmed === 'no') where.push(`NOT ${PAYMENT_CONFIRMED_SQL}`);

  const d = dateConditions(filters, 'i.scheduled_at');
  where.push(...d.where); params.push(...d.params);

  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// Date range used inside the LEFT JOIN ON clause of the admin overview (so BDEs with no interviews still appear).
export function buildOverviewRange({ scheduledFrom, scheduledTo }) {
  const d = dateConditions({ scheduledFrom, scheduledTo }, 'i.scheduled_at');
  return { onSql: d.where.map((w) => ` AND ${w}`).join(''), params: d.params };
}
