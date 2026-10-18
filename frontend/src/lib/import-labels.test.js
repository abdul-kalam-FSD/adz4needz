import test from 'node:test';
import assert from 'node:assert/strict';
import { rowStatusLabel, formatErrors, countsSentence, importableCount, validateUploadFile } from './import-labels.js';

test('labels, errors and counts', () => {
  assert.equal(rowStatusLabel('valid'), 'Ready to import'); assert.equal(rowStatusLabel('zzz'), 'zzz');
  assert.equal(formatErrors({ phone: 'Bad phone.', email: '', status: 'Bad status.' }), 'Bad phone. Bad status.'); assert.equal(formatErrors(null), '');
  assert.equal(countsSentence({ total: 5, valid: 2, invalid: 1, duplicateInFile: 1, duplicateExisting: 1 }), '5 rows: 2 ready, 1 with errors, 1 repeated in the file, 1 already in the system.');
  assert.equal(countsSentence({ total: 0 }), 'No rows checked yet.'); assert.equal(countsSentence(null), 'No rows checked yet.');
  const c = { valid: 2, duplicateExisting: 3 };
  assert.equal(importableCount(c, false), 2); assert.equal(importableCount(c, true), 5); assert.equal(importableCount(null, true), 0);
});
test('validateUploadFile', () => {
  assert.match(validateUploadFile(null), /Choose/);
  assert.match(validateUploadFile({ name: 'a.pdf', size: 5 }), /Only/);
  assert.match(validateUploadFile({ name: 'a.csv', size: 0 }), /empty/);
  assert.match(validateUploadFile({ name: 'a.xlsx', size: 6 * 1024 * 1024 }), /larger/);
  assert.equal(validateUploadFile({ name: 'Students.XLSX', size: 1000 }), null); assert.equal(validateUploadFile({ name: 'a.csv', size: 1 }), null);
});
