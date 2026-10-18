// Builds the WHERE clause for the lead list. Pure function: user input only ever goes into `params`
// (placeholders), never into the SQL text. Easy to unit-test without a database.
import { addDays } from './dates.js';
import { UPCOMING_DAYS } from './lead-query.js';

// LIKE wildcards typed by the user are treated as plain text. '!' is the escape character.
export const escapeLike = (text) => text.replace(/[!%_]/g, '!$&');

// scopeUserId: a number restricts to that BDE (always set for BDE callers); null = team-wide (admin).
export function buildLeadSearch({ scopeUserId, filters, upcomingDays = UPCOMING_DAYS }) {
  const where = [];
  const params = [];

  if (scopeUserId !== null && scopeUserId !== undefined) { where.push('l.user_id = ?'); params.push(scopeUserId); }
  else if (filters.bdeId) { where.push('l.user_id = ?'); params.push(filters.bdeId); }

  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    where.push("(l.candidate_name LIKE ? ESCAPE '!' OR l.phone LIKE ? ESCAPE '!' OR l.email LIKE ? ESCAPE '!' OR l.course_or_internship LIKE ? ESCAPE '!')");
    params.push(like, like, like, like);
  }
  if (filters.statusId) { where.push('l.lead_status_id = ?'); params.push(filters.statusId); }

  // Statuses flagged closes_follow_up = 1 are not counted as overdue / today / upcoming.
  if (filters.followUp === 'overdue') { where.push('l.follow_up_date < ? AND s.closes_follow_up = 0'); params.push(filters.today); }
  else if (filters.followUp === 'today') { where.push('l.follow_up_date = ? AND s.closes_follow_up = 0'); params.push(filters.today); }
  else if (filters.followUp === 'upcoming') {
    where.push('l.follow_up_date > ? AND l.follow_up_date <= ? AND s.closes_follow_up = 0');
    params.push(filters.today, addDays(filters.today, upcomingDays));
  } else if (filters.followUp === 'none') where.push('l.follow_up_date IS NULL');

  if (filters.followUpFrom) { where.push('l.follow_up_date >= ?'); params.push(filters.followUpFrom); }
  if (filters.followUpTo) { where.push('l.follow_up_date <= ?'); params.push(filters.followUpTo); }

  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}
