// Admin-only Excel/CSV lead import: upload -> auto column mapping -> validation/duplicate preview -> (optional re-map)
// -> explicit confirm -> insert. Nothing is written to `leads` until commit().
import { HttpError } from '../../lib/http-error.js';
import { readImportFile } from '../../lib/import-file-reader.js';
import { IMPORT_FIELDS, autoMapHeaders, validateMapping, processRow, markInFileDuplicates, summarize, safeCell } from '../../lib/lead-import.js';

const CONTROL = /[\u0000-\u001F\u007F]/;
const ROW_STATUSES = ['valid', 'invalid', 'duplicate_in_file', 'duplicate_existing'];
const requireAdmin = (actor) => { if (!actor || actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an admin can import leads.'); };
const bad = (fields) => new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', fields);
const safeJson = (t, fallback) => { try { return JSON.parse(t); } catch { return fallback; } };

function parseId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d{0,17}$/.test(text)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid import id.');
  return text;
}
function cleanFileName(name) {
  const t = typeof name === 'string' ? name.replace(/[\u0000-\u001F\u007F/\\]/g, '').trim() : '';
  return (t || 'upload').slice(0, 255);
}
function parseCourse(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  if (typeof v !== 'string' || CONTROL.test(v) || v.trim().length > 150) throw bad({ defaultCourse: 'Default course must be plain text of at most 150 characters.' });
  return v.trim();
}

export function createImportService({ repo }) {
  async function context(settings) {
    const statuses = (await repo.listActiveStatuses()).map((s) => ({ id: s.id, name: s.name }));
    if (!statuses.length) throw new HttpError(500, 'NO_LEAD_STATUSES', 'No active lead statuses are configured.');
    const newStatus = statuses.find((s) => s.name.toLowerCase() === 'new') || statuses[0];
    const bdes = await repo.listActiveBdes();
    return {
      mapping: settings.mapping, statuses, defaultStatusId: newStatus.id, defaultCourse: settings.defaultCourse || '', defaultBdeId: settings.defaultBdeId ?? null,
      bdeByEmployeeId: new Map(bdes.map((b) => [String(b.employee_id).toLowerCase(), { id: b.id }])), bdes
    };
  }

  async function parseBde(value, bdes) {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || !bdes.some((b) => Number(b.id) === id)) throw bad({ defaultBdeId: 'Choose an active BDE.' });
    return id;
  }

  // Re-processes every stored row with the current settings and rewrites the staging rows + counters.
  async function evaluate(batchId, rawRows, settings) {
    const ctx = await context(settings);
    const results = rawRows.map((r) => processRow(r, ctx));
    markInFileDuplicates(results);
    const valid = results.filter((r) => r.status === 'valid');
    const existing = await repo.findExistingByKeys(valid.map((r) => r.lead.phoneKey).filter(Boolean), valid.map((r) => r.lead.emailKey).filter(Boolean));
    for (const r of valid) {
      const ids = new Set([...(r.lead.phoneKey ? existing.get('p:' + r.lead.phoneKey) || [] : []), ...(r.lead.emailKey ? existing.get('e:' + r.lead.emailKey) || [] : [])]);
      if (ids.size) { r.status = 'duplicate_existing'; r.existingLeadIds = [...ids].slice(0, 10); }
    }
    const rows = results.map((r, i) => ({
      rowNumber: i + 2, status: r.status, bdeUserId: r.bdeId, lead: r.lead, errors: r.errors,
      duplicateOfRow: r.duplicateOf !== undefined ? r.duplicateOf + 2 : null, existingLeadIds: r.existingLeadIds || null
    }));
    await repo.replaceRows(batchId, rows, summarize(results.map((r) => r.status)));
  }

  function view(b) {
    const headers = safeJson(b.headers_json, []);
    const mapping = safeJson(b.mapping_json, {});
    return {
      id: Number(b.id), fileName: b.file_name, format: b.file_format, status: b.status, headers, mapping, fields: IMPORT_FIELDS,
      needsMapping: !validateMapping(mapping, headers.length).ok,
      defaultBde: b.default_bde_id ? { id: Number(b.default_bde_id), employeeId: b.default_bde_employee_id, name: b.default_bde_name } : null,
      defaultCourse: b.default_course, includeExistingDuplicates: Boolean(b.include_existing_duplicates),
      counts: { total: b.total_rows, valid: b.valid_rows, invalid: b.invalid_rows, duplicateInFile: b.duplicate_in_file_rows, duplicateExisting: b.duplicate_existing_rows },
      result: b.status === 'committed' ? { inserted: b.inserted_rows, skipped: b.skipped_rows } : null,
      createdAt: b.created_at, committedAt: b.committed_at
    };
  }
  async function load(id, { needPreview } = {}) {
    const b = await repo.getBatch(parseId(id));
    if (!b) throw new HttpError(404, 'NOT_FOUND', 'Import not found.');
    if (needPreview && b.status !== 'preview') throw new HttpError(409, 'IMPORT_CLOSED', `This import is already ${b.status}.`);
    return b;
  }

  return {
    async options(actor) {
      requireAdmin(actor);
      const bdes = await repo.listActiveBdes();
      const statuses = (await repo.listActiveStatuses()).map((x) => ({ id: Number(x.id), name: x.name }));
      return { bdes: bdes.map((b) => ({ id: Number(b.id), employeeId: b.employee_id, name: b.name })), statuses, fields: IMPORT_FIELDS };
    },

    async upload(actor, { body, fileName, defaultBdeId, defaultCourse }) {
      requireAdmin(actor);
      if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose an .xlsx or .csv file to upload.');
      const bdes = await repo.listActiveBdes();
      const bdeId = await parseBde(defaultBdeId === undefined ? undefined : (defaultBdeId === '' ? '' : Number(defaultBdeId)), bdes);
      const course = parseCourse(defaultCourse);
      const file = await readImportFile(body);
      const { mapping } = autoMapHeaders(file.headers);
      const id = await repo.createBatch({ adminUserId: actor.id, fileName: cleanFileName(fileName), format: file.format, headers: file.headers, rows: file.rows, mapping, defaultBdeId: bdeId, defaultCourse: course });
      if (validateMapping(mapping, file.headers.length).ok) await evaluate(id, file.rows, { mapping, defaultBdeId: bdeId, defaultCourse: course });
      return view(await repo.getBatch(id));
    },

    async list(actor) {
      requireAdmin(actor);
      return (await repo.listBatches(30)).map((b) => ({
        id: Number(b.id), fileName: b.file_name, format: b.file_format, status: b.status, createdAt: b.created_at, committedAt: b.committed_at,
        counts: { total: b.total_rows, valid: b.valid_rows, invalid: b.invalid_rows, duplicateInFile: b.duplicate_in_file_rows, duplicateExisting: b.duplicate_existing_rows },
        result: b.status === 'committed' ? { inserted: b.inserted_rows, skipped: b.skipped_rows } : null, admin: { employeeId: b.admin_employee_id, name: b.admin_name }
      }));
    },

    async get(actor, id) { requireAdmin(actor); return view(await load(id)); },

    // body: { mapping?, defaultBdeId?, defaultCourse?, includeExistingDuplicates? } -- missing keys keep their stored value.
    async update(actor, id, body) {
      requireAdmin(actor);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad({ _form: 'Request body must be a JSON object.' });
      const b = await load(id, { needPreview: true });
      const headers = safeJson(b.headers_json, []);
      const bdes = await repo.listActiveBdes();
      let mapping = safeJson(b.mapping_json, {});
      if (body.mapping !== undefined) {
        const m = validateMapping(body.mapping, headers.length);
        if (!m.ok) throw bad(m.errors);
        mapping = m.value;
      } else {
        const m = validateMapping(mapping, headers.length);
        if (!m.ok) throw bad(m.errors);
      }
      const defaultBdeId = 'defaultBdeId' in body ? await parseBde(body.defaultBdeId, bdes) : (b.default_bde_id === null ? null : Number(b.default_bde_id));
      const defaultCourse = 'defaultCourse' in body ? parseCourse(body.defaultCourse) : b.default_course;
      const includeExistingDuplicates = 'includeExistingDuplicates' in body ? body.includeExistingDuplicates === true : Boolean(b.include_existing_duplicates);
      await repo.updateSettings(b.id, { mapping, defaultBdeId, defaultCourse, includeExistingDuplicates });
      await evaluate(b.id, safeJson(b.raw_rows_json, []), { mapping, defaultBdeId, defaultCourse });
      return view(await repo.getBatch(b.id));
    },

    async rows(actor, id, query = {}) {
      requireAdmin(actor);
      const b = await load(id);
      const status = query.status === undefined || query.status === '' ? null : query.status;
      if (status !== null && !ROW_STATUSES.includes(status)) throw bad({ status: 'Unknown row status.' });
      const num = (v, d, max) => { if (v === undefined || v === '') return d; if (!/^\d{1,6}$/.test(String(v)) || Number(v) < 1) throw bad({ page: 'Invalid page.' }); return Math.min(Number(v), max); };
      const page = num(query.page, 1, 100000); const pageSize = num(query.pageSize, 25, 100);
      const { rows, total } = await repo.listRows(b.id, { status, page, pageSize });
      return {
        page, pageSize, total,
        rows: rows.map((r) => ({
          rowNumber: r.row_number, status: r.row_status, lead: r.lead_json ? safeJson(r.lead_json, null) : null, errors: r.errors_json ? safeJson(r.errors_json, {}) : {},
          bde: r.bde_user_id ? { id: Number(r.bde_user_id), employeeId: r.bde_employee_id, name: r.bde_name } : null,
          duplicateOfRow: r.duplicate_of_row, existingLeadIds: r.existing_lead_ids ? r.existing_lead_ids.split(',').map(Number) : []
        }))
      };
    },

    // Plain CSV (formula-safe) of the rows that failed validation, with the original cells and the error text.
    async invalidRowsCsv(actor, id) {
      requireAdmin(actor);
      const b = await load(id, { needPreview: true });
      const headers = safeJson(b.headers_json, []); const raw = safeJson(b.raw_rows_json, []);
      const bad = await repo.listInvalidRows(b.id);
      const q = (v) => { const s = String(safeCell(v ?? '')); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const lines = [['Row', ...headers, 'Problems'].map(q).join(',')];
      for (const r of bad) {
        const errs = Object.values(safeJson(r.errors_json, {})).join(' | ');
        const cells = headers.map((_, i) => { const c = (raw[r.row_number - 2] || [])[i]; return c instanceof Date ? c.toISOString().slice(0, 10) : (c && typeof c === 'object' ? (c.text ?? c.result ?? '') : c); });
        lines.push([r.row_number, ...cells, errs].map(q).join(','));
      }
      return '\ufeff' + lines.join('\r\n') + '\r\n';
    },

    async commit(actor, id, body) {
      requireAdmin(actor);
      if (!body || body.confirm !== true) throw bad({ confirm: 'Confirm the import to continue.' });
      const b = await load(id, { needPreview: true });
      if (validateMapping(safeJson(b.mapping_json, {}), safeJson(b.headers_json, []).length).ok === false) throw bad({ mapping: 'Map the columns first.' });
      const importable = b.valid_rows + (b.include_existing_duplicates ? b.duplicate_existing_rows : 0);
      if (importable === 0) throw new HttpError(400, 'NOTHING_TO_IMPORT', 'There are no valid rows to import.');
      const res = await repo.commit(b.id);
      if (!res) throw new HttpError(409, 'IMPORT_CLOSED', 'This import was already committed or cancelled.');
      return view(await repo.getBatch(b.id));
    },

    async cancel(actor, id) {
      requireAdmin(actor);
      const b = await load(id, { needPreview: true });
      if (!(await repo.cancel(b.id))) throw new HttpError(409, 'IMPORT_CLOSED', 'This import was already committed or cancelled.');
      return view(await repo.getBatch(b.id));
    }
  };
}
