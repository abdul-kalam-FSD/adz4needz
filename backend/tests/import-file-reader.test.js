import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, sniffFormat, readImportFile } from '../src/lib/import-file-reader.js';
import { MAX_IMPORT_ROWS } from '../src/lib/lead-import.js';

const rej = (p, code) => assert.rejects(p, (e) => e.status >= 400 && (!code || e.code === code));

test('sniffFormat: zip => xlsx, text => csv, binary/empty => null', () => {
  assert.equal(sniffFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1])), 'xlsx');
  assert.equal(sniffFormat(Buffer.from('a,b\n1,2')), 'csv');
  assert.equal(sniffFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1])), null);
  assert.equal(sniffFormat(Buffer.alloc(0)), null);
  assert.equal(sniffFormat('text'), null);
});

test('parseCsv: quotes, escaped quotes, embedded newline, CRLF, BOM, semicolon delimiter', () => {
  assert.deepEqual(parseCsv('\ufeffname,note\r\n"Smith, J","say ""hi"""\r\n"multi\nline",x\r\n'), [['name', 'note'], ['Smith, J', 'say "hi"'], ['multi\nline', 'x']]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.throws(() => parseCsv('a,b\n"open,1'), (e) => e.code === 'IMPORT_FILE_INVALID');
});

test('readImportFile (csv): header row, padding, blank lines skipped', async () => {
  const r = await readImportFile(Buffer.from('Name,Phone,Course\nA,9876543210,Java\n\n,,\nB,9876543211\n'));
  assert.equal(r.format, 'csv'); assert.deepEqual(r.headers, ['Name', 'Phone', 'Course']);
  assert.deepEqual(r.rows, [['A', '9876543210', 'Java'], ['B', '9876543211', '']]);
});

test('readImportFile: empty, header-only, too many rows, binary are rejected with clear codes', async () => {
  await rej(readImportFile(Buffer.from('   \n\n')), 'IMPORT_FILE_EMPTY');
  await rej(readImportFile(Buffer.from('Name,Phone\n')), 'IMPORT_FILE_EMPTY');
  await rej(readImportFile(Buffer.from('Name\n' + 'x\n'.repeat(MAX_IMPORT_ROWS + 1))), 'IMPORT_FILE_TOO_LARGE');
  await rej(readImportFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])), 'IMPORT_FILE_INVALID');
});

test('readImportFile (xlsx) with an injected fake exceljs: first non-empty sheet, row.values is 1-based', async () => {
  const fake = async () => ({ Workbook: class { constructor() { this.xlsx = { load: async () => {} }; this.worksheets = [{ rowCount: 0, eachRow() {} }, {
    rowCount: 3, eachRow(_o, cb) { cb({ values: [undefined, 'Name', 'Phone'] }); cb({ values: [undefined, 'A', 9876543210] }); } }]; } } });
  const r = await readImportFile(Buffer.from([0x50, 0x4b, 3, 4, 0]), { loadExcelJs: fake });
  assert.equal(r.format, 'xlsx'); assert.deepEqual(r.headers, ['Name', 'Phone']); assert.deepEqual(r.rows, [['A', 9876543210]]);
});

test('readImportFile (xlsx): missing library => 500 IMPORT_UNAVAILABLE; corrupt workbook => 400', async () => {
  await rej(readImportFile(Buffer.from([0x50, 0x4b, 3, 4, 0]), { loadExcelJs: async () => { throw new Error('nope'); } }), 'IMPORT_UNAVAILABLE');
  const bad = async () => ({ Workbook: class { constructor() { this.xlsx = { load: async () => { throw new Error('corrupt'); } }; } } });
  await rej(readImportFile(Buffer.from([0x50, 0x4b, 3, 4, 0]), { loadExcelJs: bad }), 'IMPORT_FILE_INVALID');
});
