// SQL for the admin lead sheet. NOT run against a real MySQL/TiDB in the authoring sandbox; checked by tests that record SQL text and parameters.
export const SHEET_MAX_LEADS = 5000;
const CHUNK = 500;

export function createLeadSheetRepository(db) {
  return {
    async listStatuses() {
      return db.query('SELECT id, name, sort_order, closes_follow_up, is_active FROM lead_statuses WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
    },
    async findBde(id) {
      const rows = await db.query("SELECT id, employee_id, name FROM users WHERE id = ? AND role = 'bde' LIMIT 1", [id]);
      return rows[0] || null;
    },
    // bdeId null = every BDE. Capped; the caller tells the admin when the cap was hit.
    async listForSheet(bdeId) {
      const where = bdeId ? ' WHERE l.user_id = ?' : '';
      return db.query(
        `SELECT l.id, l.candidate_name, l.phone, l.course_or_internship, u.employee_id, u.name AS bde_name, s.name AS status_name,
                l.follow_up_date, l.next_action, l.updated_at
           FROM leads l JOIN users u ON u.id = l.user_id JOIN lead_statuses s ON s.id = l.lead_status_id${where}
          ORDER BY u.name ASC, l.id ASC LIMIT ${SHEET_MAX_LEADS + 1}`, bdeId ? [bdeId] : []);
    },
    async findLeads(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        out.push(...await db.query(
          `SELECT l.id, l.user_id, l.candidate_name, l.lead_status_id, s.name AS status_name, l.follow_up_date, l.next_action, l.updated_at
             FROM leads l JOIN lead_statuses s ON s.id = l.lead_status_id WHERE l.id IN (${part.map(() => '?').join(', ')})`, part));
      }
      return out;
    },
    // true when the row still had the version the sheet was made from (updated_at), false when it changed meanwhile.
    async applyUpdate({ id, leadStatusId, followUpDate, nextAction, expectedUpdatedAt }) {
      const r = await db.query(
        'UPDATE leads SET lead_status_id = ?, follow_up_date = ?, next_action = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND updated_at = ?',
        [leadStatusId, followUpDate, nextAction, id, expectedUpdatedAt]);
      return Number(r.affectedRows) === 1;
    }
  };
}
