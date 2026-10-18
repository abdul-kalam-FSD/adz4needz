const toReport = (r) => ({
  id: r.id,
  reportDate: r.report_date,
  totalCalls: r.total_calls,
  interested: r.interested,
  notInterested: r.not_interested,
  followUpRequired: r.follow_up_required,
  noResponse: r.no_response,
  createdAt: r.created_at
});

const COLUMNS = 'id, report_date, total_calls, interested, not_interested, follow_up_required, no_response, created_at';

export function createDailyReportRepository(db) {
  return {
    async insert(userId, v) {
      await db.query(
        `INSERT INTO daily_reports
           (user_id, report_date, total_calls, interested, not_interested, follow_up_required, no_response, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [userId, v.reportDate, v.totalCalls, v.interested, v.notInterested, v.followUpRequired, v.noResponse]
      );
    },
    async findByUserAndDate(userId, reportDate) {
      const rows = await db.query(
        `SELECT ${COLUMNS} FROM daily_reports WHERE user_id = ? AND report_date = ? LIMIT 1`,
        [userId, reportDate]
      );
      return rows[0] ? toReport(rows[0]) : null;
    },
    async listByUser(userId, limit) {
      const n = Math.min(Math.max(Math.trunc(Number(limit)) || 30, 1), 100); // validated integer, safe to inline
      const rows = await db.query(
        `SELECT ${COLUMNS} FROM daily_reports WHERE user_id = ? ORDER BY report_date DESC, id DESC LIMIT ${n}`,
        [userId]
      );
      return rows.map(toReport);
    }
  };
}
