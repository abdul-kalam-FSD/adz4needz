import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffReceiptType, declaredMime, sanitizeFileName, ALLOWED_RECEIPT_MIME } from '../src/lib/receipt-file.js';

const pad = (head, n = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(n)]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PDF = pad('%PDF-1.7\n');

test('type is detected from the first bytes: JPEG, PNG, PDF', () => {
  assert.equal(sniffReceiptType(PNG), 'image/png'); assert.equal(sniffReceiptType(JPG), 'image/jpeg'); assert.equal(sniffReceiptType(PDF), 'application/pdf');
  assert.deepEqual(ALLOWED_RECEIPT_MIME.sort(), ['application/pdf', 'image/jpeg', 'image/png']);
});
test('everything else is refused, whatever the name or header claims', () => {
  const bad = { html: pad('<!DOCTYPE html><script>alert(1)</script>'), svg: pad('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), gif: pad('GIF89a'), webp: pad('RIFF\0\0\0\0WEBPVP8 '),
    exe: pad('MZ\x90\x00'), zip: pad('PK\x03\x04'), text: pad('hello world, this is not a receipt'), empty: Buffer.alloc(0), tiny: Buffer.from([0xff, 0xd8, 0xff]), almostPng: pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]) };
  for (const [name, buf] of Object.entries(bad)) assert.equal(sniffReceiptType(buf), null, name);
  for (const v of [null, undefined, 'string', 123, {}, []]) assert.equal(sniffReceiptType(v), null);
});
test('declaredMime normalises the header', () => {
  assert.equal(declaredMime('IMAGE/PNG; charset=binary'), 'image/png'); assert.equal(declaredMime(' application/pdf '), 'application/pdf');
  assert.equal(declaredMime(undefined), ''); assert.equal(declaredMime(['image/png']), '');
});
test('sanitizeFileName: display only, never a path', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('C:\\Users\\me\\receipt 1.png'), 'receipt 1.png');
  assert.equal(sanitizeFileName('a\u0000b\r\n.png'), 'ab.png');
  assert.equal(sanitizeFileName('<script>alert(1)</script>.png'), 'script_.png', 'only what follows the last slash survives');
  assert.equal(sanitizeFileName('<img onerror=alert(1)>.png'), '_img onerror_alert(1)_.png', 'markup characters are replaced');
  assert.equal(sanitizeFileName('..hidden'), 'hidden'); assert.equal(sanitizeFileName('...'), 'receipt');
  assert.equal(sanitizeFileName(undefined), 'receipt'); assert.equal(sanitizeFileName(['x']), 'receipt'); assert.equal(sanitizeFileName(''), 'receipt');
  assert.equal(sanitizeFileName('रसीद.pdf'), 'रसीद.pdf', 'letters of any script are kept, including combining vowel signs');
  assert.equal(sanitizeFileName('ரசீது 1.png'), 'ரசீது 1.png', 'Tamil');
  const long = sanitizeFileName('x'.repeat(500) + '.png');
  assert.ok(long.length <= 100 && long.endsWith('.png'));
  for (const name of ['../a', 'a/b', 'a\\b', '/abs']) assert.ok(!/[\\/]/.test(sanitizeFileName(name)));
});
