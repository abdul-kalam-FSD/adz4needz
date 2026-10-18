import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSheetUpdates, sheetRows, mapSheetHeaders, SHEET_HEADERS } from '../src/lib/lead-sheet.js';
import { createLeadSheetService } from '../src/modules/lead-sheets/lead-sheets.service.js';
import { createLeadSheetRepository } from '../src/modules/lead-sheets/lead-sheets.repository.js';

const admin = { id: 1, role: 'admin' };
const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Interested' }, { id: 3, name: 'Follow-up Required' }];
const lead = (id, o = {}) => ({ id, user_id: 7, candidate_name: 'Kavin K.', lead_status_id: 1, status_name: 'New', follow_up_date: '2026-10-15', next_action: 'First call', updated_at: '2026-10-16 10:00:00', ...o });
const byId = (...ls) => new Map(ls.map((l) => [String(l.id), l]));
const sheet = (rows, headers = ['Lead ID', 'Candidate', 'Status', 'Follow-up date', 'Next action', 'Last updated (UTC)']) => ({ headers, rows });
const R = (id, status = '', fu = '', na = '', stamp = '2026-10-16 10:00:00') => [id, 'x', status, fu, na, stamp];

test('download rows: formula-looking text is neutralised, dates are plain text, stamp is exact', () => {
  const rows = sheetRows([{ id: 5, candidate_name: '=HYPERLINK("http://evil")', phone: '+91 1', course_or_internship: 'Java', bde_name: 'Asha', employee_id: 'B1', status_name: 'New', follow_up_date: '2026-10-15', next_action: '@cmd', updated_at: '2026-10-16 10:00:00' }]);
  assert.equal(rows[0].length, SHEET_HEADERS.length); assert.equal(rows[0][1][0], "'"); assert.equal(rows[0][7][0], "'"); assert.equal(rows[0][6], '2026-10-15'); assert.equal(rows[0][8], '2026-10-16 10:00:00');
});

test('plan: changes shown as from/to; blank cells keep the value; identical values are "unchanged"', () => {
  const p = planSheetUpdates(sheet([R(1, 'Interested', '20/10/2026', 'Send brochure'), R(2), R(3, 'New', '2026-10-15', 'First call')]), { leadsById: byId(lead(1), lead(2), lead(3)), statuses });
  assert.equal(p.ok, true);
  assert.deepEqual(p.rows[0].changes, { status: { from: 'New', to: 'Interested' }, followUpDate: { from: '2026-10-15', to: '2026-10-20' }, nextAction: { from: 'First call', to: 'Send brochure' } });
  assert.deepEqual(p.rows[0].update, { id: '1', leadStatusId: 2, followUpDate: '2026-10-20', nextAction: 'Send brochure', expectedUpdatedAt: '2026-10-16 10:00:00' });
  assert.equal(p.rows[1].state, 'unchanged'); assert.equal(p.rows[2].state, 'unchanged');
  assert.deepEqual(p.summary, { total: 3, willChange: 1, unchanged: 2, errors: 0, conflicts: 0, unknownLeads: 0 });
});

test('plan: a partial edit keeps the other fields as they are in the database', () => {
  const p = planSheetUpdates(sheet([R(1, 'Follow-up Required')]), { leadsById: byId(lead(1)), statuses });
  assert.deepEqual(p.rows[0].update, { id: '1', leadStatusId: 3, followUpDate: '2026-10-15', nextAction: 'First call', expectedUpdatedAt: '2026-10-16 10:00:00' });
});

test('plan: stale sheet row is a CONFLICT and writes nothing; unknown / duplicate / non-numeric ids are reported', () => {
  const p = planSheetUpdates(sheet([R(1, 'Interested', '', '', '2026-10-16 09:00:00'), R(99, 'Interested'), R(2, 'Interested'), R(2, 'Interested'), R('abc')]), { leadsById: byId(lead(1), lead(2)), statuses });
  assert.deepEqual(p.rows.map((r) => r.state), ['conflict', 'unknown_lead', 'change', 'error', 'error']);
  assert.equal(p.rows.filter((r) => r.update).length, 1);
  assert.equal(p.summary.conflicts, 1); assert.equal(p.summary.unknownLeads, 1); assert.equal(p.summary.errors, 2);
});

test('plan: bad status, bad date, over-long or control-character text are row errors (nothing from that row is applied)', () => {
  const long = 'x'.repeat(501);
  const p = planSheetUpdates(sheet([R(1, 'Hired!'), R(2, '', '31/02/2026'), R(3, '', '', long), R(4, '', '', 'a\u0000b'), R(5, 'Interested', 'never')]), { leadsById: byId(lead(1), lead(2), lead(3), lead(4), lead(5)), statuses });
  assert.deepEqual(p.rows.map((r) => r.state), ['error', 'error', 'error', 'error', 'error']);
  assert.ok(p.rows[0].errors.status && p.rows[1].errors.followUpDate && p.rows[2].errors.nextAction && p.rows[3].errors.nextAction);
  assert.ok(p.rows.every((r) => r.update === null));
});

test('plan: date cells (Excel dates) and a re-typed stamp as a Date are understood', () => {
  const p = planSheetUpdates(sheet([[1, 'x', '', new Date(Date.UTC(2026, 9, 21)), '', new Date(Date.UTC(2026, 9, 16, 10, 0, 0))]]), { leadsById: byId(lead(1)), statuses });
  assert.equal(p.rows[0].state, 'change'); assert.equal(p.rows[0].update.followUpDate, '2026-10-21');
});

test('headers: a sheet without Lead ID / stamp or without any editable column is refused with a clear message', () => {
  assert.equal(mapSheetHeaders(['Name', 'Phone']).ok, false);
  assert.match(mapSheetHeaders(['Lead ID', 'Candidate']).message, /editable columns|Last updated/);
  assert.equal(mapSheetHeaders(['Lead ID', 'Last updated (UTC)']).ok, false);
  assert.equal(mapSheetHeaders(['lead id', 'STATUS', 'Last Updated (UTC)']).ok, true);
  assert.equal(planSheetUpdates({ headers: ['A'], rows: [['1']] }, { leadsById: new Map(), statuses }).ok, false);
});

function make({ leads = [lead(1), lead(2)], applyResults = [true, true] } = {}) {
  const applied = []; let i = 0;
  const repo = {
    listStatuses: async () => statuses, findLeads: async (ids) => leads.filter((l) => ids.includes(String(l.id))),
    applyUpdate: async (u) => { applied.push(u); return applyResults[i++] ?? true; },
    findBde: async (id) => (String(id) === '7' ? { id: 7, employee_id: 'BDE-007', name: 'P' } : null), listForSheet: async () => leads.map((l) => ({ ...l, phone: '', course_or_internship: 'J', bde_name: 'P', employee_id: 'B7' }))
  };
  const csv = Buffer.from('x');
  const readFile = async () => sheet([R(1, 'Interested'), R(2, 'Follow-up Required')]);
  return { applied, csv, svc: createLeadSheetService({ repo, readFile, now: () => new Date('2026-10-17T05:00:00Z'), loadExcelJs: async () => { throw new Error('none'); } }) };
}

test('service: admin only; preview writes nothing; apply writes only planned rows and reports write-time conflicts', async () => {
  const { svc, applied, csv } = make({ applyResults: [true, false] });
  await assert.rejects(svc.preview({ id: 2, role: 'bde' }, { body: csv }), (e) => e.status === 403);
  await assert.rejects(svc.apply({ id: 2, role: 'bde' }, { body: csv }), (e) => e.status === 403);
  await assert.rejects(svc.preview(admin, { body: null }), (e) => e.status === 400);
  await assert.rejects(svc.apply(admin, { body: Buffer.alloc(0) }), (e) => e.status === 400);
  const pv = await svc.preview(admin, { body: csv });
  assert.equal(pv.summary.willChange, 2); assert.equal(applied.length, 0, 'preview wrote nothing');
  const r = await svc.apply(admin, { body: csv });
  assert.equal(r.applied, 1); assert.equal(r.conflictsAtWrite, 1); assert.equal(r.skipped, 0); assert.equal(applied.length, 2);
});

test('service: export refuses bad BDE ids and reports a missing Excel library cleanly', async () => {
  const { svc } = make();
  await assert.rejects(svc.exportSheet({ id: 2, role: 'bde' }), (e) => e.status === 403);
  await assert.rejects(svc.exportSheet(admin, 'x'), (e) => e.status === 400);
  await assert.rejects(svc.exportSheet(admin, '99'), (e) => e.status === 404);
  await assert.rejects(svc.exportSheet(admin, '7'), (e) => e.status === 500 && e.code === 'EXPORT_UNAVAILABLE');
});

test('service: export with a fake workbook builds the file name from the BDE and date', async () => {
  const sheets = [];
  const fakeExcel = { Workbook: class { constructor() { this.xlsx = { writeBuffer: async () => new Uint8Array([1, 2, 3]) }; } addWorksheet(n) { const ws = { name: n, rows: [], getRow: () => ({}), getColumn: () => ({}), addRow(r) { this.rows.push(r); } }; sheets.push(ws); return ws; } } };
  const { svc } = make();
  const svc2 = createLeadSheetService({ repo: { listForSheet: async () => [{ ...lead(1), phone: '', course_or_internship: 'J', bde_name: 'P', employee_id: 'B7' }], findBde: async () => ({ id: 7, employee_id: 'BDE-007', name: 'P' }) }, now: () => new Date('2026-10-17T05:00:00Z'), loadExcelJs: async () => fakeExcel });
  const f = await svc2.exportSheet(admin, '7');
  assert.equal(f.fileName, 'update-leads-BDE-007-2026-10-17.xlsx'); assert.equal(f.count, 1); assert.equal(sheets[0].name, 'Update leads'); assert.equal(sheets[0].rows[0][0], 1);
  assert.ok(svc);
});

test('repository SQL: the update is guarded by the sheet stamp, only three fields are written, lists are chunked parameters', async () => {
  const log = []; let affected = 1;
  const db = { query: async (sql, p) => { log.push([sql.replace(/\s+/g, ' ').trim(), p]); return Array.isArray(p) && /^SELECT/.test(sql.trim()) ? [] : { affectedRows: affected }; } };
  const repo = createLeadSheetRepository(db);
  assert.equal(await repo.applyUpdate({ id: '1', leadStatusId: 2, followUpDate: '2026-10-20', nextAction: 'x', expectedUpdatedAt: '2026-10-16 10:00:00' }), true);
  assert.equal(log[0][0], 'UPDATE leads SET lead_status_id = ?, follow_up_date = ?, next_action = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND updated_at = ?');
  assert.deepEqual(log[0][1], [2, '2026-10-20', 'x', '1', '2026-10-16 10:00:00']);
  affected = 0; assert.equal(await repo.applyUpdate({ id: '1', leadStatusId: 2, followUpDate: null, nextAction: null, expectedUpdatedAt: 's' }), false);
  log.length = 0; await repo.findLeads(Array.from({ length: 1001 }, (_, i) => String(i + 1)));
  assert.equal(log.length, 3); assert.deepEqual(log.map((l) => l[1].length), [500, 500, 1]); assert.ok(log.every(([s]) => !/DROP|DELETE|TRUNCATE/i.test(s)));
});

test('routes: downloads are admin-only GETs; both uploads are admin-only and registered before the JSON guard', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const guard = app.indexOf('api.use(requireJsonBody)');
  for (const route of ["'/admin/lead-sheet/preview'", "'/admin/lead-sheet/apply'"]) { const at = app.indexOf(`api.post(${route}, authenticate, authorize('admin'), importBody`); assert.ok(at > 0 && at < guard, route); }
  assert.match(app, /api\.use\('\/admin\/lead-sheet', authenticate, authorize\('admin'\), leadSheetRouter\)/);
  assert.ok(app.indexOf("api.use('/admin/lead-sheet'") < app.indexOf("api.use('/admin', authenticate"));
  for (const r of ['/admin/assignments', '/admin/activity']) assert.ok(app.indexOf(`api.use('${r}'`) < app.indexOf("api.use('/admin', authenticate"), r);
});
