import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Words that are RESERVED in MySQL 8.0 (so they need backticks when used as a column or table name) and that are easy to use by accident.
// Regression: lead_import_rows.row_number made migration 012 fail with a syntax error on MySQL 8.
const RESERVED = ['row_number', 'rank', 'dense_rank', 'groups', 'lead', 'lag', 'first_value', 'last_value', 'nth_value', 'ntile', 'over', 'percent_rank',
  'cume_dist', 'window', 'system', 'empty', 'function', 'rows', 'recursive', 'lateral', 'except', 'json_table', 'of', 'read', 'write', 'usage', 'release', 'virtual', 'stored', 'interval', 'condition', 'schema', 'key', 'keys'];

const dir = new URL('../db/migrations/', import.meta.url);
const stripComments = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).map((l) => l.replace(/--.*$/, '')).join('\n');

test('no migration declares a column or table whose bare name is a MySQL 8 reserved word', () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = stripComments(readFileSync(new URL(f, dir), 'utf8')).replace(/`[^`]*`/g, '``');
    // Column definitions: a line that starts with an identifier followed by a SQL type.
    for (const m of sql.matchAll(/^\s*(?:ADD COLUMN\s+)?([a-z_][a-z0-9_]*)\s+(?:BIGINT|INT|SMALLINT|TINYINT|VARCHAR|CHAR|TEXT|LONGTEXT|DATE|DATETIME|DECIMAL|ENUM)\b/gim)) {
      assert.ok(!RESERVED.includes(m[1].toLowerCase()), `${f}: column "${m[1]}" is a reserved word; write it with backticks`);
    }
    for (const m of sql.matchAll(/CREATE TABLE\s+([a-z_][a-z0-9_]*)/gi)) assert.ok(!RESERVED.includes(m[1].toLowerCase()), `${f}: table ${m[1]}`);
  }
});

test('the quoted row_number column stays quoted in migration 012 and in every import query', () => {
  assert.match(readFileSync(new URL('012_lead_import_rows.sql', dir), 'utf8'), /`row_number`\s+INT UNSIGNED NOT NULL/);
  const repo = readFileSync(new URL('../src/modules/imports/imports.repository.js', import.meta.url), 'utf8');
  const bare = repo.split('\n').filter((l) => /(?<![`.\w])row_number(?![`\w])/.test(l.replace(/\\`row_number\\`|`row_number`/g, '')) && !/^\s*\/\//.test(l));
  assert.deepEqual(bare, [], 'unquoted row_number in the import repository');
  assert.ok(/\\`row_number\\`/.test(repo) && /`row_number`/.test(repo));
});
