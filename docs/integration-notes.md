# Integration notes: Phase 6 baseline + Module 1 (Stage 1)

**Status: assembled by hand in "Stage 1" (integration only). No database test, migration run, smoke run, production build or browser check has been run on this tree.** Results of the dependency-free unit tests on this tree, if any, are recorded only in the separate Stage 1 verification report that accompanies it, not in this file. Stage 2 (proof review, upload hardening and so on) has **not** been started.

## Sources (both left untouched; this tree was built in a separate copy)

| Source | SHA-256 of the ZIP |
|---|---|
| `BDE-Team-Management-All-Phases-Consolidated.zip` (Phase 6 baseline) | `2f9418fa48a39100baccee48d60a57a5c6fc2a2bd2a205782904224a16190a88` |
| `BDE-Team-Management-Module1-Checkpoint.zip` | `bb5a33b8489afe2e0adaae58b6f72feecbe226a7345a65c666e6db9899696ed8` |

The comparison of these two ZIPs was two-way only. The Phase 5 ZIP was not available, so this is not a three-way merge, and "which side changed a shared file" was judged from the file contents, not proven.

## How the tree was built

1. **Base: the whole Phase 6 tree**, including `CONSOLIDATION-STATUS.md` and `bde-tracker/`.
2. **Added from Module 1, unchanged (23 files):** the users module (handlers, repository, service), `validate-profile.js` (backend and frontend), `ProfilePage.jsx`, the profile message helpers and their tests, `tests/helpers/*`, `auth.login-race.test.js`, `profile-wiring.test.js`, the users and profile unit tests, `login-race.db.test.js`, `profile.db.test.js`, `docs/profile-assumptions.md`, and the two Module 1 migrations `007_users_phone.sql` and `008_users_email.sql` (file names and contents unchanged). Some of these were edited afterwards: see "Guard and documentation changes".
3. **Replaced by Module 1's version:** `auth.repository.js`, `auth.service.js`, `lib/password.js` (the login-session race fix). `auth.repository.js` then received a comment-only edit.
4. **Kept exactly as in Phase 6** (Module 1's versions of these are the older, pre-payment versions and were NOT used): `config/env.js` (receipt settings), `LeadsListView.jsx` (Add Payment link), `frontend/src/lib/format.js` (`displayMoney`), `db/pool.js` (`db.transaction()`), everything under payments, the interview files that Phase 6 changed on purpose (stored "payment confirmed" flag replaced by a derived value), `admin.service.test.js` (14 admin GET routes), `.gitignore`, and migrations 001-006 and the four Phase 6 payment migrations.
5. **Merged by hand:** `app.js`, `server.js`, `.env.example`, `styles.css`, `App.jsx`, `api/client.js`, `AppShell.jsx`, `README.md`, and `scripts/smoke-test.js` (Phase 6 version, one comment edited).

### What the hand merges do

- `app.js`: Phase 6's receipt upload route stays registered before the JSON-only rule; Module 1's three profile routes and the per-user password-change limiter come after it. The services are listed as `leadService, paymentService, interviewService, userService, checkDb` so that Module 1's source checks (which look for the text `interviewService, userService, checkDb`) still hold. The admin router still has 14 GET routes and no write routes.
- `server.js`: builds both the receipt storage and payment service (Phase 6) and the user service (Module 1).
- `.env.example`: Module 1's `LOGIN_RATE_LIMIT_MAX` comment plus Phase 6's `RECEIPT_*` variables.
- `styles.css`: Phase 6's Payments block followed by Module 1's Profile block, both whole. The only class name defined in both blocks is `.field`, used in different, non-conflicting selectors.
- `App.jsx`, `client.js`, `AppShell.jsx`: both route sets and both API sets. Payments and Profile are real links for both roles; the admin "Reports" entry stays "Coming soon".

## Guard and documentation changes (G1 approved; G3, G4, G5 and Option C follow from the merge)

- **G1, the transaction guard.** In Module 1, `auth.login-race.test.js` forbade any transaction or pinned connection anywhere in `src/` and `scripts/`. Phase 6's `db/pool.js` legitimately has `db.transaction()` for payments, so that ban was narrowed. It now scans only `src/modules/auth` and `src/modules/users`: the same banned-token pattern, plus "never call `.transaction(`", plus a check that `db.query` still runs each statement through `pool.execute` and that the auth and users repositories are built on the plain `db` object. It is still **one** test (renamed). **This is a source guard and reasoning, not proof.** The reasoning is that the login-race fix needs only its own statements to autocommit, and payments transactions use separate pooled connections. Whether that holds on MySQL has to be shown by running `tests-integration/login-race.db.test.js` against a disposable database on this merged tree. That has not been done.
- **Comments and docs that would have become wrong** and were reworded: `auth.repository.js` (comment only, code identical to Module 1), `users.service.js` (comment only), `docs/profile-assumptions.md` (the "no shared transaction helper" and "the project never opens a transaction" statements, plus labels marking its results as pre-merge).
- **G3:** admin GET route count in `profile-wiring.test.js` changed from 10 to 14; admin write routes stay 0.
- **G4:** that test now expects exactly the 12 migration files in the order given in `docs/migration-map.md`, and pins the SHA-256 of all 12 (still one test).
- **G5:** README checks now expect the "12 migration files" wording; Module 1's "43/43 passed" is kept as a Module 1 checkpoint result.
- **Option C header edits:** comments in `login-race.db.test.js`, `profile.db.test.js`, `payments.db.test.js` and `smoke-test.js` that said "migrations 001-008", "001-010" or "007-010" now name the files. In `profile.db.test.js` one test title and one assertion message were reworded to use file names (logic unchanged).

## Left exactly as they were, on purpose

- **`bde-tracker/` is an unused prototype.** It is a static HTML/JS demo of the Daily Calling Report. Nothing in `bde-app/` reads, serves or depends on it. It was kept unchanged in this tree.
- **`CONSOLIDATION-STATUS.md` describes the old Phase 6 baseline.** Its statements that Profile / Change Password and the login-race work are not included were true for that baseline, not for this integration tree. It was kept unchanged; read it as history.
- No `package-lock.json` was added and no dependency was installed (neither source tree has a lockfile). Dependency versions come from the ranges in the two `package.json` files, which are identical in both sources.

## Historical test results: ALL ARE PRE-MERGE

These were reported in the handoff and in the two READMEs / `docs/profile-assumptions.md`. They were not re-run for this merge and none of them describes this tree.

| Tree | Result (as reported) |
|---|---|
| Phase 6 standalone | backend unit tests 172, frontend 44 (see the "Verification results" section of the README for the database, smoke and other results) |
| Module 1 checkpoint standalone | backend unit tests 227, frontend 45; `npm run test:db` 43/43 against a throwaway MySQL 8.0.46; browser 62/62 in headless Chromium 141 (`docs/profile-assumptions.md`) |

## Still unverified on this merged tree

Database suites (including the login-race and profile database tests), migration runs on any database state, the smoke test (it has no Profile checks), the production build, and a browser pass (login, Profile and change password, Leads, Interviews, Daily Report, Payments and proof upload). Nothing in either source ZIP was browser-tested together with the other. Any of these must be run against **disposable** databases only.

## Known gaps carried over from Phase 6 (not addressed in Stage 1)

No proof approve/reject; the five-file receipt cap is counted without a lock; no orphan-file cleanup; no upload rate limit; `RECEIPT_MAX_BYTES` can be configured up to 20 MB.
