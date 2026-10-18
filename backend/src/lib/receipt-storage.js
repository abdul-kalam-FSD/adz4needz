// Stores receipt files on the server's disk, OUTSIDE any web-served folder (the API serves no static files; files are
// only streamed by authenticated endpoints). File names are random UUIDs generated here, so user input never reaches a path.
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$/;

export function createReceiptStorage({ dir }) {
  const root = path.resolve(dir);
  const locate = (name) => {
    if (typeof name !== 'string' || !STORED_NAME.test(name)) throw new Error('Invalid stored file name');
    const full = path.join(root, name);
    if (path.dirname(full) !== root) throw new Error('Invalid stored file path'); // belt and braces
    return full;
  };
  return {
    root,
    // Owner-only permissions: directory 0700, files 0600 (subject to the process umask, which can only remove more).
    async init() { await mkdir(root, { recursive: true, mode: 0o700 }); },
    async save(buffer, ext) {
      const name = `${randomUUID()}.${ext}`;
      await writeFile(locate(name), buffer, { flag: 'wx', mode: 0o600 }); // 'wx': never overwrite
      return name;
    },
    async stat(name) { return stat(locate(name)); },
    openRead(name) { return createReadStream(locate(name)); },
    async remove(name) { try { await unlink(locate(name)); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
  };
}
