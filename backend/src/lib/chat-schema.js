// Pure helpers (no database access) for scripts/chat-schema.js: they look at the COLUMN LISTS of the chat tables and say which
// shape each table has and what the operator should do next. The code in src/modules/chat/ expects the shape created by migrations
// 016_chat_messages, 017_chat_mentions and 018_chat_reads ("current"). An earlier chat design (a direct-message version) used the same
// table names with different columns ("legacy-dm"); a database that ran those old files cannot be fixed by the later CREATE TABLE files.

export const LEGACY_MESSAGES = 'chat_messages_legacy';
export const LEGACY_READS = 'chat_reads_legacy';
// Foreign-key names that migrations 016-018 create. Constraint names must be unique per database, so a renamed legacy table that still
// carries one of these names makes the later CREATE TABLE fail with ER_FK_DUP_NAME.
export const NEW_FK_NAMES = ['fk_chat_messages_sender', 'fk_chat_mentions_message', 'fk_chat_mentions_user', 'fk_chat_reads_user'];

const hasAll = (cols, names) => names.every((n) => cols.includes(n));

// cols: array of column names, or null/undefined when the table does not exist.
export function classifyMessages(cols) {
  if (!cols) return 'missing';
  if (hasAll(cols, ['id', 'sender_id', 'kind', 'body', 'client_request_id', 'created_at']) && !cols.includes('recipient_id')) return 'current';
  if (hasAll(cols, ['id', 'sender_id', 'recipient_id', 'body', 'created_at']) && !cols.includes('kind')) return 'legacy-dm';
  return 'unknown';
}
export function classifyReads(cols) {
  if (!cols) return 'missing';
  if (hasAll(cols, ['user_id', 'last_read_message_id', 'updated_at']) && !cols.includes('peer_id')) return 'current';
  if (hasAll(cols, ['user_id', 'peer_id', 'last_read_id', 'updated_at'])) return 'legacy-dm';
  return 'unknown';
}
export function classifyMentions(cols) {
  if (!cols) return 'missing';
  return hasAll(cols, ['message_id', 'start_pos', 'end_pos', 'user_id']) ? 'current' : 'unknown';
}

// Decides the single next step.
//   input: { messages, mentions, reads }  (each 'missing' | 'current' | 'legacy-dm' | 'unknown')
//          legacy: { messages: boolean, reads: boolean }  (do the *_legacy tables already exist?)
//          fkClash: boolean  (does a legacy table still carry a constraint name that migrations 016-018 need?)
//   output: { verdict, message }
// verdicts: ok | run-migrate | set-aside | import-legacy | unrecognised
export function diagnose({ messages, mentions, reads, legacy = {}, fkClash = false }) {
  const states = [messages, mentions, reads];
  if (states.includes('unknown')) {
    return { verdict: 'unrecognised', message: 'A chat table has columns this tool does not recognise. Change nothing; send the output of `npm run chat:schema` for review.' };
  }
  const oldMessages = messages === 'legacy-dm';
  const oldReads = reads === 'legacy-dm';
  if (oldMessages || oldReads) {
    // mentions must not exist yet: with legacy tables in place it could only come from a half-applied run, which needs a human look.
    if (mentions !== 'missing') return { verdict: 'unrecognised', message: 'Old-design chat tables exist together with a chat_mentions table. Change nothing; send the output of `npm run chat:schema` for review.' };
    if ((legacy.messages && oldMessages) || (legacy.reads && oldReads)) return { verdict: 'unrecognised', message: 'The *_legacy table names are already taken. Change nothing; send the output of `npm run chat:schema` for review.' };
    return { verdict: 'set-aside', message: 'Old-design chat tables found. Step 1: `npm run chat:schema -- set-aside --yes` (renames them, no rows are touched), then `npm run migrate`.' };
  }
  if (fkClash && (legacy.messages || legacy.reads)) {
    return { verdict: 'set-aside', message: 'A renamed legacy table still holds a constraint name that migration 018 needs. Run `npm run chat:schema -- set-aside --yes` to finish the rename, then `npm run migrate`.' };
  }
  if (messages === 'current' && mentions === 'current' && reads === 'current') {
    return legacy.messages
      ? { verdict: 'import-legacy', message: 'Schema is correct. Old messages are in chat_messages_legacy. To show the old team-channel messages in the chat, run `npm run chat:schema -- import-legacy --yes` (only works while chat_messages is still empty).' }
      : { verdict: 'ok', message: 'Chat schema matches what the code expects.' };
  }
  if (messages === 'missing' || mentions === 'missing' || reads === 'missing') {
    return { verdict: 'run-migrate', message: 'Chat tables are missing or incomplete. Run `npm run migrate` (it applies 016, 017 and 018).' };
  }
  return { verdict: 'unrecognised', message: 'Unexpected combination of chat tables. Change nothing; send the output of `npm run chat:schema` for review.' };
}
