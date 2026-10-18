// Read-only queries for the admin screens. Nothing here changes data.
export function createAdminRepository(db) {
  return {
    async listBdes() {
      return db.query(
        "SELECT id, employee_id, name, is_active FROM users WHERE role = 'bde' ORDER BY name ASC, id ASC"
      );
    },
    async findBde(id) {
      const rows = await db.query(
        "SELECT id, employee_id, name, is_active FROM users WHERE id = ? AND role = 'bde' LIMIT 1",
        [id]
      );
      return rows[0] || null;
    },
    // One row per BDE for the chosen date. BDEs without a report get NULL numbers.
    // Inactive BDEs are shown only if they did submit a report for that date (their data is not hidden).
    async overviewForDate(reportDate) {
      return db.query(
        `SELECT u.id, u.employee_id, u.name, u.is_active,
                r.id AS report_id, r.total_calls, r.interested, r.not_interested,
                r.follow_up_required, r.no_response
           FROM users u
           LEFT JOIN daily_reports r ON r.user_id = u.id AND r.report_date = ?
          WHERE u.role = 'bde' AND (u.is_active = 1 OR r.id IS NOT NULL)
          ORDER BY u.name ASC, u.id ASC`,
        [reportDate]
      );
    }
  };
}
