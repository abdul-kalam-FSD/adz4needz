// Guards for the "Unknown column 'c.kind' / 'last_read_message_id'" failure. No database needed (the real-MySQL proof is in
// docs/migration-map.md, "Team chat table clash"). Root cause: several migration files created the SAME chat table with different columns,
// and the runner stops at the first CREATE TABLE that finds the table already there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  classifyMessages, classifyMentions, classifyReads, diagnose, NEW_FK_NAMES
} from '../src/lib/chat-schema.js';

const migDir = new URL('../db/migrations/', import.meta.url);
const strip = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const read = (f) => strip(readFileSync(new URL(f, migDir), 'utf8'));

// table name -> column names, from every CREATE TABLE in the migrations folder (ALTER ... ADD COLUMN adds to it).
function schemaFromMigrations() {
  const tables = {}; const creators = {};
  for (const f of files) {
    const sql = read(f);
    for (const m of sql.matchAll(/CREATE TABLE\s+`?([a-z_]+)`?\s*\(([\s\S]*?)\)\s*ENGINE/gi)) {
      (creators[m[1]] ||= []).push(f);
      tables[m[1]] = m[2].split('\n').map((l) => l.trim().match(/^`?([a-z_]+)`?\s+(?:BIGINT|INT|SMALLINT|TINYINT|VARCHAR|CHAR|TEXT|LONGTEXT|DATE|DATETIME|DECIMAL|ENUM)\b/i)).filter(Boolean).map((x) => x[1]);
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+`?([a-z_]+)`?\s+ADD COLUMN\s+`?([a-z_]+)`?/gi)) tables[m[1]]?.push(m[2]);
  }
  return { tables, creators };
}

test('every table is created by exactly ONE migration file (a second CREATE TABLE for the same name breaks the runner)', () => {
  const { creators } = schemaFromMigrations();
  for (const [table, list] of Object.entries(creators)) assert.deepEqual(list, [list[0]], `${table} is created by several files: ${list.join(', ')}`);
});

test('the three chat tables come from 016, 017 and 018, in that order, and nothing else creates a chat table', () => {
  const { creators } = schemaFromMigrations();
  assert.deepEqual(creators.chat_messages, ['016_chat_messages.sql']);
  assert.deepEqual(creators.chat_mentions, ['017_chat_mentions.sql']);
  assert.deepEqual(creators.chat_reads, ['018_chat_reads.sql']);
  assert.deepEqual(Object.keys(creators).filter((t) => t.startsWith('chat_')).sort(), ['chat_mentions', 'chat_messages', 'chat_reads']);
});

test('every column the chat repository reads or writes exists in the migrations (c.kind -> 016, last_read_message_id -> 018)', () => {
  const { tables } = schemaFromMigrations();
  const repo = readFileSync(new URL('../src/modules/chat/chat.repository.js', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const insertCols = (table) => [...repo.matchAll(new RegExp(`INSERT (?:IGNORE )?INTO ${table} \\(([^)]*)\\)`, 'g'))].flatMap((m) => m[1].split(',').map((c) => c.trim()));
  for (const t of ['chat_messages', 'chat_mentions', 'chat_reads']) {
    const cols = insertCols(t); assert.ok(cols.length > 0, `no INSERT found for ${t}`);
    for (const c of cols) assert.ok(tables[t].includes(c), `${t}.${c} is written by the code but no migration creates it`);
  }
  for (const c of ['id', 'sender_id', 'kind', 'body', 'created_at', 'client_request_id']) assert.ok(tables.chat_messages.includes(c), `chat_messages.${c}`);
  assert.ok(tables.chat_reads.includes('last_read_message_id') && tables.chat_reads.includes('user_id'));
  for (const c of ['message_id', 'start_pos', 'end_pos', 'user_id']) assert.ok(tables.chat_mentions.includes(c), `chat_mentions.${c}`);
  // the SELECTs name these columns too: if someone renames one in SQL only, this fails
  assert.match(repo, /c\.kind/); assert.match(repo, /last_read_message_id/);
});

test('constraint names that migrations 016-018 create are exactly the ones the doctor script protects (names are unique per database)', () => {
  const names = files.filter((f) => /^01[678]_chat_/.test(f)).flatMap((f) => [...read(f).matchAll(/CONSTRAINT\s+([a-z_]+)\s+FOREIGN KEY/gi)].map((m) => m[1])).sort();
  assert.deepEqual(names, [...NEW_FK_NAMES].sort());
});

test('classification: current, old-design (direct-message) and unknown shapes', () => {
  assert.equal(classifyMessages(['id', 'sender_id', 'kind', 'body', 'client_request_id', 'created_at']), 'current');
  assert.equal(classifyMessages(['id', 'sender_id', 'recipient_id', 'body', 'created_at']), 'legacy-dm');
  assert.equal(classifyMessages(['id', 'sender_user_id', 'kind', 'body', 'client_request_id', 'created_at', 'deleted_at']), 'unknown');
  assert.equal(classifyMessages(null), 'missing');
  assert.equal(classifyReads(['user_id', 'last_read_message_id', 'updated_at']), 'current');
  assert.equal(classifyReads(['user_id', 'peer_id', 'last_read_id', 'updated_at']), 'legacy-dm');
  assert.equal(classifyReads(['user_id']), 'unknown');
  assert.equal(classifyMentions(['message_id', 'start_pos', 'end_pos', 'user_id']), 'current');
  assert.equal(classifyMentions(['message_id', 'mentioned_user_id']), 'unknown');
  assert.equal(classifyMentions(undefined), 'missing');
});

test('diagnose: the exact failing database from the bug report leads to set-aside, never to an automatic change', () => {
  const broken = { messages: 'legacy-dm', mentions: 'missing', reads: 'legacy-dm', legacy: {}, fkClash: false };
  assert.equal(diagnose(broken).verdict, 'set-aside');
  assert.equal(diagnose({ messages: 'current', mentions: 'current', reads: 'current' }).verdict, 'ok');
  assert.equal(diagnose({ messages: 'missing', mentions: 'missing', reads: 'missing' }).verdict, 'run-migrate');
  assert.equal(diagnose({ messages: 'current', mentions: 'current', reads: 'current', legacy: { messages: true } }).verdict, 'import-legacy');
  assert.equal(diagnose({ messages: 'missing', mentions: 'missing', reads: 'missing', legacy: { messages: true, reads: true }, fkClash: true }).verdict, 'set-aside', 'finishes a half-done rename');
  for (const odd of [
    { messages: 'unknown', mentions: 'missing', reads: 'missing' },
    { messages: 'legacy-dm', mentions: 'current', reads: 'legacy-dm' },
    { messages: 'legacy-dm', mentions: 'missing', reads: 'legacy-dm', legacy: { messages: true } }
  ]) assert.equal(diagnose(odd).verdict, 'unrecognised', JSON.stringify(odd));
});

test('scripts/chat-schema.js never drops, deletes, truncates or edits migration history; writes only behind --yes', () => {
  const src = readFileSync(new URL('../scripts/chat-schema.js', import.meta.url), 'utf8');
  assert.ok(!/\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM)\b/i.test(src));
  assert.ok(!/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+schema_migrations/i.test(src));
  assert.match(src, /const yes = flags\.includes\('--yes'\)/);
  assert.equal((src.match(/if \(yes\)/g) || []).length, 2, 'both writing commands are guarded by --yes');
});

test('package.json exposes the doctor as "npm run chat:schema" (the docs and error messages tell people to run it)', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['chat:schema'], 'node --env-file=.env scripts/chat-schema.js');
});
