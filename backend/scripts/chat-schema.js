
 // Team chat schema doctor.
// Run from backend/:
//   npm run chat:schema
//   npm run chat:schema -- set-aside
//   npm run chat:schema -- set-aside --yes
//   npm run chat:schema -- import-legacy
//   npm run chat:schema -- import-legacy --yes
//
// Default check is read-only.
// Only --yes enables set-aside or legacy import changes.
// This script never drops tables or deletes rows.

import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config/env.js';

import {
  classifyMessages,
  classifyMentions,
  classifyReads,
  diagnose,
  LEGACY_MESSAGES,
  LEGACY_READS,
  NEW_FK_NAMES,
} from '../src/lib/chat-schema.js';

const [command = 'check', ...flags] = process.argv.slice(2);
const yes = flags.includes('--yes');

if (
  !['check', 'set-aside', 'import-legacy'].includes(command) ||
  flags.some((flag) => flag !== '--yes')
) {
  console.error(
    'Usage: chat-schema.js [check | set-aside [--yes] | import-legacy [--yes]]'
  );
  process.exit(1);
}

let config;

try {
  config = loadConfig();
} catch (err) {
  console.error('Configuration error:', err.message);
  process.exit(1);
}

// TiDB Cloud TLS certificate.
const caPath = path.resolve(
  process.cwd(),
  'certs',
  'isrgrootx1.pem'
);

if (config.db.ssl && !fs.existsSync(caPath)) {
  console.error('TLS CA certificate not found:', caPath);
  process.exit(1);
}

let conn;

try {
  conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',

    ...(config.db.ssl
      ? {
          ssl: {
            minVersion: 'TLSv1.2',
            ca: fs.readFileSync(caPath, 'utf8'),
            rejectUnauthorized: true,
          },
        }
      : {}),
  });
} catch (err) {
  console.error(
    'Cannot connect to database:',
    err.code || err.message
  );
  process.exit(1);
}

const q = async (sql, params = []) =>
  (await conn.query(sql, params))[0];

async function columnsOf(table) {
  const rows = await q(
    `SELECT column_name AS c
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
      ORDER BY ordinal_position`,
    [table]
  );

  return rows.length ? rows.map((row) => row.c) : null;
}

async function foreignKeysOf(table) {
  return q(
    `SELECT
       constraint_name AS name,
       column_name AS col,
       referenced_table_name AS ref,
       referenced_column_name AS refcol
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND referenced_table_name IS NOT NULL
     ORDER BY constraint_name, ordinal_position`,
    [table]
  );
}

async function snapshot() {
  const [
    messages,
    mentions,
    reads,
    legacyMessages,
    legacyReads,
  ] = await Promise.all(
    [
      'chat_messages',
      'chat_mentions',
      'chat_reads',
      LEGACY_MESSAGES,
      LEGACY_READS,
    ].map(columnsOf)
  );

  let fkClash = false;

  for (
    const table of [
      legacyMessages && LEGACY_MESSAGES,
      legacyReads && LEGACY_READS,
    ].filter(Boolean)
  ) {
    const foreignKeys = await foreignKeysOf(table);

    if (
      foreignKeys.some((fk) => NEW_FK_NAMES.includes(fk.name))
    ) {
      fkClash = true;
    }
  }

  return {
    cols: {
      messages,
      mentions,
      reads,
      legacyMessages,
      legacyReads,
    },
    input: {
      messages: classifyMessages(messages),
      mentions: classifyMentions(mentions),
      reads: classifyReads(reads),
      legacy: {
        messages: Boolean(legacyMessages),
        reads: Boolean(legacyReads),
      },
      fkClash,
    },
  };
}

const line = (label, columns, state) => {
  console.log(
    `  ${label.padEnd(22)} ${state.padEnd(10)} ${
      columns ? columns.join(', ') : '(table does not exist)'
    }`
  );
};

try {
  const snap = await snapshot();
  const diagnosis = diagnose(snap.input);

  const applied = await q(
    `SELECT filename
       FROM schema_migrations
      WHERE filename LIKE '015%'
         OR filename LIKE '016%'
         OR filename LIKE '017%'
         OR filename LIKE '018%'
         OR filename LIKE '019%'
      ORDER BY filename`
  ).catch(() => null);

  if (command === 'check') {
    console.log(
      `Database: ${config.db.database} on ${config.db.host}:${config.db.port}`
    );
    console.log('Mode: read-only check; nothing is changed');

    console.log(
      'Recorded migrations 015-019:',
      applied
        ? applied.map((row) => row.filename).join(', ') || '(none)'
        : '(schema_migrations not readable)'
    );

    console.log('Chat tables:');

    line(
      'chat_messages',
      snap.cols.messages,
      snap.input.messages
    );

    line(
      'chat_mentions',
      snap.cols.mentions,
      snap.input.mentions
    );

    line(
      'chat_reads',
      snap.cols.reads,
      snap.input.reads
    );

    if (snap.cols.legacyMessages || snap.cols.legacyReads) {
      line(
        LEGACY_MESSAGES,
        snap.cols.legacyMessages,
        'legacy'
      );

      line(
        LEGACY_READS,
        snap.cols.legacyReads,
        'legacy'
      );
    }

    console.log(
      `\nVerdict: ${diagnosis.verdict}\n${diagnosis.message}`
    );

    process.exitCode = diagnosis.verdict === 'ok' ? 0 : 2;
  }

  if (command === 'set-aside') {
    if (diagnosis.verdict !== 'set-aside') {
      console.error(
        `Nothing to do or not safe here (verdict: ${diagnosis.verdict}).\n${diagnosis.message}`
      );

      process.exitCode = 2;
    } else {
      const rename = [];

      if (snap.input.messages === 'legacy-dm') {
        rename.push(`chat_messages TO ${LEGACY_MESSAGES}`);
      }

      if (snap.input.reads === 'legacy-dm') {
        rename.push(`chat_reads TO ${LEGACY_READS}`);
      }

      const plan = [];

      if (rename.length) {
        plan.push(`RENAME TABLE ${rename.join(', ')}`);
      }

      // Preserve legacy rows while avoiding conflicting FK names.
      const fkFixes = [];

      for (const table of [LEGACY_MESSAGES, LEGACY_READS]) {
        const exists =
          (table === LEGACY_MESSAGES
            ? snap.cols.legacyMessages
            : snap.cols.legacyReads) ||
          rename.some((item) => item.endsWith(` TO ${table}`));

        if (!exists) continue;

        const source =
          table === LEGACY_MESSAGES
            ? 'chat_messages'
            : 'chat_reads';

        const sourceWillRename = rename.some(
          (item) => item.endsWith(` TO ${table}`)
        );

        const foreignKeys = await foreignKeysOf(
          sourceWillRename ? source : table
        );

        for (
          const fk of foreignKeys.filter(
            (item) => NEW_FK_NAMES.includes(item.name)
          )
        ) {
          if (
            foreignKeys.filter((item) => item.name === fk.name)
              .length !== 1
          ) {
            throw new Error(
              `Constraint ${fk.name} spans several columns; not handled. Nothing changed.`
            );
          }

          fkFixes.push(
            `ALTER TABLE ${table} DROP FOREIGN KEY ${fk.name}, ` +
            `ADD CONSTRAINT ${fk.name}_legacy ` +
            `FOREIGN KEY (${fk.col}) REFERENCES ${fk.ref} (${fk.refcol})`
          );
        }
      }

      plan.push(...fkFixes);

      console.log(
        yes
          ? 'Applying planned changes:'
          : 'Dry run. Would execute (add --yes to apply):'
      );

      plan.forEach((statement) =>
        console.log(`  ${statement};`)
      );

      if (yes) {
        for (const statement of plan) {
          await conn.query(statement);
        }

        console.log(
          'Set-aside completed. Do not run migrations until the migration files have been reviewed.'
        );
      }
    }
  }

  if (command === 'import-legacy') {
    const ready =
      snap.input.messages === 'current' &&
      snap.input.reads === 'current' &&
      snap.input.mentions === 'current' &&
      snap.cols.legacyMessages &&
      classifyLegacyOk(snap);

    if (!ready) {
      console.error(
        'Not ready: current chat tables must be correct and chat_messages_legacy must exist.'
      );

      process.exitCode = 2;
    } else {
      const [{ n: existing }] = await q(
        'SELECT COUNT(*) AS n FROM chat_messages'
      );

      if (Number(existing) > 0) {
        console.error(
          `Refused: chat_messages already contains ${existing} message(s). Nothing changed.`
        );

        process.exitCode = 2;
      } else {
        const [{ team }] = await q(
          `SELECT COUNT(*) AS team
             FROM ${LEGACY_MESSAGES}
            WHERE recipient_id IS NULL`
        );

        const [{ dm }] = await q(
          `SELECT COUNT(*) AS dm
             FROM ${LEGACY_MESSAGES}
            WHERE recipient_id IS NOT NULL`
        );

        console.log(
          `${yes ? 'Importing' : 'Dry run. Would import'} ${team} team-channel message(s). ` +
          `${dm} direct message(s) remain in ${LEGACY_MESSAGES}.`
        );

        if (yes) {
          await conn.beginTransaction();

          try {
            await conn.query(
              `INSERT INTO chat_messages
                 (id, sender_id, kind, body, client_request_id, created_at)
               SELECT
                 id, sender_id, 'message', body, UUID(), created_at
               FROM ${LEGACY_MESSAGES}
               WHERE recipient_id IS NULL
               ORDER BY id`
            );

            if (snap.cols.legacyReads) {
              await conn.query(
                `INSERT IGNORE INTO chat_reads
                   (user_id, last_read_message_id, updated_at)
                 SELECT
                   user_id,
                   LEAST(
                     last_read_id,
                     (SELECT COALESCE(MAX(id), 0) FROM chat_messages)
                   ),
                   updated_at
                 FROM ${LEGACY_READS}
                 WHERE peer_id = 0`
              );
            }

            await conn.commit();
            console.log('Legacy import completed.');
          } catch (err) {
            await conn.rollback();
            throw err;
          }
        }
      }
    }
  }
} catch (err) {
  console.error(
    'chat-schema failed:',
    err.code || '',
    err.message
  );

  process.exitCode = 1;
} finally {
  await conn.end();
}

function classifyLegacyOk(snap) {
  return (
    classifyMessages(snap.cols.legacyMessages) === 'legacy-dm' &&
    (
      !snap.cols.legacyReads ||
      classifyReads(snap.cols.legacyReads) === 'legacy-dm'
    )
  );
}
