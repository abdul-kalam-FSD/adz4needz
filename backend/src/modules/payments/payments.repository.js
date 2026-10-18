import { formatMoney, fromDecimalString } from '../../lib/money.js';
import { PAID_JOIN, buildPaymentSearch, buildRangeFilters, STATUS_SQL } from '../../lib/payment-search-sql.js';

const SELECT_PAYMENT = `
  SELECT p.id, p.lead_id, p.user_id, u.employee_id AS bde_employee_id, u.name AS bde_name,
         l.candidate_name, l.phone, l.email, l.course_or_internship AS lead_course,
         p.course_or_internship, p.amount_committed, p.commitment_date,
         COALESCE(ip.paid_amount, 0) AS paid_amount, COALESCE(ip.instalment_count, 0) AS instalment_count,
         (SELECT COUNT(*) FROM payment_receipts r JOIN payment_instalments x ON x.id = r.instalment_id WHERE x.payment_id = p.id) AS receipt_count,
         p.created_at, p.updated_at
    FROM payments p
    JOIN leads l ON l.id = p.lead_id
    JOIN users u ON u.id = p.user_id
    ${PAID_JOIN}`;

const money = (paise) => formatMoney(paise); // DECIMAL parameter as an exact string

export function createPaymentRepository(db) {
  return {
    // The lead must exist AND belong to this BDE. Same answer for "missing" and "someone else's".
    async findOwnLead(leadId, userId) {
      const rows = await db.query('SELECT id, user_id FROM leads WHERE id = ? AND user_id = ? LIMIT 1', [leadId, userId]);
      return rows[0] || null;
    },

    async insertPayment(leadId, userId, v) {
      const r = await db.query(
        `INSERT INTO payments (lead_id, user_id, course_or_internship, amount_committed, commitment_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [leadId, userId, v.courseOrInternship, money(v.amountCommitted), v.commitmentDate]
      );
      return r.insertId;
    },

    // scopeUserId set => only that BDE's payment can be found (ownership enforced in SQL too).
    async findPaymentById(id, scopeUserId) {
      const rows = scopeUserId === null || scopeUserId === undefined
        ? await db.query(`${SELECT_PAYMENT} WHERE p.id = ? LIMIT 1`, [id])
        : await db.query(`${SELECT_PAYMENT} WHERE p.id = ? AND p.user_id = ? LIMIT 1`, [id, scopeUserId]);
      return rows[0] || null;
    },

    // Course, committed amount and date can change; the committed amount may not drop below what was already received.
    async updatePayment(id, userId, v) {
      return db.transaction(async (tx) => {
        const p = (await tx.query('SELECT id FROM payments WHERE id = ? AND user_id = ? FOR UPDATE', [id, userId]))[0];
        if (!p) return { ok: false, reason: 'NOT_FOUND' };
        const paid = fromDecimalString((await tx.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_instalments WHERE payment_id = ?', [id]))[0].paid);
        if (v.amountCommitted < paid) return { ok: false, reason: 'BELOW_PAID', paid };
        await tx.query('UPDATE payments SET course_or_internship = ?, amount_committed = ?, commitment_date = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?',
          [v.courseOrInternship, money(v.amountCommitted), v.commitmentDate, id, userId]);
        return { ok: true };
      });
    },

    // Instalments with their receipts (metadata only; never the stored file name).
    async listInstalments(paymentId) {
      return db.query(
        `SELECT i.id AS instalment_id, i.amount, i.paid_on, i.created_at AS instalment_created_at,
                r.id AS receipt_id, r.original_name, r.mime_type, r.size_bytes, r.uploaded_at,
                r.review_status, r.review_note, r.reviewed_at, rv.name AS reviewer_name, rv.employee_id AS reviewer_employee_id
           FROM payment_instalments i
           LEFT JOIN payment_receipts r ON r.instalment_id = i.id
           LEFT JOIN users rv ON rv.id = r.reviewed_by
          WHERE i.payment_id = ?
          ORDER BY i.paid_on ASC, i.id ASC, r.id ASC`, [paymentId]);
    },

    async findInstalment(id, scopeUserId) {
      const sql = 'SELECT id, payment_id, user_id, amount, paid_on FROM payment_instalments WHERE id = ?';
      const rows = scopeUserId === null || scopeUserId === undefined
        ? await db.query(`${sql} LIMIT 1`, [id])
        : await db.query(`${sql} AND user_id = ? LIMIT 1`, [id, scopeUserId]);
      return rows[0] || null;
    },

    // Atomic: lock the payment row, then check duplicate and the commitment cap against the CURRENT total, then insert.
    // Two simultaneous requests therefore cannot both pass the check and push the total above the commitment.
    async addInstalment({ paymentId, userId, amount, paidOn, confirmDuplicate }) {
      return db.transaction(async (tx) => {
        const p = (await tx.query('SELECT id, amount_committed FROM payments WHERE id = ? AND user_id = ? FOR UPDATE', [paymentId, userId]))[0];
        if (!p) return { ok: false, reason: 'NOT_FOUND' };
        if (!confirmDuplicate) {
          const dup = await tx.query('SELECT id FROM payment_instalments WHERE payment_id = ? AND amount = ? AND paid_on = ? LIMIT 1', [paymentId, money(amount), paidOn]);
          if (dup[0]) return { ok: false, reason: 'DUPLICATE', existingId: dup[0].id };
        }
        const paid = fromDecimalString((await tx.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_instalments WHERE payment_id = ?', [paymentId]))[0].paid);
        const outstanding = fromDecimalString(p.amount_committed) - paid;
        if (amount > outstanding) return { ok: false, reason: 'OVER', outstanding };
        const r = await tx.query('INSERT INTO payment_instalments (payment_id, user_id, amount, paid_on, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
          [paymentId, userId, money(amount), paidOn]);
        return { ok: true, id: r.insertId };
      });
    },

    async updateInstalment({ id, userId, amount, paidOn, confirmDuplicate }) {
      return db.transaction(async (tx) => {
        const inst = (await tx.query('SELECT id, payment_id FROM payment_instalments WHERE id = ? AND user_id = ?', [id, userId]))[0];
        if (!inst) return { ok: false, reason: 'NOT_FOUND' };
        const p = (await tx.query('SELECT id, amount_committed FROM payments WHERE id = ? AND user_id = ? FOR UPDATE', [inst.payment_id, userId]))[0];
        if (!p) return { ok: false, reason: 'NOT_FOUND' };
        if (!confirmDuplicate) {
          const dup = await tx.query('SELECT id FROM payment_instalments WHERE payment_id = ? AND amount = ? AND paid_on = ? AND id <> ? LIMIT 1', [inst.payment_id, money(amount), paidOn, id]);
          if (dup[0]) return { ok: false, reason: 'DUPLICATE', existingId: dup[0].id };
        }
        const others = fromDecimalString((await tx.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payment_instalments WHERE payment_id = ? AND id <> ?', [inst.payment_id, id]))[0].paid);
        const outstanding = fromDecimalString(p.amount_committed) - others;
        if (amount > outstanding) return { ok: false, reason: 'OVER', outstanding };
        await tx.query('UPDATE payment_instalments SET amount = ?, paid_on = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?', [money(amount), paidOn, id, userId]);
        return { ok: true, paymentId: inst.payment_id };
      });
    },

    async countReceipts(instalmentId) {
      return Number((await db.query('SELECT COUNT(*) AS n FROM payment_receipts WHERE instalment_id = ?', [instalmentId]))[0].n);
    },
    async findReceiptsByHash(sha256) {
      return db.query('SELECT id, user_id, instalment_id FROM payment_receipts WHERE sha256 = ? ORDER BY id ASC LIMIT 20', [sha256]);
    },
    async insertReceipt(r) {
      const res = await db.query(
        `INSERT INTO payment_receipts (instalment_id, user_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [r.instalmentId, r.userId, r.originalName, r.storedName, r.mimeType, r.sizeBytes, r.sha256]);
      return res.insertId;
    },
    // Admin review of one proof. Returns false when the receipt does not exist.
    async reviewReceipt({ id, decision, note, reviewerId }) {
      const r = await db.query(
        'UPDATE payment_receipts SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?',
        [decision, note, reviewerId, id]);
      return r.affectedRows > 0;
    },
    // How many of ONE BDE's proofs are in each review state (BDE dashboard).
    async proofCounts(userId) {
      const rows = await db.query('SELECT review_status, COUNT(*) AS n FROM payment_receipts WHERE user_id = ? GROUP BY review_status', [userId]);
      const out = { pending: 0, approved: 0, rejected: 0 };
      for (const r of rows) out[r.review_status] = Number(r.n);
      return out;
    },
    async findReceiptReview(id) {
      const rows = await db.query(
        `SELECT r.id, r.review_status, r.review_note, r.reviewed_at, rv.name AS reviewer_name, rv.employee_id AS reviewer_employee_id
           FROM payment_receipts r LEFT JOIN users rv ON rv.id = r.reviewed_by WHERE r.id = ? LIMIT 1`, [id]);
      return rows[0] || null;
    },

    async findReceipt(id, scopeUserId) {
      const sql = 'SELECT id, user_id, instalment_id, original_name, stored_name, mime_type, size_bytes, uploaded_at FROM payment_receipts WHERE id = ?';
      const rows = scopeUserId === null || scopeUserId === undefined
        ? await db.query(`${sql} LIMIT 1`, [id])
        : await db.query(`${sql} AND user_id = ? LIMIT 1`, [id, scopeUserId]);
      return rows[0] || null;
    },

    async search({ scopeUserId, filters }) {
      const { whereSql, params } = buildPaymentSearch({ scopeUserId, filters });
      const from = ` FROM payments p JOIN leads l ON l.id = p.lead_id JOIN users u ON u.id = p.user_id ${PAID_JOIN} `;
      const countRows = await db.query(`SELECT COUNT(*) AS total${from}${whereSql}`, params);
      const limit = Math.min(Math.max(Math.trunc(filters.pageSize), 1), 100); // validated integers, safe to inline
      const offset = (Math.max(Math.trunc(filters.page), 1) - 1) * limit;
      const rows = await db.query(`${SELECT_PAYMENT} ${whereSql} ORDER BY p.commitment_date DESC, p.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
      return { rows, total: Number(countRows[0].total) };
    },

    // One row per BDE (admin overview), or just one BDE when scopeUserId is set (BDE summary).
    // Commitments and money received are aggregated in SEPARATE grouped sub-queries and then joined per BDE, so neither
    // is multiplied by the other (no double counting). Commitments are placed by commitment_date, money by paid_on.
    async overview({ range, scopeUserId }) {
      const f = buildRangeFilters(range);
      const params = [...f.commit.params, ...f.paid.params];
      let scopeSql = '';
      if (scopeUserId !== null && scopeUserId !== undefined) { scopeSql = ' AND u.id = ?'; params.push(scopeUserId); }
      return db.query(
        `SELECT u.id, u.employee_id, u.name, u.is_active,
                COALESCE(c.payments, 0) AS payments, COALESCE(c.committed, 0) AS committed, COALESCE(c.paid_toward, 0) AS paid_toward,
                COALESCE(c.pending, 0) AS pending, COALESCE(c.partially_paid, 0) AS partially_paid, COALESCE(c.paid_count, 0) AS paid_count,
                COALESCE(c.paid_committed, 0) AS paid_committed,
                COALESCE(r.instalments, 0) AS instalments, COALESCE(r.received, 0) AS received
           FROM users u
           LEFT JOIN (
             SELECT p.user_id, COUNT(*) AS payments, SUM(p.amount_committed) AS committed, SUM(COALESCE(ip.paid_amount, 0)) AS paid_toward,
                    SUM(${STATUS_SQL} = 'pending') AS pending, SUM(${STATUS_SQL} = 'partially_paid') AS partially_paid,
                    SUM(${STATUS_SQL} = 'paid') AS paid_count,
                    SUM(CASE WHEN ${STATUS_SQL} = 'paid' THEN p.amount_committed ELSE 0 END) AS paid_committed
               FROM payments p ${PAID_JOIN}
              WHERE 1 = 1${f.commit.sql}
              GROUP BY p.user_id) c ON c.user_id = u.id
           LEFT JOIN (
             SELECT i.user_id, COUNT(*) AS instalments, SUM(i.amount) AS received
               FROM payment_instalments i
              WHERE 1 = 1${f.paid.sql}
              GROUP BY i.user_id) r ON r.user_id = u.id
          WHERE u.role = 'bde'${scopeSql} AND (u.is_active = 1 OR COALESCE(c.payments, 0) > 0 OR COALESCE(r.instalments, 0) > 0)
          ORDER BY u.name ASC, u.id ASC`, params);
    }
  };
}
