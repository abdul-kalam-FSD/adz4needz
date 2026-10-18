import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMapHeaders, validateMapping, normalizeDate, resolveStatus, processRow, markInFileDuplicates, summarize, safeCell, IMPORT_FIELDS } from '../src/lib/lead-import.js';

const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Interested' }, { id: 3, name: 'Follow-up Required' }, { id: 4, name: 'No Response / Not Reachable' }, { id: 5, name: 'Not Interested' }];
const bdeByEmployeeId = new Map([['e10', { id: 10 }], ['e11', { id: 11 }]]);
const headers = ['S.No', 'Student Name', 'Mobile Number', 'E-mail', 'Course', 'Status', 'Follow-up Date', 'Remarks', 'Emp ID'];
const { mapping } = autoMapHeaders(headers);
const ctx = (over = {}) => ({ mapping, statuses, defaultStatusId: 1, defaultCourse: '', defaultBdeId: 10, bdeByEmployeeId, ...over });

test('autoMapHeaders: maps common header spellings, leaves S.No unmapped, never reuses a column', () => {
  assert.deepEqual(mapping, { candidateName: 1, phone: 2, email: 3, courseOrInternship: 4, status: 5, followUpDate: 6, nextAction: 7, employeeId: 8 });
  const r = autoMapHeaders(['S.No', 'name', 'NAME']);
  assert.equal(r.mapping.candidateName, 1); assert.deepEqual(r.unmapped, [0, 2]);
  assert.deepEqual(autoMapHeaders(['foo', '', null]).mapping, {});
  assert.equal(autoMapHeaders(['Mobile_No']).mapping.phone, 0);
  assert.equal(IMPORT_FIELDS.length, 8);
});

test('validateMapping: requires name + a contact column, rejects bad/duplicate/unknown', () => {
  assert.equal(validateMapping({ candidateName: 0, phone: 1 }, 3).ok, true);
  assert.equal(validateMapping({ candidateName: 0, email: 2 }, 3).ok, true);
  assert.ok(validateMapping({ phone: 1 }, 3).errors.candidateName);
  assert.ok(validateMapping({ candidateName: 0 }, 3).errors.phone);
  assert.ok(validateMapping({ candidateName: 0, phone: 0 }, 3).errors.phone);
  assert.ok(validateMapping({ candidateName: 0, phone: 7 }, 3).errors.phone);
  assert.ok(validateMapping({ candidateName: 0, phone: 1, evil: 2 }, 3).errors.evil);
  assert.equal(validateMapping({ candidateName: 0, phone: 1, status: null }, 3).ok, true);
  assert.equal(validateMapping([], 3).ok, false);
  assert.equal(validateMapping({ candidateName: '0', phone: 1 }, 3).ok, false); // indexes must be integers
});

test('normalizeDate: Date cells, ISO, day-first, junk and impossible dates', () => {
  assert.deepEqual(normalizeDate(new Date(Date.UTC(2026, 9, 20))), { value: '2026-10-20' });
  assert.deepEqual(normalizeDate('2026-10-05'), { value: '2026-10-05' });
  assert.deepEqual(normalizeDate('05-10-2026'), { value: '2026-10-05' });
  assert.deepEqual(normalizeDate('5/10/2026'), { value: '2026-10-05' });
  assert.deepEqual(normalizeDate(''), { value: null });
  assert.deepEqual(normalizeDate(undefined), { value: null });
  assert.deepEqual(normalizeDate('31-02-2026'), { error: true });
  assert.deepEqual(normalizeDate('tomorrow'), { error: true });
  assert.deepEqual(normalizeDate(new Date('x')), { error: true });
});

test('resolveStatus: exact, synonym, default, unknown', () => {
  assert.deepEqual(resolveStatus('interested', statuses, 1), { id: 2 });
  assert.deepEqual(resolveStatus('Not  Interested', statuses, 1), { id: 5 });
  assert.deepEqual(resolveStatus('follow up', statuses, 1), { id: 3 });
  assert.deepEqual(resolveStatus('not reachable', statuses, 1), { id: 4 });
  assert.deepEqual(resolveStatus('', statuses, 1), { id: 1 });
  assert.ok(resolveStatus('maybe later', statuses, 1).error);
});

test('processRow: valid row, numeric Excel phone, default BDE and explicit employee id', () => {
  const r = processRow([1, ' Priya R ', 9876543210, 'Priya@Example.com', 'Full Stack', 'Interested', new Date(Date.UTC(2026, 9, 20)), 'Call back', ''], ctx());
  assert.equal(r.status, 'valid'); assert.equal(r.bdeId, 10);
  assert.equal(r.lead.candidateName, 'Priya R'); assert.equal(r.lead.phone, '9876543210'); assert.equal(r.lead.phoneKey, '9876543210');
  assert.equal(r.lead.emailKey, 'priya@example.com'); assert.equal(r.lead.leadStatusId, 2); assert.equal(r.lead.followUpDate, '2026-10-20');
  assert.equal('confirmDuplicate' in r.lead, false);
  const r2 = processRow([2, 'A B', '9123456780', '', 'Java', '', '', '', 'E11'], ctx());
  assert.equal(r2.bdeId, 11); assert.equal(r2.lead.leadStatusId, 1);
});

test('processRow: reports every problem per field, never throws', () => {
  const r = processRow([1, '', '12', 'bad', '', 'zzz', '99-99-2026', '', 'E99'], ctx({ defaultBdeId: null }));
  assert.equal(r.status, 'invalid'); assert.equal(r.lead, null);
  for (const k of ['candidateName', 'phone', 'email', 'courseOrInternship', 'status', 'followUpDate', 'employeeId']) assert.ok(r.errors[k], k);
  const noBde = processRow([1, 'A B', '9876543210', '', 'Java', '', '', '', ''], ctx({ defaultBdeId: null }));
  assert.match(noBde.errors.employeeId, /No BDE/);
  const noContact = processRow([1, 'A B', '', '', 'Java', '', '', '', ''], ctx());
  assert.ok(noContact.errors.phone);
});

test('processRow: default course fills a missing course cell; rich-text/formula cells are read', () => {
  const r = processRow([1, { richText: [{ text: 'Ravi ' }, { text: 'K' }] }, { result: 9876543211 }, null, '', '', '', '', ''], ctx({ defaultCourse: 'Data Science' }));
  assert.equal(r.status, 'valid'); assert.equal(r.lead.candidateName, 'Ravi K'); assert.equal(r.lead.courseOrInternship, 'Data Science'); assert.equal(r.lead.phone, '9876543211');
});

test('markInFileDuplicates: first occurrence wins by phone or email, +91 prefix matches, invalid rows ignored', () => {
  const rows = [
    ['1', 'A One', '+91 98765 43210', 'a@x.com'], ['2', 'A Two', '9876543210', ''], ['3', 'B', '9000000001', 'A@X.COM'],
    ['4', '', '9000000009', ''], ['5', 'C', '9000000002', 'c@x.com']
  ].map((r) => processRow([r[0], r[1], r[2], r[3], 'Java', '', '', '', ''], ctx()));
  markInFileDuplicates(rows);
  assert.deepEqual(rows.map((r) => r.status), ['valid', 'duplicate_in_file', 'duplicate_in_file', 'invalid', 'valid']);
  assert.equal(rows[1].duplicateOf, 0); assert.equal(rows[2].duplicateOf, 0);
  assert.deepEqual(summarize(rows.map((r) => r.status)), { total: 5, valid: 2, invalid: 1, duplicateInFile: 2, duplicateExisting: 0 });
});

test('safeCell neutralises spreadsheet formulas', () => {
  assert.equal(safeCell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(safeCell('+91 99'), "'+91 99"); assert.equal(safeCell('@cmd'), "'@cmd");
  assert.equal(safeCell('Priya'), 'Priya'); assert.equal(safeCell(5), 5);
});
