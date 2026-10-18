import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createImportService } from '../src/modules/imports/imports.service.js';

const admin = { id: 1, role: 'admin', employeeId: 'ADM', name: 'Admin' };
const bde = { id: 10, role: 'bde', employeeId: 'E10', name: 'BDE 10' };

// In-memory stand-in for the repository: mirrors the rules the SQL enforces (preview-only changes, atomic commit, personal data cleared).
function fakeRepo({ existing = [] } = {}) {
  const statuses = [{ id: 1, name: 'New', sort_order: 10 }, { id: 2, name: 'Interested', sort_order: 20 }, { id: 5, name: 'Not Interested', sort_order: 50 }];
  const bdes = [{ id: 10, employee_id: 'E10', name: 'BDE 10' }, { id: 11, employee_id: 'E11', name: 'BDE 11' }];
  const batches = new Map(); let nextId = 1; const leads = [...existing]; const stagingRows = new Map();
  const bdeName = (id) => bdes.find((b) => b.id === Number(id));
  const full = (b) => ({ ...b, admin_employee_id: 'ADM', admin_name: 'Admin', default_bde_employee_id: bdeName(b.default_bde_id)?.employee_id ?? null, default_bde_name: bdeName(b.default_bde_id)?.name ?? null });
  return {
    leads, batches, stagingRows,
    listActiveStatuses: async () => statuses, listActiveBdes: async () => bdes,
    createBatch: async (b) => { const id = nextId++; batches.set(id, { id, admin_user_id: b.adminUserId, file_name: b.fileName, file_format: b.format, status: 'preview', headers_json: JSON.stringify(b.headers),
      raw_rows_json: JSON.stringify(b.rows), mapping_json: JSON.stringify(b.mapping), default_bde_id: b.defaultBdeId, default_course: b.defaultCourse, include_existing_duplicates: 0,
      total_rows: 0, valid_rows: 0, invalid_rows: 0, duplicate_in_file_rows: 0, duplicate_existing_rows: 0, inserted_rows: null, skipped_rows: null, created_at: 'c', committed_at: null }); return id; },
    getBatch: async (id) => { const b = batches.get(Number(id)); return b ? full(b) : null; },
    listBatches: async () => [...batches.values()].map(full),
    updateSettings: async (id, s) => { const b = batches.get(Number(id)); if (b.status !== 'preview') return; Object.assign(b, { mapping_json: JSON.stringify(s.mapping), default_bde_id: s.defaultBdeId, default_course: s.defaultCourse, include_existing_duplicates: s.includeExistingDuplicates ? 1 : 0 }); },
    replaceRows: async (id, rows, c) => { stagingRows.set(Number(id), rows); Object.assign(batches.get(Number(id)), { total_rows: c.total, valid_rows: c.valid, invalid_rows: c.invalid, duplicate_in_file_rows: c.duplicateInFile, duplicate_existing_rows: c.duplicateExisting }); },
    listRows: async (id, { status, page, pageSize }) => { let r = stagingRows.get(Number(id)) || []; if (status) r = r.filter((x) => x.status === status);
      return { total: r.length, rows: r.slice((page - 1) * pageSize, page * pageSize).map((x) => ({ row_number: x.rowNumber, row_status: x.status, bde_user_id: x.bdeUserId, lead_json: x.lead ? JSON.stringify(x.lead) : null,
        errors_json: Object.keys(x.errors || {}).length ? JSON.stringify(x.errors) : null, duplicate_of_row: x.duplicateOfRow, existing_lead_ids: x.existingLeadIds ? x.existingLeadIds.join(',') : null, bde_employee_id: bdeName(x.bdeUserId)?.employee_id, bde_name: bdeName(x.bdeUserId)?.name })) }; },
    listInvalidRows: async (id) => (stagingRows.get(Number(id)) || []).filter((x) => x.status === 'invalid').map((x) => ({ row_number: x.rowNumber, errors_json: JSON.stringify(x.errors) })),
    findExistingByKeys: async (pk, ek) => { const m = new Map(); for (const l of leads) { if (l.phoneKey && pk.includes(l.phoneKey)) m.set('p:' + l.phoneKey, [l.id]); if (l.emailKey && ek.includes(l.emailKey)) m.set('e:' + l.emailKey, [l.id]); } return m; },
    commit: async (id) => { const b = batches.get(Number(id)); if (b.status !== 'preview') return null; const rows = stagingRows.get(Number(id)) || [];
      const take = rows.filter((r) => r.status === 'valid' || (b.include_existing_duplicates && r.status === 'duplicate_existing'));
      for (const r of take) leads.push({ id: 1000 + leads.length, userId: r.bdeUserId, ...r.lead });
      Object.assign(b, { status: 'committed', raw_rows_json: null, inserted_rows: take.length, skipped_rows: rows.length - take.length, committed_at: 'now' }); stagingRows.delete(Number(id)); return { inserted: take.length, skipped: rows.length - take.length }; },
    cancel: async (id) => { const b = batches.get(Number(id)); if (b.status !== 'preview') return false; Object.assign(b, { status: 'cancelled', raw_rows_json: null }); stagingRows.delete(Number(id)); return true; }
  };
}
const csv = (s) => Buffer.from(s);
const FILE = csv('S.No,Student Name,Mobile,Email,Course,Status\n1,Priya R,9876543210,priya@x.com,Java,Interested\n2,Ravi K,9876543211,,Python,\n3,,123,bad,,\n4,Priya Again,+91 98765 43210,,Java,\n5,Existing Person,9000000001,,Java,Not Interested\n');
const make = (opts) => { const repo = fakeRepo(opts); return { repo, svc: createImportService({ repo }) }; };
const code = (p, status, c) => assert.rejects(p, (e) => e.status === status && (!c || e.code === c));

test('every operation is admin-only; BDE and anonymous callers are rejected', async () => {
  const { svc } = make();
  for (const actor of [bde, null, { id: 5, role: 'other' }]) {
    await code(svc.options(actor), 403); await code(svc.upload(actor, { body: FILE }), 403); await code(svc.list(actor), 403); await code(svc.get(actor, '1'), 403);
    await code(svc.update(actor, '1', {}), 403); await code(svc.rows(actor, '1'), 403); await code(svc.commit(actor, '1', { confirm: true }), 403); await code(svc.cancel(actor, '1'), 403); await code(svc.invalidRowsCsv(actor, '1'), 403);
  }
});

test('options lists active BDEs, statuses and mappable fields for the admin screen', async () => {
  const o = await make().svc.options(admin);
  assert.equal(o.bdes.length, 2); assert.equal(o.statuses[0].name, 'New'); assert.ok(o.fields.some((f) => f.key === 'candidateName'));
});

test('upload: auto-maps, validates, flags invalid / in-file / existing duplicates, writes NOTHING to leads', async () => {
  const { svc, repo } = make({ existing: [{ id: 77, userId: 11, phoneKey: '9000000001', emailKey: null }] });
  const b = await svc.upload(admin, { body: FILE, fileName: 'students.csv', defaultBdeId: 10 });
  assert.equal(b.status, 'preview'); assert.equal(b.needsMapping, false); assert.equal(b.defaultBde.employeeId, 'E10');
  assert.deepEqual(b.counts, { total: 5, valid: 2, invalid: 1, duplicateInFile: 1, duplicateExisting: 1 });
  assert.equal(repo.leads.length, 1, 'preview must not insert');
  const inv = await svc.rows(admin, b.id, { status: 'invalid' });
  assert.equal(inv.rows[0].rowNumber, 4); assert.ok(inv.rows[0].errors.candidateName);
  const dup = await svc.rows(admin, b.id, { status: 'duplicate_in_file' }); assert.equal(dup.rows[0].duplicateOfRow, 2);
  const ex = await svc.rows(admin, b.id, { status: 'duplicate_existing' }); assert.deepEqual(ex.rows[0].existingLeadIds, [77]);
});

test('commit: needs explicit confirm, inserts only valid rows with the chosen BDE, clears raw data, cannot be repeated', async () => {
  const { svc, repo } = make({ existing: [{ id: 77, userId: 11, phoneKey: '9000000001', emailKey: null }] });
  const b = await svc.upload(admin, { body: FILE, defaultBdeId: 10 });
  await code(svc.commit(admin, b.id, {}), 400); await code(svc.commit(admin, b.id, { confirm: 'yes' }), 400);
  const done = await svc.commit(admin, b.id, { confirm: true });
  assert.equal(done.status, 'committed'); assert.deepEqual(done.result, { inserted: 2, skipped: 3 });
  assert.equal(repo.leads.length, 3); assert.ok(repo.leads.slice(1).every((l) => l.userId === 10));
  assert.equal(repo.batches.get(1).raw_rows_json, null, 'personal data is cleared after commit');
  await code(svc.commit(admin, b.id, { confirm: true }), 409, 'IMPORT_CLOSED'); await code(svc.update(admin, b.id, {}), 409); await code(svc.cancel(admin, b.id), 409);
  assert.equal(repo.leads.length, 3, 'no double insert');
});

test('existing-duplicate rows are only imported when the admin explicitly opts in', async () => {
  const { svc, repo } = make({ existing: [{ id: 77, userId: 11, phoneKey: '9000000001', emailKey: null }] });
  const b = await svc.upload(admin, { body: FILE, defaultBdeId: 10 });
  const u = await svc.update(admin, b.id, { includeExistingDuplicates: true });
  assert.equal(u.includeExistingDuplicates, true);
  const done = await svc.commit(admin, b.id, { confirm: true });
  assert.deepEqual(done.result, { inserted: 3, skipped: 2 }); assert.equal(repo.leads.length, 4);
});

test('no default BDE and no employee-id column => rows invalid, commit refused (nothing to import)', async () => {
  const { svc } = make();
  const b = await svc.upload(admin, { body: FILE });
  assert.equal(b.counts.valid, 0); assert.ok((await svc.rows(admin, b.id, { status: 'invalid' })).rows.every((r) => r.errors.employeeId));
  await code(svc.commit(admin, b.id, { confirm: true }), 400, 'NOTHING_TO_IMPORT');
  const fixed = await svc.update(admin, b.id, { defaultBdeId: 11 });
  assert.equal(fixed.counts.valid, 3); assert.equal(fixed.counts.invalid, 1); assert.equal(fixed.counts.duplicateInFile, 1);
});

test('employee-id column assigns per row; unknown employee id is reported on that row', async () => {
  const { svc, repo } = make();
  const f = csv('Name,Phone,Course,Employee ID\nA One,9876543210,Java,E11\nB Two,9876543211,Java,E10\nC Three,9876543212,Java,NOPE\n');
  const b = await svc.upload(admin, { body: f });
  assert.deepEqual(b.counts, { total: 3, valid: 2, invalid: 1, duplicateInFile: 0, duplicateExisting: 0 });
  await svc.commit(admin, b.id, { confirm: true });
  assert.deepEqual(repo.leads.map((l) => l.userId), [11, 10]);
});

test('missing required columns => needsMapping, then a valid re-map recovers the batch; bad mappings are rejected', async () => {
  const { svc } = make();
  const b = await svc.upload(admin, { body: csv('colA,colB,colC\nPriya,9876543210,Java\n'), defaultBdeId: 10 });
  assert.equal(b.needsMapping, true); assert.equal(b.counts.total, 0);
  await code(svc.update(admin, b.id, {}), 400);
  await code(svc.update(admin, b.id, { mapping: { candidateName: 0, phone: 0 } }), 400);
  await code(svc.update(admin, b.id, { mapping: { candidateName: 0, phone: 9 } }), 400);
  const r = await svc.update(admin, b.id, { mapping: { candidateName: 0, phone: 1, courseOrInternship: 2 } });
  assert.equal(r.needsMapping, false); assert.equal(r.counts.valid, 1);
});

test('default course fills blanks; default BDE must be an active BDE; bad inputs rejected', async () => {
  const { svc } = make();
  const b = await svc.upload(admin, { body: csv('Name,Phone\nA One,9876543210\n'), defaultBdeId: 10, defaultCourse: 'Data Science' });
  assert.equal(b.counts.valid, 1); assert.equal(b.defaultCourse, 'Data Science');
  await code(svc.upload(admin, { body: FILE, defaultBdeId: 999 }), 400);
  await code(svc.upload(admin, { body: FILE, defaultBdeId: 'abc' }), 400);
  await code(svc.upload(admin, { body: FILE, defaultCourse: 'x'.repeat(151) }), 400);
  await code(svc.upload(admin, { body: Buffer.alloc(0) }), 400); await code(svc.upload(admin, { body: {} }), 400);
});

test('cancel clears the batch; ids and filters are validated; unknown batch is 404', async () => {
  const { svc, repo } = make();
  const b = await svc.upload(admin, { body: FILE, defaultBdeId: 10 });
  assert.equal((await svc.cancel(admin, b.id)).status, 'cancelled'); assert.equal(repo.batches.get(1).raw_rows_json, null);
  await code(svc.get(admin, '999'), 404); await code(svc.get(admin, '1; DROP TABLE leads'), 400); await code(svc.get(admin, '0'), 400);
  const c = await svc.upload(admin, { body: FILE, defaultBdeId: 10 });
  await code(svc.rows(admin, c.id, { status: 'nope' }), 400); await code(svc.rows(admin, c.id, { page: '0' }), 400);
});

test('invalid-rows CSV: original cells + problems, formula-safe, only for previews', async () => {
  const { svc } = make();
  const b = await svc.upload(admin, { body: csv('Name,Phone,Course\n=HYPERLINK("x"),12,Java\nOK Person,9876543210,Java\n'), defaultBdeId: 10 });
  const out = await svc.invalidRowsCsv(admin, b.id);
  assert.match(out, /^\ufeffRow,Name,Phone,Course,Problems/); assert.match(out, /"'=HYPERLINK/); assert.doesNotMatch(out, /OK Person/);
  await svc.cancel(admin, b.id); await code(svc.invalidRowsCsv(admin, b.id), 409);
});

test('list shows batches without any personal data', async () => {
  const { svc } = make();
  await svc.upload(admin, { body: FILE, defaultBdeId: 10, fileName: '../../etc/passwd\u0000.csv' });
  const l = await svc.list(admin); assert.equal(l.length, 1); assert.equal(l[0].fileName, '....etcpasswd.csv');
  assert.doesNotMatch(JSON.stringify(l), /9876543210|priya/i);
});

test('wiring (text check, like the other app-structure tests): import routes are admin-only, upload precedes the JSON guard, adminRouter stays read-only', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /api\.post\('\/admin\/imports', authenticate, authorize\('admin'\), importBody/);
  assert.ok(app.indexOf("api.post('/admin/imports'") < app.indexOf('api.use(requireJsonBody)'));
  assert.match(app, /api\.use\('\/admin\/imports', authenticate, authorize\('admin'\), importRouter\)/);
  assert.ok(app.indexOf("api.use('/admin/imports'") < app.indexOf("api.use('/admin', authenticate"), 'import router must be mounted before the generic admin router');
  assert.equal((app.match(/adminRouter\.(post|put|patch|delete)\(/g) || []).length, 0);
  assert.equal((app.match(/importRouter\.(post|put|patch)\(/g) || []).length, 3);
  assert.equal((app.match(/importRouter\.delete\(/g) || []).length, 0);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')); assert.ok(pkg.dependencies.exceljs);
});
