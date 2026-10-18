// SQL for "Assign leads". NOT run against a real MySQL/TiDB in the authoring sandbox (none was reachable): the statements are checked by
// tests that record the SQL text and parameters, not by a database. Only validated integers are placed into SQL text (the LIMIT and the
// IN (?, ?, ...) placeholders); every value is a parameter.
//
// A lead is REASSIGNABLE only while nothing hangs off it: no call-log row (voided ones included), no interview, no payment. The database
// itself enforces the same rule (interviews, payments and call_logs reference (lead_id, user_id) with no ON UPDATE CASCADE, so moving a lead
// that has any of them is refused), and the UPDATE below repeats the rule so a refusal is a clean "nothing moved" instead of a constraint error.
const NO_CHILDREN = `NOT EXISTS (SELECT 1 FROM call_logs c WHERE c.lead_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM interviews i WHERE i.lead_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.lead_id = l.id)`;

const safeInt = (n, max) => { if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('internal: bad integer'); return n; };

export function createAssignmentRepository(db) {
  return {
    async findBde(id) {
      const rows = await db.query("SELECT id, employee_id, name, is_active FROM users WHERE id = ? AND role = 'bde' LIMIT 1", [id]);
      return rows[0] || null;
    },

    // One row per ACTIVE BDE. open = leads whose status does not close the follow-up; overdue = open leads with a follow-up date before
    // today (today comes from the admin's browser); reassignable = leads that could be moved right now (see NO_CHILDREN).
    async workload(today) {
      return db.query(
        `SELECT u.id, u.employee_id, u.name,
                COALESCE(o.open_leads, 0) AS open_leads, COALESCE(o.overdue, 0) AS overdue,
                COALESCE(r.reassignable, 0) AS reassignable, COALESCE(k.calls_today, 0) AS calls_today
           FROM users u
           LEFT JOIN (SELECT l.user_id, COUNT(*) AS open_leads, SUM(l.follow_up_date IS NOT NULL AND l.follow_up_date < ?) AS overdue
                        FROM leads l JOIN lead_statuses s ON s.id = l.lead_status_id WHERE s.closes_follow_up = 0 GROUP BY l.user_id) o ON o.user_id = u.id
           LEFT JOIN (SELECT l.user_id, COUNT(*) AS reassignable FROM leads l WHERE ${NO_CHILDREN} GROUP BY l.user_id) r ON r.user_id = u.id
           LEFT JOIN (SELECT user_id, COUNT(*) AS calls_today FROM call_logs WHERE call_date = ? AND voided_at IS NULL GROUP BY user_id) k ON k.user_id = u.id
          WHERE u.role = 'bde' AND u.is_active = 1
          ORDER BY u.name ASC, u.id ASC`, [today, today]);
    },

    // Oldest first, so the leads that have waited longest are handed over first.
    async reassignableIds(fromUserId, limit) {
      const n = safeInt(limit, 5000);
      const rows = await db.query(`SELECT l.id FROM leads l WHERE l.user_id = ? AND ${NO_CHILDREN} ORDER BY l.id ASC LIMIT ${n}`, [fromUserId]);
      return rows.map((r) => String(r.id));
    },

    // allocations: [{ toUserId, leadIds }]. ONE transaction: either every lead moves or none does. Each UPDATE repeats the owner and
    // no-children conditions; if any UPDATE moves fewer rows than expected (the lead was touched meanwhile) the whole move rolls back.
    async moveLeads({ fromUserId, allocations }) {
      return db.transaction(async (tx) => {
        let moved = 0;
        for (const a of allocations) {
          const ids = a.leadIds.map(String);
          safeInt(ids.length, 5000);
          const marks = ids.map(() => '?').join(', ');
          const r = await tx.query(
            `UPDATE leads l SET l.user_id = ?, l.updated_at = UTC_TIMESTAMP()
              WHERE l.user_id = ? AND l.id IN (${marks}) AND ${NO_CHILDREN}`, [a.toUserId, fromUserId, ...ids]);
          if (Number(r.affectedRows) !== ids.length) { const e = new Error('lead set changed'); e.code = 'LEADS_CHANGED'; throw e; }
          moved += ids.length;
        }
        return { moved };
      });
    }
  };
}
