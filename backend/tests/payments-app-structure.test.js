// Source-level guards for the security-sensitive wiring (no database or browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config/env.js';
import path from 'node:path';
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const app = read('../src/app.js');

test('the API serves no static files, so stored receipts can never be reached by URL', () => {
  for (const file of ['../src/app.js', '../src/server.js', '../src/modules/payments/payments.handlers.js']) assert.ok(!/express\.static|sendFile|serve-static/.test(read(file)), file);
});
test('only the receipt upload (BDE) and the lead-import upload (admin) are registered before the JSON-only guard, each authenticated and role-restricted', () => {
  const guard = app.indexOf('api.use(requireJsonBody)');
  assert.ok(guard > 0);
  const before = app.slice(0, guard);
  const writes = before.match(/api\.(post|put|patch|delete)\(/g) || [];
  assert.equal(writes.length, 4, 'only the receipt upload, the admin lead-import upload and the two admin lead-sheet uploads may bypass the JSON guard');
  assert.match(before, /api\.post\('\/admin\/lead-sheet\/preview', authenticate, authorize\('admin'\), importBody/);
  assert.match(before, /api\.post\('\/admin\/lead-sheet\/apply', authenticate, authorize\('admin'\), importBody/);
  assert.match(before, /api\.post\('\/admin\/imports', authenticate, authorize\('admin'\), importBody/);
  assert.match(before, /api\.post\('\/payment-instalments\/:id\/receipts', authenticate, authorize\('bde'\), receiptBody/);
  assert.match(before, /express\.raw\(\{ type: ALLOWED_RECEIPT_MIME, limit: config\.receiptMaxBytes \}\)/);
});
test('receipt file downloads are authenticated for both roles', () => {
  assert.match(app, /api\.get\('\/payment-receipts\/:id\/file', authenticate, authorize\('bde'\)/);
  assert.match(app, /adminRouter\.get\('\/payment-receipts\/:id\/file'/);
});
test('config: receipt folder defaults outside any served folder, max size is bounded, env overrides work', () => {
  const base = { DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' };
  const d = loadConfig(base);
  assert.equal(d.receiptDirIsDefault, true); assert.match(d.receiptStorageDir, /storage[\\/]receipts$/); assert.equal(d.receiptMaxBytes, 5 * 1024 * 1024);
  const c = loadConfig({ ...base, RECEIPT_STORAGE_DIR: '/var/lib/bde-app/receipts', RECEIPT_MAX_BYTES: '2097152' });
  assert.equal(
  c.receiptStorageDir,
  path.resolve('/var/lib/bde-app/receipts')
); assert.equal(c.receiptDirIsDefault, false); assert.equal(c.receiptMaxBytes, 2097152);
  for (const bad of ['abc', '10', '999999999999', '-5']) assert.throws(() => loadConfig({ ...base, RECEIPT_MAX_BYTES: bad }), /RECEIPT_MAX_BYTES/);
});

test('the frontend copies of the money and payment validators are identical to the backend ones (no drift)', () => {
  for (const f of ['money.js', 'validate-payment.js']) assert.equal(read(`../../frontend/src/lib/${f}`), read(`../src/lib/${f}`), f);
});
