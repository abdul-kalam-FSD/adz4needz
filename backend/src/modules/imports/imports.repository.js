// SQL for the admin lead import. Every statement is parameterized. NOT run against a real MySQL in the authoring sandbox
// (no database available): tests-integration/imports.db.test.js exists for that and has not been run yet.
const CHUNK = 400;
const chunks = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const marks = (n) => Array(n).fill('?').join(',');

export function createImportRepository(db) {
  return {
    async listActiveStatuses() {
      return db.query('SELECT id, name, sort_order FROM lead_statuses WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
    },
    async listActiveBdes() {
      return db.query("SELECT id, employee_id, name FROM users WHERE role = 'bde' AND is_active = 1 ORDER BY name ASC, id ASC");
    },

    async createBatch(b) {
      const r = await db.query(
        `INSERT INTO lead_import_batches (admin_user_id, file_name, file_format, status, headers_json, raw_rows_json, mapping_json,
                                          default_bde_id, default_course, include_existing_duplicates, created_at, updated_at)
         VALUES (?, ?, ?, 'preview', ?, ?, ?, ?, ?, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [b.adminUserId, b.fileName, b.format, JSON.stringify(b.headers), JSON.stringify(b.rows), JSON.stringify(b.mapping), b.defaultBdeId, b.defaultCourse]
      );
      return r.insertId;
    },
    async getBatch(id) {
      const rows = await db.query(
        `SELECT b.*, a.employee_id AS admin_employee_id, a.name AS admin_name, d.employee_id AS default_bde_employee_id, d.name AS default_bde_name
           FROM lead_import_batches b JOIN users a ON a.id = b.admin_user_id LEFT JOIN users d ON d.id = b.default_bde_id
          WHERE b.id = ? LIMIT 1`, [id]);
      return rows[0] || null;
    },
    async listBatches(limit = 30) {
      const n = Math.min(Math.max(Math.trunc(limit), 1), 100);
      return db.query(
        `SELECT b.id, b.file_name, b.file_format, b.status, b.total_rows, b.valid_rows, b.invalid_rows, b.duplicate_in_file_rows,
                b.duplicate_existing_rows, b.inserted_rows, b.skipped_rows, b.created_at, b.committed_at, a.employee_id AS admin_employee_id, a.name AS admin_name
           FROM lead_import_batches b JOIN users a ON a.id = b.admin_user_id ORDER BY b.id DESC LIMIT ${n}`);
    },
    // Only while still in preview.
    async updateSettings(id, { mapping, defaultBdeId, defaultCourse, includeExistingDuplicates }) {
      await db.query(
        `UPDATE lead_import_batches SET mapping_json = ?, default_bde_id = ?, default_course = ?, include_existing_duplicates = ?, updated_at = UTC_TIMESTAMP()
          WHERE id = ? AND status = 'preview'`,
        [JSON.stringify(mapping), defaultBdeId, defaultCourse, includeExistingDuplicates ? 1 : 0, id]);
    },

    // Replaces all staging rows and the counters in one transaction.
    async replaceRows(id, rows, counts) {
      await db.transaction(async (tx) => {
        await tx.query('DELETE FROM lead_import_rows WHERE batch_id = ?', [id]);
        for (const part of chunks(rows)) {
          const params = [];
          for (const r of part) params.push(id, r.rowNumber, r.status, r.bdeUserId, r.lead ? JSON.stringify(r.lead) : null,
            r.errors && Object.keys(r.errors).length ? JSON.stringify(r.errors) : null, r.duplicateOfRow ?? null, r.existingLeadIds ? r.existingLeadIds.join(',') : null);
          await tx.query(`INSERT INTO lead_import_rows (batch_id, \`row_number\`, row_status, bde_user_id, lead_json, errors_json, duplicate_of_row, existing_lead_ids) VALUES ${part.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`, params);
        }
        await tx.query(
          `UPDATE lead_import_batches SET total_rows = ?, valid_rows = ?, invalid_rows = ?, duplicate_in_file_rows = ?, duplicate_existing_rows = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
          [counts.total, counts.valid, counts.invalid, counts.duplicateInFile, counts.duplicateExisting, id]);
      });
    },
    async listRows(id, { status, page, pageSize }) {
      const limit = Math.min(Math.max(Math.trunc(pageSize), 1), 100); const offset = (Math.max(Math.trunc(page), 1) - 1) * limit; // validated integers
      const where = status ? 'WHERE r.batch_id = ? AND r.row_status = ?' : 'WHERE r.batch_id = ?';
      const params = status ? [id, status] : [id];
      const total = await db.query(`SELECT COUNT(*) AS total FROM lead_import_rows r ${where}`, params);
      const rows = await db.query(
        `SELECT r.row_number, r.row_status, r.bde_user_id, r.lead_json, r.errors_json, r.duplicate_of_row, r.existing_lead_ids, u.employee_id AS bde_employee_id, u.name AS bde_name
           FROM lead_import_rows r LEFT JOIN users u ON u.id = r.bde_user_id ${where} ORDER BY r.row_number ASC LIMIT ${limit} OFFSET ${offset}`, params);
      return { rows, total: Number(total[0].total) };
    },
    async listInvalidRows(id) {
      return db.query("SELECT `row_number`, errors_json FROM lead_import_rows WHERE batch_id = ? AND row_status = 'invalid' ORDER BY `row_number` ASC", [id]);
    },

    // Existing leads (ALL BDEs) that share a phone key or an email key. Returns Map('p:<key>' | 'e:<key>' -> [lead ids]).
    async findExistingByKeys(phoneKeys, emailKeys) {
      const found = new Map();
      const add = (k, id) => { if (!found.has(k)) found.set(k, []); found.get(k).push(Number(id)); };
      for (const part of chunks([...new Set(phoneKeys)])) {
        for (const r of await db.query(`SELECT id, phone_key FROM leads WHERE phone_key IN (${marks(part.length)})`, part)) add('p:' + r.phone_key, r.id);
      }
      for (const part of chunks([...new Set(emailKeys)])) {
        for (const r of await db.query(`SELECT id, email_key FROM leads WHERE email_key IN (${marks(part.length)})`, part)) add('e:' + r.email_key, r.id);
      }
      return found;
    },

    // Atomically: lock the batch, make sure it is still a preview, re-check duplicates against the CURRENT leads table (another
    // import or a BDE may have added leads since the preview), insert the rows, clear the personal data, mark committed.
    // Returns { inserted, skipped } or null when the batch is not (or no longer) a preview.
    async commit(id) {
      return db.transaction(async (tx) => {
        const locked = await tx.query("SELECT id, include_existing_duplicates FROM lead_import_batches WHERE id = ? AND status = 'preview' FOR UPDATE", [id]);
        if (!locked.length) return null;
        const include = Boolean(locked[0].include_existing_duplicates);
        const wanted = await tx.query(
          `SELECT \`row_number\`, row_status, bde_user_id, lead_json FROM lead_import_rows WHERE batch_id = ? AND row_status IN ('valid'${include ? ",'duplicate_existing'" : ''}) ORDER BY \`row_number\` ASC`, [id]);
        const total = (await tx.query('SELECT COUNT(*) AS n FROM lead_import_rows WHERE batch_id = ?', [id]))[0].n;
        const leads = wanted.map((w) => ({ bde: w.bde_user_id, status: w.row_status, lead: JSON.parse(w.lead_json) }));
        // Re-check duplicates at insert time (only strict rows 'valid'; admin-approved duplicates are inserted as they are).
        const strict = leads.filter((l) => l.status === 'valid');
        const pk = strict.map((l) => l.lead.phoneKey).filter(Boolean); const ek = strict.map((l) => l.lead.emailKey).filter(Boolean);
        const taken = new Set();
        for (const part of chunks([...new Set(pk)])) for (const r of await tx.query(`SELECT phone_key FROM leads WHERE phone_key IN (${marks(part.length)})`, part)) taken.add('p:' + r.phone_key);
        for (const part of chunks([...new Set(ek)])) for (const r of await tx.query(`SELECT email_key FROM leads WHERE email_key IN (${marks(part.length)})`, part)) taken.add('e:' + r.email_key);
        const toInsert = leads.filter((l) => l.status !== 'valid' || !((l.lead.phoneKey && taken.has('p:' + l.lead.phoneKey)) || (l.lead.emailKey && taken.has('e:' + l.lead.emailKey))));
        for (const part of chunks(toInsert, 200)) {
          const params = [];
          for (const l of part) { const v = l.lead; params.push(l.bde, v.candidateName, v.phone, v.phoneKey, v.email, v.emailKey, v.courseOrInternship, v.leadStatusId, v.followUpDate, v.nextAction); }
          await tx.query(
            `INSERT INTO leads (user_id, candidate_name, phone, phone_key, email, email_key, course_or_internship, lead_status_id, follow_up_date, next_action, created_at, updated_at)
             VALUES ${part.map(() => '(?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())').join(',')}`, params);
        }
        const inserted = toInsert.length; const skipped = Number(total) - inserted;
        await tx.query('DELETE FROM lead_import_rows WHERE batch_id = ?', [id]);
        await tx.query("UPDATE lead_import_batches SET status = 'committed', raw_rows_json = NULL, inserted_rows = ?, skipped_rows = ?, committed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?", [inserted, skipped, id]);
        return { inserted, skipped };
      });
    },
    async cancel(id) {
      return db.transaction(async (tx) => {
        const locked = await tx.query("SELECT id FROM lead_import_batches WHERE id = ? AND status = 'preview' FOR UPDATE", [id]);
        if (!locked.length) return false;
        await tx.query('DELETE FROM lead_import_rows WHERE batch_id = ?', [id]);
        await tx.query("UPDATE lead_import_batches SET status = 'cancelled', raw_rows_json = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
        return true;
      });
    }
  };
}
