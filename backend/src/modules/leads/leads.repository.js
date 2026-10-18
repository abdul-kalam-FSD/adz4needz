import { addDays } from '../../lib/dates.js';
import { buildLeadSearch } from '../../lib/lead-search-sql.js';
import { UPCOMING_DAYS } from '../../lib/lead-query.js';

const SELECT_LEAD = `
  SELECT l.id, l.user_id, u.employee_id AS bde_employee_id, u.name AS bde_name,
         l.candidate_name, l.phone, l.phone_key, l.email, l.email_key, l.course_or_internship,
         l.lead_status_id, s.name AS status_name, s.closes_follow_up,
         l.follow_up_date, l.next_action, l.created_at, l.updated_at
    FROM leads l
    JOIN lead_statuses s ON s.id = l.lead_status_id
    JOIN users u ON u.id = l.user_id`;

export function createLeadRepository(db) {
  return {
    async listStatuses() {
      return db.query('SELECT id, name, sort_order, closes_follow_up, is_active FROM lead_statuses WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
    },
    async findStatus(id) {
      const rows = await db.query('SELECT id, name, is_active FROM lead_statuses WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    },

    async insert(userId, v) {
      const result = await db.query(
        `INSERT INTO leads (user_id, candidate_name, phone, phone_key, email, email_key, course_or_internship,
                            lead_status_id, follow_up_date, next_action, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [userId, v.candidateName, v.phone, v.phoneKey, v.email, v.emailKey, v.courseOrInternship, v.leadStatusId, v.followUpDate, v.nextAction]
      );
      return result.insertId;
    },

    // scopeUserId set => only that BDE's lead can be found (ownership enforced in SQL too).
    async findById(id, scopeUserId) {
      const rows = scopeUserId === null || scopeUserId === undefined
        ? await db.query(`${SELECT_LEAD} WHERE l.id = ? LIMIT 1`, [id])
        : await db.query(`${SELECT_LEAD} WHERE l.id = ? AND l.user_id = ? LIMIT 1`, [id, scopeUserId]);
      return rows[0] || null;
    },

    async update(id, userId, v) {
      await db.query(
        `UPDATE leads SET candidate_name = ?, phone = ?, phone_key = ?, email = ?, email_key = ?, course_or_internship = ?,
                lead_status_id = ?, follow_up_date = ?, next_action = ?, updated_at = UTC_TIMESTAMP()
          WHERE id = ? AND user_id = ?`,
        [v.candidateName, v.phone, v.phoneKey, v.email, v.emailKey, v.courseOrInternship, v.leadStatusId, v.followUpDate, v.nextAction, id, userId]
      );
    },

    // Status only. The user_id condition repeats the ownership rule in SQL.
    async setStatus(id, userId, statusId) {
      await db.query('UPDATE leads SET lead_status_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?', [statusId, id, userId]);
    },

    // Same phone key or same email key, across ALL BDEs. The service decides what each caller may see.
    async findDuplicates({ phoneKey, emailKey, excludeId }) {
      const parts = []; const params = [];
      if (phoneKey) { parts.push('l.phone_key = ?'); params.push(phoneKey); }
      if (emailKey) { parts.push('l.email_key = ?'); params.push(emailKey); }
      if (!parts.length) return [];
      let sql = `SELECT l.id, l.user_id, l.candidate_name, l.phone, l.email, l.course_or_internship, s.name AS status_name, l.follow_up_date
                   FROM leads l JOIN lead_statuses s ON s.id = l.lead_status_id
                  WHERE (${parts.join(' OR ')})`;
      if (excludeId) { sql += ' AND l.id <> ?'; params.push(excludeId); }
      return db.query(sql + ' ORDER BY l.id ASC LIMIT 20', params);
    },

    async search({ scopeUserId, filters }) {
      const { whereSql, params } = buildLeadSearch({ scopeUserId, filters });
      const from = ' FROM leads l JOIN lead_statuses s ON s.id = l.lead_status_id JOIN users u ON u.id = l.user_id ';
      const countRows = await db.query(`SELECT COUNT(*) AS total${from}${whereSql}`, params);
      const limit = Math.min(Math.max(Math.trunc(filters.pageSize), 1), 100); // validated integers, safe to inline
      const offset = (Math.max(Math.trunc(filters.page), 1) - 1) * limit;
      const rows = await db.query(
        `${SELECT_LEAD} ${whereSql} ORDER BY (l.follow_up_date IS NULL), l.follow_up_date ASC, l.id DESC LIMIT ${limit} OFFSET ${offset}`,
        params
      );
      return { rows, total: Number(countRows[0].total) };
    },

    async followUpSummary({ scopeUserId, today }) {
      const params = [today, today, today, addDays(today, UPCOMING_DAYS)];
      let sql = `SELECT SUM(l.follow_up_date < ?) AS overdue, SUM(l.follow_up_date = ?) AS due_today,
                        SUM(l.follow_up_date > ? AND l.follow_up_date <= ?) AS upcoming
                   FROM leads l JOIN lead_statuses s ON s.id = l.lead_status_id
                  WHERE l.follow_up_date IS NOT NULL AND s.closes_follow_up = 0`;
      if (scopeUserId !== null && scopeUserId !== undefined) { sql += ' AND l.user_id = ?'; params.push(scopeUserId); }
      const rows = await db.query(sql, params);
      const r = rows[0] || {};
      return { overdue: Number(r.overdue || 0), today: Number(r.due_today || 0), upcoming: Number(r.upcoming || 0) };
    }
  };
}
