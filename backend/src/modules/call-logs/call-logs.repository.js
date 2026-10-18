const toLog = (r) => ({
  id: String(r.id), leadId: String(r.lead_id), outcome: r.outcome, callDate: r.call_date, calledAt: r.called_at, voidedAt: r.voided_at || null
});
const COLUMNS = 'id, user_id, lead_id, outcome, call_date, called_at, client_request_id, voided_at';

export function createCallLogRepository(db) {
  return {
    toLog,
    // Ownership is enforced in SQL too: a BDE can only find their own lead.
    async findOwnLead(leadId, userId) {
      const rows = await db.query('SELECT id, lead_status_id, follow_up_date FROM leads WHERE id = ? AND user_id = ? LIMIT 1', [leadId, userId]);
      return rows[0] || null;
    },
    async findStatusIdByName(name) {
      const rows = await db.query('SELECT id FROM lead_statuses WHERE name = ? AND is_active = 1 LIMIT 1', [name]);
      return rows[0] ? rows[0].id : null;
    },
    async findByRequestId(userId, clientRequestId) {
      const rows = await db.query(`SELECT ${COLUMNS} FROM call_logs WHERE user_id = ? AND client_request_id = ? LIMIT 1`, [userId, clientRequestId]);
      return rows[0] || null;
    },
    async findOwn(id, userId) {
      const rows = await db.query(`SELECT ${COLUMNS} FROM call_logs WHERE id = ? AND user_id = ? LIMIT 1`, [id, userId]);
      return rows[0] || null;
    },
    // The call and the lead's new status are written together or not at all. The id of the new row is returned.
    // The lead row is updated FIRST on purpose: it takes the row lock up front, so several copies of the same click queue on that one
    // lock instead of each holding a shared lock (from the foreign-key check) and then waiting to upgrade it, which InnoDB reports as a
    // deadlock. The losers then hit the unique key, roll back, and the service answers with the original call.
    async insertWithLeadUpdate({ userId, leadId, outcome, callDate, calledAt, clientRequestId, statusId, followUpDate }) {
      return db.transaction(async (tx) => {
        if (statusId !== null && statusId !== undefined) {
          await tx.query(
            `UPDATE leads SET lead_status_id = ?, follow_up_date = COALESCE(?, follow_up_date), updated_at = UTC_TIMESTAMP()
              WHERE id = ? AND user_id = ?`,
            [statusId, followUpDate, leadId, userId]
          );
        }
        const res = await tx.query(
          `INSERT INTO call_logs (user_id, lead_id, outcome, call_date, called_at, client_request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
          [userId, leadId, outcome, callDate, calledAt, clientRequestId]
        );
        return res.insertId;
      });
    },
    async markVoided(id, userId, voidedAt) {
      const res = await db.query('UPDATE call_logs SET voided_at = ? WHERE id = ? AND user_id = ? AND voided_at IS NULL', [voidedAt, id, userId]);
      return res.affectedRows;
    },
    // Non-voided calls of one BDE on one day, with the candidate name (for the "today" list and for the statistics).
    async eventsForUserDate(userId, callDate) {
      return db.query(
        `SELECT c.id, c.user_id, c.lead_id, c.outcome, c.called_at, l.candidate_name
           FROM call_logs c JOIN leads l ON l.id = c.lead_id
          WHERE c.user_id = ? AND c.call_date = ? AND c.voided_at IS NULL
          ORDER BY c.called_at ASC, c.id ASC`,
        [userId, callDate]
      );
    },
    // Non-voided calls of the whole team on one day. At most a few thousand rows for 30 BDEs; summarised in the service.
    async eventsForDate(callDate) {
      return db.query(
        `SELECT id, user_id, lead_id, outcome, called_at FROM call_logs
          WHERE call_date = ? AND voided_at IS NULL ORDER BY called_at ASC, id ASC`,
        [callDate]
      );
    }
  };
}
