import { monthlyCallingByUser } from '../../lib/monthly-calls.js';

// Read-only month aggregation + the one write (upsert of a target). Interviews, payments, leads and revenue are aggregated in their OWN
// grouped sub-queries and joined per BDE, so no figure is multiplied by another (same approach as the payments overview). Calls are merged
// from the call log and the manual reports in JavaScript (lib/monthly-calls.js). Parameterized.
// NOT run against a real MySQL in the authoring sandbox (no database available).
export function createMonthlyReportRepository(db) {
  return {
    async findBde(id) {
      const rows = await db.query("SELECT id, employee_id, name, is_active FROM users WHERE id = ? AND role = 'bde' LIMIT 1", [id]);
      return rows[0] || null;
    },

    // One row per BDE (or just scopeUserId). Inactive BDEs are listed only when they have data or a target in that month.
    // CALLING FIGURES are NOT summed in SQL from daily_reports any more: that would add a manual report to the same day's Call-desk
    // calls. They come from monthlyCallingByUser() (lib/monthly-calls.js), which picks ONE source per BDE per day. The same rows feed the
    // team report, My Month, target progress and both exports, so they cannot disagree.
    async monthlyRows(m, scopeUserId) {
      const hasScope = scopeUserId !== null && scopeUserId !== undefined;
      const scope = hasScope ? ' AND u.id = ?' : '';
      // Targets are per whole month. A range report sets targetMonthStart to null, so the join matches no target row.
      const targetMonth = m.targetMonthStart === undefined ? m.start : m.targetMonthStart;
      const params = [m.startTs, m.endTs, m.startTs, m.endTs, m.start, m.endExclusive, m.start, m.endExclusive, targetMonth];
      if (hasScope) params.push(scopeUserId);
      params.push(m.start, m.endExclusive, m.start, m.endExclusive);
      const rows = await db.query(
        `SELECT u.id, u.employee_id, u.name, u.is_active,
                l.leads_created,
                iv.interviews_scheduled, iv.interviews_attended, iv.interviews_no_show, iv.interviews_selected,
                c.commitments, c.committed,
                r.received,
                t.target_calls, t.target_interested, t.target_interviews, t.target_revenue
           FROM users u
           LEFT JOIN (SELECT user_id, COUNT(*) AS leads_created FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY user_id) l ON l.user_id = u.id
           LEFT JOIN (SELECT user_id, COUNT(*) AS interviews_scheduled, SUM(attendance = 'attended') AS interviews_attended,
                             SUM(attendance = 'did_not_attend') AS interviews_no_show, SUM(outcome = 'selected') AS interviews_selected
                        FROM interviews WHERE scheduled_at >= ? AND scheduled_at < ? GROUP BY user_id) iv ON iv.user_id = u.id
           LEFT JOIN (SELECT user_id, COUNT(*) AS commitments, SUM(amount_committed) AS committed
                        FROM payments WHERE commitment_date >= ? AND commitment_date < ? GROUP BY user_id) c ON c.user_id = u.id
           LEFT JOIN (SELECT user_id, SUM(amount) AS received FROM payment_instalments WHERE paid_on >= ? AND paid_on < ? GROUP BY user_id) r ON r.user_id = u.id
           LEFT JOIN monthly_targets t ON t.user_id = u.id AND t.month_start = ?
          WHERE u.role = 'bde'${scope}
            AND (u.is_active = 1 OR l.user_id IS NOT NULL OR iv.user_id IS NOT NULL OR c.user_id IS NOT NULL OR r.user_id IS NOT NULL OR t.user_id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM daily_reports dr WHERE dr.user_id = u.id AND dr.report_date >= ? AND dr.report_date < ?)
                 OR EXISTS (SELECT 1 FROM call_logs cl WHERE cl.user_id = u.id AND cl.voided_at IS NULL AND cl.call_date >= ? AND cl.call_date < ?))
          ORDER BY u.name ASC, u.id ASC`, params);

      // The two calling sources for the same month and the same BDEs. Plain selects, merged by the pure function.
      const callParams = [m.start, m.endExclusive];
      if (hasScope) callParams.push(scopeUserId);
      const userFilter = hasScope ? ' AND user_id = ?' : '';
      const manualDays = await db.query(
        `SELECT user_id, report_date, total_calls, interested, not_interested, follow_up_required, no_response
           FROM daily_reports WHERE report_date >= ? AND report_date < ?${userFilter}`, callParams);
      const events = await db.query(
        `SELECT id, user_id, lead_id, outcome, call_date, called_at
           FROM call_logs WHERE call_date >= ? AND call_date < ? AND voided_at IS NULL${userFilter}`, callParams);
      const calling = monthlyCallingByUser({ month: m, manualDays, events });
      return rows.map((row) => ({ ...row, ...(calling.get(String(row.id)) || {}) }));
    },

    async upsertTarget({ userId, monthStart, targets, setBy }) {
      await db.query(
        `INSERT INTO monthly_targets (user_id, month_start, target_calls, target_interested, target_interviews, target_revenue, set_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE target_calls = VALUES(target_calls), target_interested = VALUES(target_interested), target_interviews = VALUES(target_interviews),
                                 target_revenue = VALUES(target_revenue), set_by = VALUES(set_by), updated_at = UTC_TIMESTAMP()`,
        [userId, monthStart, targets.targetCalls, targets.targetInterested, targets.targetInterviews, targets.targetRevenue, setBy]);
    }
  };
}
