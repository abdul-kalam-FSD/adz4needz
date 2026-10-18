# Profile module: decisions, limits and recovery

Scope of this module: view your own profile, edit phone and email, change your password. Nothing else.

**Verification status (read this first):** unit tests with fake repositories (`npm test`) cover the logic. In addition, the module was run in a Linux sandbox against a **throwaway MySQL 8.0.46** (migrations on an empty database and on existing data, the database tests, the smoke test, the production build) and in **headless Chromium 141** against the production build. The exact record is in "Verification record" below. It was **not** run on a production-like server (HTTPS, proxy, secure cookies), with other MySQL/MariaDB versions or configurations, in Firefox or Safari, under load, or by real users.

**Merged-tree status (added during the Phase 6 + Module 1 integration):** every result in this document, including the verification record near the end (43/43, 227/227, 45/45, 62/62 and so on), was obtained on the standalone Module 1 checkpoint tree BEFORE it was combined with Phase 6. No database test, migration run, smoke run, production build or browser check has been run on the merged tree for this document. In particular the login-race database test has not been run on the merged tree. Merged-tree unit test results, if any, are recorded only in the Stage 1 verification report. See `docs/integration-notes.md`.

## What can be edited
- **Editable:** phone, email (both optional; empty clears the field).
- **Read-only:** name, employee ID, role. The API rejects (400) any request that contains another field, instead of ignoring it.
- A user can only ever read or change **their own** record. The id always comes from the login session, never from the URL or request body.
- Responses contain only: `id, employeeId, name, role, phone, email, createdAt`. Password hashes and session tokens are never returned.

## Database (migrations 007 and 008)
- `007_users_phone.sql`: `ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL`
- `008_users_email.sql`: `ALTER TABLE users ADD COLUMN email VARCHAR(254) NULL`
- Merged tree (Option C, no renames): these two files share their numeric prefixes with Phase 6's `007_payments.sql` and `008_payment_instalments.sql`. The runner orders and records files by their full name, so all four are applied (`007_payments`, then `007_users_phone`, then `008_payment_instalments`, then `008_users_email`). See `docs/migration-map.md`.
- Additive and nullable; existing rows and existing code are unaffected (nothing else reads these columns and no query uses `SELECT *` on `users`). One statement per file (MySQL DDL is not transactional).
- The migration runner (`scripts/migrate.js`) sends each file to MySQL as it is, applies files in name order, and records each in `schema_migrations` afterwards. If an `ALTER` succeeds but the record insert fails, a re-run stops with "Duplicate column name": check that the column exists, then insert the missing `schema_migrations` row by hand. (Simulated on MySQL 8.0.46: the runner stopped with exit code 1 and `Duplicate column name 'phone'`, nothing else changed, and after inserting the row by hand the runner skipped all 8 migrations.)
- **Run `npm run migrate` before starting the new code** against an existing database. Until 007 and 008 are applied, `GET/PATCH /api/profile` fail with a server error because the columns do not exist. Login, daily reports, leads and interviews do not use these columns and keep working.
- Back up (`mysqldump`) before migrating a database that holds real data. There are no "down" migrations. Undo = drop the two columns (loses only the stored phone/email values).
- The migration user needs the `ALTER` privilege (the README `GRANT` includes it).

## Change password: what the API guarantees
Order of operations. These are deliberately separate SQL statements, each committed on its own through the plain `db.query` path. They do not use the transaction helper that the payments module uses (`db.transaction()` in `src/db/pool.js`, added by Phase 6):

1. Verify the current password; hash the new one. (Nothing has changed yet.)
2. Delete the user's **other** sessions (all except the one making the request).
   If this fails: stop. The update is never sent, so the password is **not** changed (`500 SESSION_INVALIDATION_FAILED`). Safe to retry.
3. **Compare-and-set** the password hash: `UPDATE users SET password_hash = <new> WHERE id = <id> AND BINARY password_hash = <the hash verified in step 1>`.

   | Result | Meaning | API answer |
   |---|---|---|
   | 1 row | changed | continue to step 4 |
   | 0 rows | the hash changed after it was verified (another request, an admin); this request changed nothing | `409 PASSWORD_CHANGED_CONCURRENTLY` |
   | the server refused the statement (an SQLSTATE came back, connection still usable) | not changed | `500 PASSWORD_UPDATE_FAILED` |
   | connection lost, timeout, or an unexpected driver result | **unknown**: MySQL may have committed before the answer was lost | `500 PASSWORD_UPDATE_UNCONFIRMED`; a best-effort session clean-up is attempted first |
4. Delete the other sessions again. If this fails after a confirmed change: `500 SESSIONS_NOT_FULLY_CLOSED` (the password **was** changed).

Why this order: deleting sessions first means a failed clean-up can never leave "new password set, old sessions still alive". The compare-and-set means two simultaneous changes cannot both "succeed": the second gets 409 instead of silently overwriting the first.

### What the user is told (and what to do)
| Code | Known | Recovery text shown |
|---|---|---|
| `SESSION_INVALIDATION_FAILED` | not changed | try again |
| `PASSWORD_UPDATE_FAILED` | not changed | try again |
| `PASSWORD_CHANGED_CONCURRENTLY` | this request changed nothing | log in with the password from the request that succeeded |
| `PASSWORD_UPDATE_UNCONFIRMED` | **unknown** | log out, log in with the NEW password first, then the OLD one if that fails; change again if still wanted |
| `SESSIONS_NOT_FULLY_CLOSED` | changed; other sessions not confirmed closed | log out, log in with the new password, change the password once more (repeats the clean-up) |

Server-side recovery for a DBA, if ever needed: `DELETE FROM sessions WHERE user_id = <user id>;` (signs that user out everywhere, including the current device). Sessions also expire by themselves after `SESSION_TTL_HOURS` (default 8). There is no admin screen for clearing sessions yet.

### Limits that remain (not fixed)
- **Login that was already in flight (fixed; demonstrated only for the orderings tested):** before the fix, `POST /api/auth/login` verified the password against the hash it had read and inserted the session afterwards, without checking that the password was unchanged. A login that verified the OLD password just before a change could insert a valid session after the change and after both clean-ups, while the change still reported success. The fix (next section) re-checks the user row after the session exists and removes the session if the password changed. On MySQL 8.0.46 this was demonstrated for five fixed statement orderings at READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ and SERIALIZABLE, and the old behaviour was reproduced by a control at every level. It is not proven for statements overlapping at the same instant inside the server, for other MySQL/MariaDB versions or configurations, or for a production deployment.
- **Not atomic:** the password row and the session rows are never changed in one transaction. The ordering above limits the damage; it does not remove the gaps.
- **Simultaneous changes from two devices:** one wins (the other gets 409). Because each request deletes the other's session in step 2, the winner may find itself signed out afterwards and must log in with the password it set.
- **Unknown outcomes** (`PASSWORD_UPDATE_UNCONFIRMED`) are reported as unknown on purpose; the user has to find out by logging in.
- The clean-ups only affect sessions that exist when they run. Nothing here claims that "every" session has been closed.
- The classification "refused by the server" vs "unknown" relies on the error shape of the `mysql2` driver (SQLSTATE present and not fatal). It is deliberately conservative (anything else is "unknown"). Checked against the real driver (`mysql2` 3.24.5, MySQL 8.0.46): `ER_NO_SUCH_TABLE`, `ER_BAD_FIELD_ERROR`, `ER_DUP_ENTRY` and `ER_LOCK_WAIT_TIMEOUT` carried an SQLSTATE and were not fatal (classified "refused"); a connection killed by the server and a refused TCP connect were fatal without an SQLSTATE (classified "unknown"). Not checked with other driver versions, nor with a real deadlock or a crash of the server in the middle of the update.
- Rate limiting: password-change attempts are limited per logged-in user (`LOGIN_RATE_LIMIT_MAX`, per 15 minutes, in memory per server process, counts every attempt). Someone holding a stolen session can use up the real user's attempts. Exercised on a running server (`express-rate-limit` 7.5.1): with a limit of 3, three wrong attempts were answered 400 and the next ones 429. Not exercised behind a proxy or with several server processes.

## Login race fix: insert, then verify
`auth.repository.js` `createSession` now (1) inserts the session, (2) re-reads the user row with `WHERE id = ? AND is_active = 1 AND BINARY password_hash = <the hash this login verified against>`, and (3) if that no longer matches, deletes the session it just created and `login` refuses with the same generic "Employee ID or password is incorrect." error. The token is only returned after this check.

Why this ordering. The password change deletes the other sessions *after* it has written the new hash. If the login's re-check happens before the new hash is committed, the change's final clean-up starts after the login's session was committed and deletes it. If it happens after, the re-check sees the new hash and the login removes its own session. Either way an old-password session cannot survive a completed change.

What it relies on (and nothing else): each statement runs in autocommit mode and is committed on its own (the auth and users modules never open a transaction or pin a connection, and `db.query` runs each statement on its own through `pool.execute`; a source guard in `tests/auth.login-race.test.js` checks this), and a committed row is visible to statements that start later. Since Phase 6 the payments module does use transactions, on separate pooled connections. That this leaves the login-race result unchanged is reasoning, not something a test has shown; the login-race database test has not been run on the merged tree. It does **not** depend on the server's transaction isolation level or on locking.

Why not a single conditional `INSERT ... SELECT`: that is only safe if its read is a locking read, which MySQL documents for REPEATABLE READ and SERIALIZABLE but not for READ COMMITTED / READ UNCOMMITTED, and this project never sets an isolation level, so the effective level is whatever the server default is. The model shows the non-locking form leaves race orderings. Not adopted.

Evidence, by strength:
1. **Real MySQL 8.0.46 (`tests-integration/login-race.db.test.js`):** five deterministic orderings, each run on dedicated autocommit connections at all four isolation levels (each connection was checked to be at the requested level). The test pauses the login and the password change at exact statement boundaries, so it contains no sleeps and no timing loops. 20/20 passed in three consecutive full `npm run test:db` runs. The control ordering (the old insert-only behaviour) left a valid session at every level, so the scenarios can detect the bug. In a scratch copy, removing the re-check made S1, S3 and S4 fail; removing the discard made S3 and S4 fail; removing the password change's final clean-up made S2 and S4 fail.
2. The same scenarios against the real repositories and services with an in-memory SQL fake (`tests/auth.login-race.test.js`).
3. An exhaustive interleaving model (`tests/helpers/login-race-model.js`): the old design has violating orderings, insert-then-verify has none (20 of 20 orderings), a non-locking conditional insert has some. A model under stated assumptions, not MySQL.
4. Unit tests for the repository and service, including fail-closed behaviour.

What these do **not** show: demonstrated only for the orderings tested. Not proven for statements overlapping at the same instant inside the server; not run against other MySQL/MariaDB versions, managed or proxied setups, or a server with autocommit disabled; the login was exercised through the services with dedicated connections, not through concurrent HTTP traffic under load; the failure paths of the password change (a connection dropping mid-way) are covered by unit tests only. The proposed single conditional `INSERT ... SELECT` was never run on MySQL, so there is no MySQL evidence for or against it.

Remaining limits: it relies on the final clean-up of the password change (if that fails the API answers `SESSIONS_NOT_FULLY_CLOSED`); it covers orderings of whole statements, not two statements overlapping at the same instant inside the server; a login with the NEW password that lands between the update and the final clean-up is signed out by that clean-up (harmless).

## Verification record (what was actually run, on the Module 1 checkpoint tree BEFORE the merge with Phase 6)
Everything below ran in one Linux sandbox against a **throwaway** MySQL (loopback only, temporary credentials), never against a shared, personal or production database.

| Item | Value |
|---|---|
| MySQL | 8.0.46-0ubuntu0.24.04.4 (Ubuntu package), 127.0.0.1 only, server default isolation REPEATABLE-READ |
| Runtime and packages | Node 22.22.2. The project has no lockfile, so packages were resolved from the declared ranges: `mysql2` 3.24.5, `express` 4.22.3, `express-rate-limit` 7.5.1, `helmet` 8.3.0, `vite` 5.4.21, `react` 18.3.1, `react-router-dom` 6.30.6 |
| Browser | headless Chromium 141 (Playwright 1.56.0). Firefox and WebKit were not available |

| Check | Result |
|---|---|
| `npm run migrate` on an empty database | 001-008 applied; a second run skipped all 8; `users.phone` is VARCHAR(20) NULL and `users.email` VARCHAR(254) NULL |
| Migrations 007/008 on existing data | A second database was built to the state right after migration 006 with the real runner, then filled with 6 users (Tamil/multi-byte name, 32-character employee ID, 120-character name, a name with quotes and a semicolon, an inactive user), sessions, daily reports, leads and interviews. After 007/008 every old column and row was identical in every table (row contents and `CHECKSUM TABLE`), no index, foreign key or constraint changed, the `AUTO_INCREMENT` counter was unchanged, phone and email were NULL for every user and are the last two columns. A second run applied nothing. Executing 007 by hand again was refused by MySQL (`ER_DUP_FIELDNAME`). The recovery described above worked. Existing users could still log in, read their profile and save phone and email |
| `npm run test:db` | 43/43 passed in three consecutive runs: 14 existing (leads, interviews), 9 profile (real Express over HTTP, real rate limiter, compare-and-set, sessions of the other device, concurrent change), 20 login-race (5 orderings x 4 isolation levels). No rows were left behind in any table |
| `npm test` | backend 227/227, frontend 45/45 |
| `npm run build` | passed (the Profile screen is in the bundle) |
| `npm run smoke` | 88/88 against a real server (Phase 5 checks; it does not cover Profile) |
| Browser (final run) | 62/62 checks. The production build served by `vite preview`, the real backend and the disposable database, as a BDE and as an admin: unauthenticated access to `/profile` goes to login; the Profile link and current-page marker; read-only name, employee ID and role (only five inputs exist); invalid phone/email and password input is rejected in the browser without any request; valid values are saved, sent as exactly `phone` and `email`, and still there after a reload; Enter submits; the server rejected a wrong current password (error on that field, current-password field cleared, new-password fields kept); a double click on "Change password" produced exactly one request; the other device then received 401 and was sent to login; the old password was refused and the new one accepted; mobile (375x812 touch emulation): no horizontal scrolling, every control inside the viewport and at least 44 px tall. No JavaScript page errors. The error states "could not confirm", "password WAS changed but sessions not confirmed closed", 409, 429, network failure and a failed profile load were driven with **mocked** server answers at the network layer: they check what the screen shows for each code, not what the server does. Screenshots were reviewed by eye |

**Not verified:** a production-like deployment (HTTPS, reverse proxy, secure cookies, several server processes), MySQL versions other than 8.0.46 and MariaDB, Firefox and Safari, screen readers or other accessibility audits, behaviour under load or with real users and real data volumes, statements overlapping at the same instant inside the server (login race), a connection dropping or the server crashing in the middle of a password change against a real database, and the exact behaviour of the migration on a very large `users` table (the 6-row test shows correctness, not duration).

## Password policy
10 to 200 characters (same as `scripts/create-user.js` and login). The new password must differ from the current one. Passwords are never trimmed, logged, or echoed in any message. Stored with the existing scrypt format.

## Assumptions (not confirmed requirements)
- Users cannot edit their own name or employee ID (the brief lists them as profile data, not as self-service fields). Admin management of these comes in a later module.
- No uniqueness rule on email or phone (shared team mailboxes/numbers are possible).
