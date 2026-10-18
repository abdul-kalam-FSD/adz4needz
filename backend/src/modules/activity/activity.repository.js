// Read-only. One small SELECT per kind of record that already exists (nothing is written, no table is added). The results are merged
// and sorted in JavaScript instead of with SQL UNION ALL on purpose: a UNION over columns of different tables risks "Illegal mix of collations"
// on MySQL 8, and this way no cross-table collation question ever arises.
// NOT run against a real MySQL/TiDB in the authoring sandbox: the SQL is checked by tests that record text and parameters only.
// Every query is bounded by the same [from, to) window (parameters) and the optional actor filter, and capped by the validated LIMIT.
const BRANCHES = [
  ["c.called_at", "'call'", 'c.user_id', 'l.candidate_name', 'c.outcome', 'call_logs c JOIN leads l ON l.id = c.lead_id', 'c.voided_at IS NULL AND c.called_at >= ? AND c.called_at < ?'],
  ["l.created_at", "'lead_added'", 'l.user_id', 'l.candidate_name', "''", 'leads l', 'l.created_at >= ? AND l.created_at < ?'],
  ["i.created_at", "'interview_scheduled'", 'i.user_id', 'l.candidate_name', "''", 'interviews i JOIN leads l ON l.id = i.lead_id', 'i.created_at >= ? AND i.created_at < ?'],
  ["p.created_at", "'payment_committed'", 'p.user_id', 'l.candidate_name', 'CAST(p.amount_committed AS CHAR)', 'payments p JOIN leads l ON l.id = p.lead_id', 'p.created_at >= ? AND p.created_at < ?'],
  ["n.created_at", "'instalment_recorded'", 'n.user_id', 'l.candidate_name', 'CAST(n.amount AS CHAR)', 'payment_instalments n JOIN payments p ON p.id = n.payment_id JOIN leads l ON l.id = p.lead_id', 'n.created_at >= ? AND n.created_at < ?'],
  ["r.uploaded_at", "'receipt_uploaded'", 'r.user_id', 'l.candidate_name', "''", 'payment_receipts r JOIN payment_instalments n ON n.id = r.instalment_id JOIN payments p ON p.id = n.payment_id JOIN leads l ON l.id = p.lead_id', 'r.uploaded_at >= ? AND r.uploaded_at < ?'],
  ["r.reviewed_at", "'receipt_reviewed'", 'r.reviewed_by', 'l.candidate_name', 'r.review_status', 'payment_receipts r JOIN payment_instalments n ON n.id = r.instalment_id JOIN payments p ON p.id = n.payment_id JOIN leads l ON l.id = p.lead_id', 'r.reviewed_at IS NOT NULL AND r.reviewed_at >= ? AND r.reviewed_at < ?'],
  ["b.committed_at", "'import_committed'", 'b.admin_user_id', 'b.file_name', 'CAST(COALESCE(b.inserted_rows, 0) AS CHAR)', 'lead_import_batches b', "b.status = 'committed' AND b.committed_at >= ? AND b.committed_at < ?"],
  ["u.created_at", "'account_created'", 'u.id', 'u.name', "''", 'users u', "u.role = 'bde' AND u.created_at >= ? AND u.created_at < ?"],
  ["d.created_at", "'daily_report'", 'd.user_id', 'CAST(d.report_date AS CHAR)', 'CAST(d.total_calls AS CHAR)', 'daily_reports d', 'd.created_at >= ? AND d.created_at < ?']
];
const KIND_OF = BRANCHES.map((b) => b[1].replace(/'/g, ''));

export function createActivityRepository(db) {
  return {
    // fromTs/toTs: 'YYYY-MM-DD HH:MM:SS' (UTC, end exclusive). kind: one allowed kind or null. actorId: user id text or null. limit: validated integer.
    // Returns the newest `limit` events across the chosen kinds, each with the actor's name, employee id and role.
    async feed({ fromTs, toTs, kind, actorId, limit }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('internal: bad limit');
      const wanted = kind ? BRANCHES.filter((b, i) => KIND_OF[i] === kind) : BRANCHES;
      const events = [];
      for (const b of wanted) {
        const actorSql = actorId ? ` AND ${b[2]} = ?` : '';
        const params = [fromTs, toTs]; if (actorId) params.push(actorId);
        const rows = await db.query(`SELECT ${b[0]} AS at, ${b[1]} AS kind, ${b[2]} AS actor_id, ${b[3]} AS subject, ${b[4]} AS extra FROM ${b[5]} WHERE ${b[6]}${actorSql} ORDER BY ${b[0]} DESC LIMIT ${limit}`, params);
        events.push(...rows);
      }
      events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
      const top = events.slice(0, limit);
      const ids = [...new Set(top.map((e) => String(e.actor_id)))];
      if (ids.length === 0) return [];
      const people = await db.query(`SELECT id, name, employee_id, role FROM users WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
      const by = new Map(people.map((u) => [String(u.id), u]));
      return top.map((e) => { const u = by.get(String(e.actor_id)) || {}; return { ...e, actor_name: u.name || 'Unknown', actor_employee_id: u.employee_id || '', actor_role: u.role || '' }; });
    }
  };
}
