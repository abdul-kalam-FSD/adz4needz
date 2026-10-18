# Superseded chat migrations (NOT run by `npm run migrate`)

The runner only reads `db/migrations/`. These three files come from earlier designs of the team chat and were moved out of that folder
because they create the same tables (`chat_messages`, `chat_reads`) that `016_chat_messages.sql` and `018_chat_reads.sql` create, with different
columns. Left in place they make `npm run migrate` stop with `Table 'chat_messages' already exists`, and a database that ran them has chat
tables the code cannot read (`Unknown column 'c.kind'`, `Unknown column 'last_read_message_id'`).

| File | Old design |
|---|---|
| `015_chat_messages.sql` | direct messages: `chat_messages(recipient_id, ...)`, no `kind` |
| `016_chat_reads.sql` | `chat_reads(peer_id, last_read_id)` |
| `016_team_chat.sql` | `chat_messages(sender_user_id, kind 'chat'/'announcement', deleted_at)` + a different `chat_mentions` |

Kept only as a record. Do not move them back. A database that already recorded one of these names in `schema_migrations` keeps that row;
the runner ignores recorded names that no longer exist as files. See `docs/migration-map.md`, "Team chat table clash".
