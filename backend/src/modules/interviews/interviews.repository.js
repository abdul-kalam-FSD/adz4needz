import { addDays } from '../../lib/dates.js';
import { buildInterviewSearch, buildOverviewRange } from '../../lib/interview-search-sql.js';
import { PAYMENT_CONFIRMED_SQL } from '../../lib/payment-confirmed-sql.js';

const SELECT_INTERVIEW = `
  SELECT i.id, i.lead_id, i.user_id, u.employee_id AS bde_employee_id, u.name AS bde_name,
         l.candidate_name, l.phone, l.email, l.course_or_internship,
         i.scheduled_at, i.attendance, i.outcome, i.interested_in_joining, (${PAYMENT_CONFIRMED_SQL}) AS payment_confirmed,
         i.created_at, i.updated_at
    FROM interviews i
    JOIN leads l ON l.id = i.lead_id
    JOIN users u ON u.id = i.user_id`;

export function createInterviewRepository(db) {
  return {
    // The lead must exist AND belong to this BDE. Same answer for "missing" and "someone else's".
    async findOwnLead(leadId, userId) {
      const rows = await db.query('SELECT id, user_id FROM leads WHERE id = ? AND user_id = ? LIMIT 1', [leadId, userId]);
      return rows[0] || null;
    },

    async insert(leadId, userId, v) {
      const result = await db.query(
        `INSERT INTO interviews (lead_id, user_id, scheduled_at, attendance, outcome, interested_in_joining, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [leadId, userId, v.scheduledAt, v.attendance, v.outcome, v.interestedInJoining === null ? null : (v.interestedInJoining ? 1 : 0)]
      );
      return result.insertId;
    },

    // scopeUserId set => only that BDE's interview can be found (ownership enforced in SQL too).
    async findById(id, scopeUserId) {
      const rows = scopeUserId === null || scopeUserId === undefined
        ? await db.query(`${SELECT_INTERVIEW} WHERE i.id = ? LIMIT 1`, [id])
        : await db.query(`${SELECT_INTERVIEW} WHERE i.id = ? AND i.user_id = ? LIMIT 1`, [id, scopeUserId]);
      return rows[0] || null;
    },

    async update(id, userId, v) {
      await db.query(
        `UPDATE interviews SET scheduled_at = ?, attendance = ?, outcome = ?, interested_in_joining = ?, updated_at = UTC_TIMESTAMP()
          WHERE id = ? AND user_id = ?`,
        [v.scheduledAt, v.attendance, v.outcome, v.interestedInJoining === null ? null : (v.interestedInJoining ? 1 : 0), id, userId]
      );
    },

    async search({ scopeUserId, filters }) {
      const { whereSql, params } = buildInterviewSearch({ scopeUserId, filters });
      const from = ' FROM interviews i JOIN leads l ON l.id = i.lead_id JOIN users u ON u.id = i.user_id ';
      const countRows = await db.query(`SELECT COUNT(*) AS total${from}${whereSql}`, params);
      const limit = Math.min(Math.max(Math.trunc(filters.pageSize), 1), 100); // validated integers, safe to inline
      const offset = (Math.max(Math.trunc(filters.page), 1) - 1) * limit;
      const rows = await db.query(`${SELECT_INTERVIEW} ${whereSql} ORDER BY i.scheduled_at DESC, i.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
      return { rows, total: Number(countRows[0].total) };
    },

    async summary({ scopeUserId, today }) {
      const params = [`${today} 00:00:00`, `${addDays(today, 1)} 00:00:00`, `${addDays(today, 1)} 00:00:00`, `${today} 00:00:00`];
      let sql = `SELECT SUM(i.scheduled_at >= ? AND i.scheduled_at < ?) AS due_today,
                        SUM(i.scheduled_at >= ?) AS upcoming,
                        SUM(i.scheduled_at < ? AND i.attendance = 'pending') AS needs_update
                   FROM interviews i`;
      if (scopeUserId !== null && scopeUserId !== undefined) { sql += ' WHERE i.user_id = ?'; params.push(scopeUserId); }
      const r = (await db.query(sql, params))[0] || {};
      return { today: Number(r.due_today || 0), upcoming: Number(r.upcoming || 0), needsUpdate: Number(r.needs_update || 0) };
    },

    // One row per BDE (admin overview). BDEs without interviews get zeros. Inactive BDEs appear only if they have interviews in range.
    async overview({ scheduledFrom, scheduledTo }) {
      const range = buildOverviewRange({ scheduledFrom, scheduledTo });
      return db.query(
        `SELECT u.id, u.employee_id, u.name, u.is_active,
                COUNT(i.id) AS scheduled,
                COALESCE(SUM(i.attendance = 'attended'), 0) AS attended,
                COALESCE(SUM(i.attendance = 'did_not_attend'), 0) AS did_not_attend,
                COALESCE(SUM(i.attendance = 'pending'), 0) AS attendance_pending,
                COALESCE(SUM(i.outcome = 'selected'), 0) AS selected,
                COALESCE(SUM(i.outcome = 'not_selected'), 0) AS not_selected,
                COALESCE(SUM(i.interested_in_joining = 1), 0) AS interested_in_joining,
                COALESCE(SUM(CASE WHEN ${PAYMENT_CONFIRMED_SQL} THEN 1 ELSE 0 END), 0) AS payment_confirmed
           FROM users u
           LEFT JOIN interviews i ON i.user_id = u.id${range.onSql}
          WHERE u.role = 'bde'
          GROUP BY u.id, u.employee_id, u.name, u.is_active
         HAVING u.is_active = 1 OR COUNT(i.id) > 0
          ORDER BY u.name ASC, u.id ASC`,
        range.params
      );
    }
  };
}
