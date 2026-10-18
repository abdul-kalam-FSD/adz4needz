# Migration map (merged tree, "Option C": nothing renamed)

**Status: this file describes the files in `backend/db/migrations/`. No migration has been run against any database for this merged tree, and the claims about what the runner would do on an existing database come from reading `scripts/migrate.js` and the SQL files, not from running them.**

## Why there are two files numbered 007 and two numbered 008

Phase 6 (Payments) and Module 1 (Profile) were developed separately and each added migrations starting at 007. Their file names differ, their contents differ, and neither set depends on the other (Module 1 only adds two nullable columns to `users`; Phase 6 only adds payment tables and changes a column comment on `interviews`). Migrations 001-006 are byte-identical in both lines.

The merge uses **Option C: no migration file was renamed and no file content was changed.** The reason is that the runner records each applied file by its **full file name** in `schema_migrations(filename, applied_at)`, so the names already recorded in an existing database (from either line) stay valid and are never seen as new. The price is that the numeric prefixes 007 and 008 are no longer unique. Always refer to these files by their full name, never by "migration 007".

## Order in which a fresh database is built

`scripts/migrate.js` reads every `*.sql` file in the folder, sorts the names alphabetically and applies each file that is not yet recorded. Alphabetically `007_payments` comes before `007_users_phone` (p before u), and `008_payment_instalments` before `008_users_email`.

| # | File | From | What it does | SHA-256 |
|---|---|---|---|---|
| 1 | `001_users_sessions.sql` | both (identical) | users and sessions tables | `c9417b0f5dce70f5d0c8ef081f106c2fe3088dcffacf2c58cacaefea4c6068f6` |
| 2 | `002_daily_reports.sql` | both (identical) | daily reports | `ad431b645d96b5fb980f7b7e262bc08c3d8e65828907e96ed04eaa92ad342e3b` |
| 3 | `003_lead_statuses_leads.sql` | both (identical) | lead statuses and leads | `497538be967fa7dc4fe7eb68e067c53bb177f2c0b533c56142dc9aa2e2a683d5` |
| 4 | `004_seed_proposed_lead_statuses.sql` | both (identical) | proposed lead statuses | `d4e29a8940dfacecfd71f3de6a260d38a84057876761e2bab5cb4fa995675c0b` |
| 5 | `005_leads_id_user_unique_key.sql` | both (identical) | unique key on leads (id, user_id) | `d9c3de2b0e0765cc6f38de4c5591741a329eda263feba99d41f5628ccf640098` |
| 6 | `006_interviews.sql` | both (identical) | interviews | `73105662c136aced579cff0efc1705a0e3f1e379c95ff1dc9b3f802a4395caaa` |
| 7 | `007_payments.sql` | Phase 6 | payment commitments (needs MySQL 8.0.16+) | `67ed6ff36f63a0d8a4ac7daaf3fc15f23296018e388490e79ce5815b27f39fb3` |
| 8 | `007_users_phone.sql` | Module 1 | adds nullable `users.phone` | `6b31e35dc09ab78c5edb0a987133da856a395f5b29eae84405344f7a95ad3a53` |
| 9 | `008_payment_instalments.sql` | Phase 6 | payment instalments | `dd56f578e19f1dd103a9cc8c3f26cedf9ddcb57883757033aff0cae3c4a7f6b0` |
| 10 | `008_users_email.sql` | Module 1 | adds nullable `users.email` | `43375a84914f4974cdc0d1ca7bdc8feff0054e40acb090e3b19d9751ef3a850e` |
| 11 | `009_payment_receipts.sql` | Phase 6 | payment proof (receipt) metadata | `703684e3eec080dd811d84bfa174b53d5a8a7d6e255fd13e6134405ceb6266bc` |
| 12 | `010_deprecate_interview_payment_flag.sql` | Phase 6 | comment change on `interviews.payment_confirmed` (the column and its data are kept) | `2f0b0fd0b2fbb53dc31d5f0b4f863e7258d069815b9fffe346f42ee1f3451728` |

`tests/profile-wiring.test.js` pins this exact list and these exact hashes, so adding, renaming or editing any of these files makes that test fail until the list is deliberately updated.

## What `npm run migrate` should do on each kind of existing database (from reading the runner, NOT run)

| The database already has | Expected result |
|---|---|
| nothing, or only 001-006 | applies the files in the order above |
| Phase 6's four files (007_payments ... 010) | skips them and applies `007_users_phone` and `008_users_email` |
| Module 1's two files (007_users_phone, 008_users_email) | skips them and applies `007_payments`, `008_payment_instalments`, `009_payment_receipts`, `010_deprecate_...` |
| both sets | skips all twelve |
| only part of a set, or `schema_migrations` rows that do not match the real schema | **do not run the migration.** Have the output of the lineage queries reviewed first |

The runner sends each file as it is and records it afterwards. A statement that fails changes nothing, but it stops the run and blocks every later file until the cause is fixed (for example a table that already exists although the file is not recorded).

## Before anyone runs `npm run migrate` on a real database

1. Back it up.
2. Check which database `backend/.env` points at (`DB_HOST`, `DB_NAME`).
3. Look at what it already contains, read-only (after `USE <db>;`):

```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY filename;
SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()
  AND table_name IN ('schema_migrations','payments','payment_instalments','payment_receipts','interviews');
SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE()
  AND table_name = 'users' AND column_name IN ('phone','email');
SELECT column_comment FROM information_schema.columns WHERE table_schema = DATABASE()
  AND table_name = 'interviews' AND column_name = 'payment_confirmed';
SELECT VERSION();
```

4. Try it first on a disposable copy, never first on production.

## Rules for later migrations

- New migrations start at `011_` or higher, so they sort after all twelve files above.
- Never rename or edit a migration file that has been applied anywhere; the file name is the record.
- Do not use two files with the same number again. If numbers must be reused for some reason, write down the order here.


## Migrations added after the merge (not applied to any database yet)

| File | Origin | SHA-256 |
|---|---|---|
| 011_lead_import_batches.sql | added after the merge | `a99157b12ce632f98001daa428a48d548dda8e0de7cafe00095f930e784cb148` |
| 012_lead_import_rows.sql | added after the merge | `a1bc7d2c4da0389e403c9ae84e117d50cf33ff0c23c9611c881237a5cbab03b8` |
| 013_monthly_targets.sql | added after the merge | `15e2b4767c43e28de8a0f0fa79d15d0a32ba4f14d6c17076630f6026c5230fcb` |
| 014_receipt_review.sql | added after the merge | `b0a41fed26002a744b49cfba93a8e5cd4a81e75116f65b4fc0171486928db508` |
| 015_call_logs.sql | added after the merge (Call desk) | `a134a8d0a4879164c5eed17eef522e7617cf9f34a1e9c84f0f8676aedcdd9cd0` |
| 016_chat_messages.sql | added after the merge (Team chat) | `07bf1b6eae544578380c894e173090822ad36b37b9c17c78fd817fe887fe6ba1` |
| 017_chat_mentions.sql | added after the merge (Team chat) | `e363d9b6aae58a1e432619103996ad1de182da7b4bb6a458edb84bbb229e23af` |
| 018_chat_reads.sql | added after the merge (Team chat) | `0ad076c84c475cb48b3276b5b65fc759dff31f28a0859346601a87572189d9d5` |

They sort after 010, so `npm run migrate` applies them last. Each file holds a single statement (MySQL DDL is not transactional). 011 and 012: Excel/CSV import staging; 013: monthly targets; 014: payment-proof review columns; 015: call log (one row per recorded call; additive, a new table only); 016 to 018: team chat (messages, mentions, read cursors; each a new table only, one statement per file).


## Team chat table clash (found 2026-10-16)

**Symptom:** chat list and unread endpoints fail with `Unknown column 'c.kind'` and `Unknown column 'last_read_message_id'`.

**Cause:** the migrations folder also held three files from earlier chat designs: `015_chat_messages.sql`, `016_chat_reads.sql` and `016_team_chat.sql`.
They create the same tables as `016_chat_messages.sql` / `018_chat_reads.sql` with different columns. A database that ran the old files has
`chat_messages(recipient_id, no kind)` and `chat_reads(peer_id, last_read_id)`. The runner then stops at `016_chat_messages.sql`
(`Table 'chat_messages' already exists`) and records nothing, so 017 and 018 never run. The same stop happens on a brand-new database,
because `015_chat_messages.sql` sorts before `016_chat_messages.sql`. `tests/profile-wiring.test.js` already pinned the intended list of 20 files; with the
three extra files it failed.

**Which migration owns which column (the code is correct; nothing in `src/` references the old columns):**

| Column the code needs | Created by |
|---|---|
| `chat_messages.kind`, `client_request_id`, unique key on (sender_id, client_request_id) | `016_chat_messages.sql` |
| `chat_mentions` (`start_pos`, `end_pos`, `user_id`) | `017_chat_mentions.sql` |
| `chat_reads.last_read_message_id` | `018_chat_reads.sql` |

Those files are `CREATE TABLE` files, so on a database that already holds old-shape tables they can never add the columns. A new `ALTER`
migration is not the fix either: the old `chat_messages` also holds direct messages (`recipient_id` not null), which would then appear in the shared
channel, and the runner would stop at 016 before reaching any later file.

**Fix (forward-only, no history edited, nothing dropped):**

1. The three old files moved to `db/migrations-superseded/`. The folder is again exactly the 20 files pinned by `profile-wiring.test.js`.
2. `npm run chat:schema` (read-only) reports the real shape of the chat tables.
3. Only if it reports old-design tables: `npm run chat:schema -- set-aside --yes` renames them to `chat_messages_legacy` / `chat_reads_legacy`
   (rows untouched) and gives the legacy `fk_chat_reads_user` constraint a new name, because constraint names are unique per database
   (verified: without that step 018 fails with `ER_FK_DUP_NAME`). Then `npm run migrate` creates the correct tables.
4. Optional: `npm run chat:schema -- import-legacy --yes` copies the old **team-channel** messages (same ids) and read positions into the new tables in one transaction. Direct messages are
   never copied; they stay in `chat_messages_legacy`. It refuses if `chat_messages` already has rows.

**What was actually run (scratch MySQL 8.0.46 in the authoring sandbox, never your database):** reproduced both errors with the real repository code
on a database built from the old files; the shipped folder fails at 016; after the steps above all three repository queries work, 4 legacy messages and 3 legacy cursors were kept,
3 team messages were imported, the direct message did not leak, and `tests-integration/chat.db.test.js` passed 10 of 10.
**Not run:** anything against the real `bde_team_management` database.

Rule added: a table is created by exactly one migration file (`tests/chat-schema.test.js` enforces it).


## Verification record (2026-10-17, scratch MySQL 8.0.46 on port 3399; never your database)

- The supplied ZIP still had the three superseded chat files inside `db/migrations/` and a bare `row_number` in `012_lead_import_rows.sql` and in
  `imports.repository.js`. On real MySQL 8.0.46 `012` fails with a syntax error, and a database built from the old chat files fails with exactly
  `Unknown column 'c.kind'` / `Unknown column 'last_read_message_id'`. Both were reproduced with the real repository code.
- Changes: the three old files and their README moved to `db/migrations-superseded/` (nothing deleted); `row_number` backticked in `012` and in the three
  import queries (same SQL meaning, same file name, so `schema_migrations` records stay valid; its SHA-256 above was updated); `npm run chat:schema`
  script added to `package.json` (`scripts/chat-schema.js` existed but could not be started with that command).
- Old-design database: backup, `set-aside --yes`, `migrate` (applies 016, 017, 018), `import-legacy --yes`. Result: 4 legacy messages and 3 legacy cursors kept in
  `*_legacy`; 3 team messages imported with the same ids; the direct message did not appear in the channel; the user's cursor and unread count carried over.
- Fresh database: all 20 migrations apply, a second run applies 0.
- Backend `npm test`: 523/523. `test:db` (80 tests) on a fresh DB: 79 pass, 1 fail (see Known issue). New
  `tests-integration/chat-schema-shape.db.test.js` (4 tests) passes on fresh and repaired databases and fails 4/4 on the pre-repair legacy database.

Known issue, not touched (call desk, not chat): `tests-integration/call-logs.db.test.js` test 6 expects `/admin/call-stats` to report 3 unique leads after one
call was undone; the API reports 2 (the undone lead has no counted call left). Which number is intended is a business-rule decision for the owner.
