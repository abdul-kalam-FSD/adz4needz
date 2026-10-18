import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReceiptStorage } from '../src/lib/receipt-storage.js';

async function withStorage(fn) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'bde-receipts-'));
  const dir = path.join(base, 'nested', 'receipts');
  try { await fn(createReceiptStorage({ dir }), dir); } finally { await rm(base, { recursive: true, force: true }); }
}
const read = async (stream) => { const chunks = []; for await (const c of stream) chunks.push(c); return Buffer.concat(chunks); };

test('init creates the folder owner-only; save writes a 0600 file with a server-generated name', async () => {
  await withStorage(async (storage, dir) => {
    await storage.init();
    if (process.platform !== 'win32') {
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
    }
    const name = await storage.save(Buffer.from('hello'), 'png');
    assert.match(name, /^[0-9a-f-]{36}\.png$/);
    if (process.platform !== 'win32') {
      assert.equal((await stat(path.join(dir, name))).mode & 0o777, 0o600);
    }
    assert.deepEqual(await readdir(dir), [name]);
    assert.equal((await read(storage.openRead(name))).toString(), 'hello');
    assert.equal((await storage.stat(name)).size, 5);
  });
});
test('names are random per save (nothing from user input, no overwrite)', async () => {
  await withStorage(async (storage) => {
    await storage.init();
    const names = new Set(); for (let i = 0; i < 20; i++) names.add(await storage.save(Buffer.from('x'), 'pdf'));
    assert.equal(names.size, 20);
  });
});
test('any name that is not a generated one is refused (path traversal impossible)', async () => {
  await withStorage(async (storage) => {
    await storage.init();
    for (const bad of ['../secret.png', '..\\x.png', '/etc/passwd', 'a.png', 'x/y.png', '00000000-0000-0000-0000-000000000000.exe', '00000000-0000-0000-0000-000000000000.png/../../x', '', null, undefined, 5]) {
      assert.throws(() => storage.openRead(bad), /Invalid stored file/, String(bad));
      await assert.rejects(storage.remove(bad), /Invalid stored file/);
      await assert.rejects(storage.stat(bad), /Invalid stored file/);
    }
  });
});
test('remove deletes the file and is quiet when it is already gone; stat of a missing file rejects', async () => {
  await withStorage(async (storage, dir) => {
    await storage.init();
    const name = await storage.save(Buffer.from('x'), 'jpg');
    await storage.remove(name); await storage.remove(name);
    assert.deepEqual(await readdir(dir), []);
    await assert.rejects(storage.stat(name), (e) => e.code === 'ENOENT');
  });
});
test('saved bytes are stored unchanged', async () => {
  await withStorage(async (storage, dir) => {
    await storage.init();
    const buf = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    const name = await storage.save(buf, 'png');
    assert.ok(buf.equals(await readFile(path.join(dir, name))));
  });
});
