# Change report, 2026-10-18 (reference-recording alignment, non-attendance scope)

Base: `bde-app.zip` (preserved untouched). Work done on an extracted copy. **No database was contacted** (the authoring sandbox has no network) and **no migration was added or applied**: every feature below works on the existing schema.

## Verification status (read this first)

| Check | Result |
|---|---|
| Backend `npm test` | 579 tests, **569 pass, 10 fail**. All 10 failures are caused by the stale `db/migrations/015_chat_messages.sql` (see `docs/MIGRATION-RESOLUTION.md`). They were left failing on purpose. Before this work: 549 tests, 532 pass, 17 fail. |
| Frontend `npm test` | 209 tests, **209 pass** (before: 203, 202 pass). |
| Frontend production build (`vite build`) | **NOT TESTED.** `node_modules` in the ZIP are Windows-only (`@rollup/rollup-win32-*`, `@esbuild/win32-x64`), so the build cannot start on Linux. All 63 `.js/.jsx` files were parsed with `@babel/parser` (syntax only, 0 errors). Run `npm run build` on your machine. |
| Lint | No lint script exists in either `package.json`. Not run. |
| New SQL against TiDB/MySQL | **NOT RUN.** Statements are checked by tests that record SQL text and parameters (no write outside intended tables, parameters only). First real run must be on a development database. |
| Screens in a browser | **NOT SEEN.** JSX was parsed, not rendered. |
| `npm run test:db` | **NOT RUN** (needs a development database). |

## Reference screens (from the recording) and where they stand

Sign-in, Dashboard, Reports, Attendance, Leads, Import from Excel, Update leads from Excel, Assign leads, Interviews, Payments, Chat, Team, Activity, per-BDE view, mobile layout.

| Reference screen | Status after this change |
|---|---|
| Sign-in, Interviews, Payments (verify receipts), Chat, per-BDE view, Import from Excel | Already in the project (not re-rendered or changed) |
| Dashboard | **Improved:** KPI cards (calls, interested leads, interviews attended, collected this month) and a To-do list, reusing the endpoints of the detail screens |
| Reports | **Improved:** Day / Week / Month / Custom range with Excel and PDF export, beside the existing Monthly report with targets |
| Team | **Improved:** Employees screen now has Reset password (one-time temporary password) and Deactivate / Activate |
| Activity | **Added** (derived feed, see limits) |
| Assign leads | **Added** |
| Leads: Download Excel / Update from Excel | **Added** (review-before-save) |
| **Attendance, leave requests** | **Not started, by your instruction** (waiting for the rules) |
| Import "Give the leads to: by availability / equally" | Not added (needs the distribution rule decision) |
| Daily call target and joining date on Add BDE | Not added (needs the decision and a schema change) |

## What was added

**Backend (all admin-only; every service re-checks the role):**
* `GET /api/admin/reports/range?from&to`; `monthly.xlsx|pdf?from&to` (same query path and calling-source rule as the monthly report, no targets, max 366 days).
* `GET /api/admin/employees`, `PUT /api/admin/employees/:id/active`, `POST /api/admin/employees/:id/reset-password` (BDE role only, fixed in SQL; sessions removed; temporary password returned once, stored only as a hash).
* `GET/POST /api/admin/assignments`: overview per active BDE; move leads. Only leads with **no call, interview or payment** move (the database's composite keys would refuse others); one transaction; all-or-nothing; switched-off BDEs cannot receive.
* `GET /api/admin/activity`: feed derived from existing records (calls, leads, interviews, payments, instalments, receipts and reviews, imports, new accounts, daily reports). One SELECT per kind, merged in JavaScript (no UNION, avoiding collation clashes). Max 31 days.
* `GET /api/admin/lead-sheet/download.xlsx`, `POST /api/admin/lead-sheet/preview|apply`: edits Status, Follow-up date, Next action of existing leads; blank keeps the value; each row is guarded by the sheet's "last updated" stamp so a stale sheet cannot overwrite newer work.

**Frontend:** `AdminKpis`, `RangeReport`, `LeadSheetPanel`, `AdminAssignPage`, `AdminActivityPage`, updated `AdminEmployeesPage`, `AdminReportsPage`, `AdminLeadsPage`, `AdminDashboardPage`, sidebar links "Assign Leads" and "Activity".

## Fixes to existing code and tests

* **Frontend status change** now calls the server's real `PATCH /leads/:id/status` (one request) instead of GET then whole-lead PUT, which could overwrite a newer edit with a stale copy. The old wiring test asserted that no such route existed, which was no longer true; it now asserts the real contract.
* `chat.test.js` "day labels" test failed whenever run between 00:00 and 02:00 (it used the real clock); it now uses a fixed time. Assertions unchanged.
* **Pinned structure tests were updated on purpose** for the intentional API growth (employees router: 4 exact routes; raw-body routes before the JSON guard: 4 named routes; `createApp` argument list). Each now pins the exact new surface instead of a count.
* `backend/tests/call-logs.db.test.js` needed a database but sat in the unit folder (7 failures without one). It is a **different version** of `tests-integration/call-logs.db.test.js` (expects `uniqueLeadsCalled` 2, the other 3). It was moved, not deleted, to `tests-integration/pending-review/` (see its README). You decide which expectation is right.

## Database changes actually performed

**None.** No connection was made, no SQL executed, no file in `db/migrations/` touched.

## Blocked by your approval or by the database

1. Migration file-set fix and any `migrate:apply`: needs the read-only results from `backend/scripts/migration-records-check.sql` and your approval of the exact plan (`docs/MIGRATION-RESOLUTION.md`).
2. Real-database verification of every new query and of `npm run test:db`.
3. Frontend build and browser check (Windows `node_modules`).

## Decisions still open (kept separate from confirmed requirements)

1. Attendance: Present / Late / Absent / Leave rules, the "10:00 am" late rule, a "start the day" action, leave types and approval.
2. Migration numbering (this tree: call logs 015, chat 016 to 018; earlier decision: 017/018/019 and 020).
3. How leads are distributed on import (by availability, equally, one BDE) and whether the "suggest a split" rule in Assign leads (fewest open leads first) is the rule you want.
4. Daily call target per BDE and joining date (needs a schema change).
5. Whether sign-ins, password resets, account switch-offs and lead reassignments must appear in Activity. They leave no record today, so they cannot be shown without a new table (needs your approval).
6. Monthly/range call counting: the figures follow the rule already in `docs/call-log-assumptions.md` (one source per BDE per day). It is **not confirmed** by the Team Lead, and the new Day/Week/Custom reports inherit it.
7. Which of the two call-log database tests is correct (see above).
8. Timezone: the new admin screens use the admin's own calendar date (like the existing daily overview); the server also has `REPORT_UTC_OFFSET_MINUTES`. Confirm the company day boundary.

## Credentials

`backend/.env` and `backend/.env.local-backup` were inside the ZIP you sent. They were **not** read beyond variable names, **not** copied into this output ZIP, and no value was printed. If that ZIP was shared (email, chat, upload), treat the database password and the session secret as exposed:
1. In TiDB Cloud, reset the password of the SQL user the app uses (or create a new user, grant it the same access, then drop the old one).
2. Put the new password only in your local `backend/.env`, typed or pasted directly; never into a chat or a file you share.
3. Change the session/cookie secret in `.env` (any long random value); this signs everyone out.
4. Delete `.env.local-backup` after checking it holds nothing you still need, and confirm `.env*` stays in `.gitignore` (only `.env.example` should travel).
5. Restart the API and check `GET /api/health/db`.

## How to try it (on your machine)

```
cd backend  && npm install && npm test          # expect 10 known migration failures until the stale file is resolved
cd ../frontend && npm install && npm test && npm run build
cd ../backend && npm run migrate                # plan mode, read-only
```
