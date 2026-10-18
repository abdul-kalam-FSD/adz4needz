# Migration runner and the duplicate chat migration: findings and proposed resolution

Written 2026-10-18 from the files in `bde-app.zip` (original ZIP preserved, hash prefix b4f77199). **Nothing here has been applied to any database. No migration file was renamed, deleted, reordered or rewritten.**

## 1. What the migration runner actually does (verified in the current files)

`backend/scripts/migrate.js` is a complete runner with three commands (see the usage line and command table in the file):

| Command | Effect |
|---|---|
| `npm run migrate` (= `plan`, the default) | **Read-only.** Connects, reports which files are pending, recorded, drifted. Prints "Plan mode executed no SQL that changes anything." |
| `npm run migrate:apply -- --yes` | Runs pending files in order, one statement at a time, records a file in `schema_migrations` only after all its statements succeed. Refuses without `--yes`. |
| `npm run migrate -- record <file> --yes` | Records a file as applied **without running it**, only if every object it creates already exists. |

So the earlier observation that it "inspects files without executing them" matches the **default plan mode**. It is not a missing runner. Evidence it executes in apply mode: `applyMigrations()` in `src/lib/migrations.js` sends each parsed statement with `conn.query` and then inserts the filename into `schema_migrations`.

## 2. The real defect: a stale 21st file in the active folder

* `db/migrations/` holds **21** files; the tests, `docs/migration-map.md` and `db/migrations-superseded/README.md` all say the runner must see **20**.
* The extra file is `015_chat_messages.sql` (an old direct-message design: `recipient_id`, no `kind`). It is **byte-identical** to the copy in `db/migrations-superseded/015_chat_messages.sql` (checked with `cmp`), i.e. it was moved out in the project's own notes but a copy was left behind in the ZIP.
* Both `015_chat_messages.sql` and `016_chat_messages.sql` run `CREATE TABLE chat_messages`. Sorted by name the stale file runs first, so `016_chat_messages.sql` fails with `Table 'chat_messages' already exists`, the runner stops, and `017_chat_mentions` / `018_chat_reads` never run. This is a **file-set problem, independent of TiDB**; no evidence points at TiDB.
* Two files are also numbered 015 (`015_call_logs.sql`, `015_chat_messages.sql`). Removing the stale file also removes that clash.
* Effect on tests: 10 backend tests fail only because of this extra file (the "exactly 20 files", "one CREATE TABLE per table", "chat tables from 016/017/018", and the migration-runner simulations). They are left failing on purpose; they are correct.

## 3. Read-only check to run first

Run `backend/scripts/migration-records-check.sql` (SELECT statements only) and send back the result rows, plus the output of `npm run migrate` (plan mode). Do not include connection details.

## 4. Proposed resolution, by what the database turns out to contain

| What you find | Safest action | DB change? |
|---|---|---|
| `015_chat_messages.sql` **not** in `schema_migrations`, and `chat_messages` missing or already has `kind` | Remove the stale file from `db/migrations/` (the identical copy stays in `migrations-superseded/`). Re-run `npm run migrate`, review the plan, then `migrate:apply -- --yes` after your approval. | Only the pending files you approve |
| `015_chat_messages.sql` **is** recorded and `chat_messages` has `recipient_id` (old shape) | Removing the file is still safe for the runner (it ignores recorded names that have no file). But the table has the wrong columns for the code. If `chat_messages_rows` = 0 a replacement migration is simple; if it holds messages a data-preserving migration is needed. **Stop and decide together**; no DROP without explicit approval. | Needs your approval and a written plan |
| Both chat files fail at plan time for another reason | Send the plan output; do not edit files. | None |

**Proposed file operation (not performed):** delete `backend/db/migrations/015_chat_messages.sql`. Risk: none for a fresh database; for a database that recorded the name see row 2. After it, `npm test` should report the 10 migration tests green.

## 5. Numbering (left unresolved as you asked)

This tree numbers Call desk as 015 and chat as 016 to 018. Earlier decisions for the project used 017/018/019 for call logs, call-log audit and status events and 020 for the chat extension. The two schemes are not compatible. Nothing was renumbered; decide before any new migration is written. Features added in this change set need **no** new migration.
