# ADZ4NEEDZ BDE Team Management & Sales Tracking Application

Real full-stack application (React + Express + MySQL), built in phases.
The earlier `bde-tracker/` folder is only a frontend prototype and is not used by this app.

> **What has and has not been verified.** The code in this tree has unit tests that pass (backend 487, frontend 154 at the time of the last run, see `../HANDOFF.md`) and every source file passes a syntax check. **The assembled application has never been run end to end by the authors of this tree:** no `npm install`, no Vite production build, no MySQL migration run, no integration test (`npm run test:db`), no smoke test and no browser check happened on the merged code, because the build environment had no npm registry, no MySQL and no browser. Those checks are listed with exact commands under "Verify on your machine" below. Per-requirement status: `docs/STATUS.md`. History of how the tree was assembled: `docs/integration-notes.md`, `docs/migration-map.md`.

## Features in this tree

| Area | What exists (code written, unit-tested, not run end to end) |
|---|---|
| Accounts | Admin and BDE login with employee ID and password (scrypt hashes), session cookie, role checks on the server, protected routes, Profile (phone, email, change password). **Admin creates BDE accounts** on the Employees screen; admin accounts are created only with a server command (`npm run bootstrap-admin` for the very first admin, `npm run create-user` afterwards). The sign-in screen has **Employee Sign In** and **Admin Sign In** tabs and a **Create BDE Account** path that requires an admin sign-in first (see docs/login-design.md). |
| BDE dashboard | `/dashboard`: today's calling report status, follow-ups, interviews, payments and proof review status, this month's figures vs targets. All numbers come from the existing APIs; a block that fails shows its own error. |
| Daily calling report | Total calls, interested, not interested, follow-up, no response; per BDE; list of own reports. Now the **manual fallback** to the Call desk below. |
| Team chat | One shared conversation for admins and BDEs (`/chat`): persisted messages, admin-only announcements, @mentions by name handle (never employee ID), read/unread (menu badge, "New messages" line, "Read by N of M" for admins on announcements), polling (no WebSockets), per-person rate limit, plain-text messages. Migrations 016-018. Design, API, migration and rollback steps, manual test script and limitations: `docs/team-chat.md`. **Not yet verified on a real MySQL or in a browser.** |
| Sign-in screen | Split-screen sign-in (brand panel + form), show/hide password, loading/error states, notices for "signed out" and "session has ended", responsive from 320 px, reduced-motion and high-contrast support. Employee ID only (not email). Details, video mapping and the deliberate differences: `docs/login-design.md`. |
| Call desk (BDE) | `/call-desk`: one click per call (Interested / Not interested / Follow-up / No response) on the BDE's own leads; duplicate clicks are counted once; same-day undo; today's calls, different leads, interested leads and conversion are counted by the system. Admin dashboard shows per-BDE calls, interested leads, conversion and status. The monthly report, My Month, targets and exports read these calls too. Rules, assumptions and the open "lock" decision: `docs/call-log-assumptions.md`. |
| Leads | Add, view, edit, search, filter, follow-up dates and next action, possible-duplicate warning. A BDE sees only own leads; admin sees all (read-only) with the responsible BDE. |
| Excel / CSV import (admin) | Upload, column matching, validation, duplicate detection, preview, explicit confirm. See "Admin lead import". |
| Interviews | Scheduled / attended / did not attend, selected / not selected, interested in joining, payment-confirmed shown from payment records. Admin read-only views and per-BDE overview. |
| Payments | Commitment per lead and course, instalments, derived status (Pending / Partially Paid / Paid), receipt or screenshot upload checked by file content and stored privately. **Admin approves or rejects each proof** (rejection needs a reason, reviewer and time are recorded); the BDE sees the status and the reason. |
| Monthly report and targets | Admin team report with targets per BDE per month; BDE "My Month". Database figures and calculated percentages are labelled separately. **Excel and PDF download** of the team report. |
| Admin views | Dashboard by date, BDE list and detail, leads, interviews, payments with overviews and team totals. |

Not built: chat editing/deleting/direct messages (chat itself is built, see `docs/team-chat.md`), refunds, deleting payments/leads/interviews, password reset by an admin, deactivating an employee from the UI, audit trail beyond the proof-review fields, malware scanning of uploads. See `docs/STATUS.md`.

There is no fake login or simulated saving anywhere in `bde-app/`.

## What you need on your laptop

Node.js 22 or newer, npm, and MySQL 8.0 or newer.

Verification status of the OLDER phases (this paragraph is from BEFORE the merge and BEFORE the import, report, review and employee features, which have not been run against a database): migrations 001–004, the API and the lead flows were exercised against MySQL 8.0.46 in a Linux sandbox (see "Testing" below). They have NOT been run on your laptop, on a production-like server, or in a browser. Module 1 of the merge (Profile, migrations 007_users_phone and 008_users_email, the login-session race fix) was verified later, on its own standalone tree, in a Linux sandbox against a throwaway MySQL 8.0.46 and in headless Chromium 141 (what was and was not covered: "Profile and change password" below and `docs/profile-assumptions.md`). It has still not been run on a production-like server, with other MySQL or MariaDB versions, in Firefox or Safari, or by real users. Phase 6 (Payments) results are under "Verification results" below. This README records no verification of the merged tree itself.

### 1. Create the database and a MySQL user (choose your own names and password)

```sql
CREATE DATABASE <db_name> CHARACTER SET utf8mb4;
CREATE USER '<db_user>'@'localhost' IDENTIFIED BY '<choose-a-strong-password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON <db_name>.* TO '<db_user>'@'localhost';
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env        # then edit .env: DB name/user/password and RECEIPT_STORAGE_DIR (never commit .env)
npm run migrate             # applies all 20 migration files in db/migrations (001-018, where 007 and 008 each exist twice: see docs/migration-map.md; safe to run again; back up first if the database holds real data)
npm run bootstrap-admin -- --employee-id <ID> --name "<Full Name>"   # FIRST admin only: refuses once any admin exists; asks for a password (hidden)
npm run create-user -- --role admin --employee-id <ID> --name "<Full Name>"   # a further admin (server shell only); asks for a password (hidden)
npm run create-user -- --role bde   --employee-id <ID> --name "<Full Name>"   # or let an admin create BDEs in the app: Admin > Employees
npm test                    # unit tests (no database needed)
npm run test:db             # integration tests: real app + real MySQL (see Testing)
npm run dev                 # API on http://localhost:4000
```

### 3. Check the real database path (second terminal, server running)

```bash
# macOS/Linux
SMOKE_EMPLOYEE_ID=<bde id> SMOKE_PASSWORD=<bde password> npm run smoke
# Windows PowerShell
$env:SMOKE_EMPLOYEE_ID="<bde id>"; $env:SMOKE_PASSWORD="<bde password>"; npm run smoke
```

To also check the admin screens, add `SMOKE_ADMIN_ID` and `SMOKE_ADMIN_PASSWORD`. To check that one BDE cannot see another BDE's leads, add `SMOKE_BDE2_ID` and `SMOKE_BDE2_PASSWORD` (a second BDE account). The leads checks save 2 real leads and the interview checks save 1 real interview for the first BDE.

It logs in, saves one report with a random past date, reads it back from MySQL, checks wrong password,
bad input, duplicate date, logout. It writes one real row for that BDE.

### 4. Frontend

```bash
cd frontend
npm install
npm test                    # validation tests
npm run build               # production build check
npm run dev                 # http://localhost:5173 (talks to the API through a proxy)
```

## Testing

| Command | Needs | What it proves |
|---|---|---|
| `backend: npm test` | nothing | Validation, services, SQL builders, middleware with fake repositories. Does not touch MySQL. |
| `backend: npm run test:db` | `.env` pointing at a development DB with migrations applied | Real Express app over HTTP + real MySQL + a temporary receipt folder. Leads: auth, ownership, admin read-only, follow-up buckets, duplicates. Interviews: auth, ownership by changing the id in the URL, lead-id safety, create/update persistence, filters and day boundaries, Admin read-only view and overview, and that MySQL's own foreign key rejects an interview whose BDE is not the lead's owner. Payments: permissions, amount/status validation, partial payments, parallel requests against the cap, totals checked against plain SQL, receipt upload and download security, and the derived interview flag. Creates temporary users named `itest-*` and deletes them afterwards. Use a development database. |
| `backend: npm run smoke` | running server + test accounts | Same path through a running server, including the Daily Report, Lead, Interview and Payment (with a real file upload) flows. Writes real rows and one file. |
| `frontend: npm test` / `npm run build` | nothing | Validation tests; production build compiles. Does **not** prove the screens work in a browser. |

### Verification results: standalone Phase 6 tree, BEFORE the merge (executed in a Linux sandbox with MySQL 8.0.46 from the Ubuntu package; none of these numbers describes the merged tree)

| Check | Result |
|---|---|
| All 10 migrations on a **fresh empty** database | 10 applied; second run: 0 applied |
| Migrations 007-010 on a database already at Phase 5 (6 migrations, 2 leads, 2 interviews, one with the old flag = 1) | applied; all rows intact; second run: 0 applied; Phase 5 migrations skipped, not rewritten |
| `backend: npm test` | 172 of 172 passed |
| `backend: npm run test:db` (leads + interviews + payments, fresh database) | 27 of 27 passed (6 leads, 8 interviews, 13 payments) |
| `backend: npm run test:db` on the database upgraded from Phase 5 | 27 of 27 passed |
| `backend: npm run smoke` against a running server on the fresh database (BDE, second BDE, Admin; real receipt folder) | 123 of 123 passed, 0 failed, 0 skipped (88 from Phases 2-5, 35 for payments) |
| `frontend: npm test` | 44 of 44 passed |
| `frontend: npm run build` | succeeded |
| Mutation check of the payment DB tests (ownership scope removed; row lock removed; cap check removed; commitments multiplied in the overview; file-type check disabled; derived interview flag replaced by a constant; receipt-download scope removed) | each change made at least one test fail; originals restored (byte-identical) and 13 of 13 passing again |
| Start-up behaviour: unusable receipt folder; production without `RECEIPT_STORAGE_DIR`; production with it | exits with a clear error (code 1); starts with a warning; starts without a warning. Folder created with mode 700, files with mode 600 |

**Phase 1-5 tests that were changed on purpose (Phase 6 makes the interview "payment confirmed" flag derived and read-only):**
`tests/admin.service.test.js` (Admin GET route count 10 to 14; "no Admin write route" check unchanged); `tests/validate-interview.test.js` and its frontend copy; `tests/interview-query-sql.test.js`; `tests/interviews.service.test.js`; `tests-integration/interviews.db.test.js`; `scripts/smoke-test.js` (one assertion). Each replaced "a typed paymentConfirmed value is stored" with "it is ignored and the flag follows payment records". No other existing test was altered.

**Not verified:** nothing was opened in a browser, so the Payment and Interview screens (forms, file picker, upload, filters, badges, navigation) are unproven beyond compiling; no browser could be installed in the sandbox. Not run on a laptop, a production-like server, or MySQL from another distribution or version. No load testing, no virus-scanning, no test of a reverse proxy in front of the API, no test with a very large number of receipts or real phone screenshots. The parallel-request test shows the cap holds under 8 simultaneous requests, which is evidence, not proof, for heavier traffic. The sandbox used throwaway accounts and databases.

Proposed rules for leads: `docs/lead-assumptions.md`. Interviews: `docs/interview-assumptions.md`. Payments: `docs/payment-assumptions.md`. Receipt storage, security limits and production requirements: `docs/payments-and-uploads.md`. Profile and the login race: `docs/profile-assumptions.md`. How this tree was assembled: `docs/integration-notes.md`; migration order: `docs/migration-map.md`.

## API (this phase)

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/health`, `GET /api/health/db` | anyone | Server / database check |
| `POST /api/auth/login` `{employeeId, password}` | anyone (rate limited) | Start session (HttpOnly cookie) |
| `POST /api/auth/logout`, `GET /api/auth/me` | logged in | End session / current user |
| `POST /api/daily-reports` | BDE | Save own report. The BDE is taken from the session, never from the request body |
| `GET /api/daily-reports` | BDE | Own reports, newest first |
| `GET /api/admin/daily-overview?date=YYYY-MM-DD` | Admin | Every BDE for that date (submitted or not) + totals of submitted reports |
| `GET /api/admin/bdes`, `GET /api/admin/bdes/:id` | Admin | BDE list; one BDE with their daily reports |
| `GET /api/lead-statuses` | BDE, Admin | Active lead statuses (for forms and filters) |
| `GET /api/leads`, `GET /api/leads/summary`, `GET /api/leads/:id` | BDE | Own leads: search `q`, `statusId`, `followUp` (overdue/today/upcoming/none), `followUpFrom`/`followUpTo`, `page`, `pageSize`, plus the browser's `today` |
| `POST /api/leads`, `PUT /api/leads/:id` | BDE (owner only) | Create / edit. A possible duplicate returns 409 `POSSIBLE_DUPLICATE` until the request repeats with `confirmDuplicate: true` |
| `GET /api/admin/leads`, `/api/admin/leads/summary`, `/api/admin/leads/:id` | Admin | Team-wide leads (read-only), optional `bdeId` filter, responsible BDE included |

Interviews (Phase 5). `:id` is the interview id. The summary always needs the browser's `today` (`YYYY-MM-DD`); the list needs it for the `when` filter and for the status indicators.

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/interviews`, `/api/interviews/summary`, `/api/interviews/:id` | BDE | Own interviews. Filters: `q` (candidate name, phone, email, course), `attendance`, `outcome`, `interested` (yes/no/unknown), `paymentConfirmed` (yes/no), `when` (today/upcoming/needs_update), `scheduledFrom`/`scheduledTo`, `leadId`, `page`, `pageSize`, `today`. Summary: counts of today / upcoming / needing an attendance update |
| `POST /api/interviews` | BDE | Schedule an interview for one of the BDE's own leads (`leadId`, `scheduledAt` as `YYYY-MM-DDTHH:MM`, optional `attendance`, `outcome`, `interestedInJoining` true/false/null, `paymentConfirmed`). A missing lead and another BDE's lead both return 404; a malformed id returns 400 |
| `PUT /api/interviews/:id` | BDE (owner only) | Replace the interview (every field must be sent). The lead cannot be changed. Another BDE's interview returns 404 |
| `GET /api/admin/interviews`, `/api/admin/interviews/summary`, `/api/admin/interviews/:id` | Admin | Team-wide interviews (read-only), optional `bdeId`, responsible BDE included |
| `GET /api/admin/interviews/overview` | Admin | One row per BDE plus team totals (scheduled, attended, did not attend, attendance pending, selected, not selected, interested in joining, payment confirmed), optional `scheduledFrom`/`scheduledTo` |

Migrations: `005_leads_id_user_unique_key.sql` adds a unique key `(id, user_id)` to `leads`; `006_interviews.sql` creates `interviews` with a composite foreign key `(lead_id, user_id)` to it, so the database itself guarantees an interview's BDE is the lead's owner. They are separate single-statement files because MySQL DDL cannot be rolled back, so neither can be left half-applied.

Payments (Phase 6). `:id` is the payment id (or instalment / receipt id where the path says so). All amounts are strings with 2 decimals.

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/payments`, `/api/payments/summary`, `/api/payments/:id` | BDE | Own payments. Filters: `q`, `status` (pending/partially_paid/paid), `leadId`, `commitmentFrom`/`commitmentTo`, `missingProof=yes`, `page`, `pageSize`. Summary: own totals, optional `dateFrom`/`dateTo`. Detail includes instalments, proof metadata and the upload rules |
| `POST /api/payments` | BDE | Record a commitment for one of the BDE's own leads (`leadId`, `courseOrInternship`, `amountCommitted`, `commitmentDate`). Missing and foreign lead both give 404 |
| `PUT /api/payments/:id` | BDE (owner only) | Change course, amount, date. The amount cannot go below what was received. A status or owner in the body is ignored |
| `POST /api/payments/:id/instalments`, `PUT /api/payment-instalments/:id` | BDE (owner only) | Record or correct money received (`amount`, `paidOn`). Over-payment gives 400; same amount and date gives 409 unless `confirmDuplicate: true` |
| `POST /api/payment-instalments/:id/receipts?name=...` | BDE (owner only) | Upload proof: the request body is the file, `Content-Type` image/jpeg, image/png or application/pdf. Wrong or disguised type 415, too large 413, 6th file 409, same file again 409 unless `&confirmDuplicate=1` |
| `GET /api/payment-receipts/:id/file` | BDE (owner only) | Download own proof. Another BDE's file gives 404 |
| `GET /api/admin/payments`, `/api/admin/payments/:id` | Admin | Team-wide payments (read-only), optional `bdeId`, responsible BDE included |
| `GET /api/admin/payments/overview` | Admin | One row per BDE plus team totals (payments, committed, received, outstanding, counts by status, fully paid amount, instalments), optional `dateFrom`/`dateTo` |
| `GET /api/admin/payment-receipts/:id/file` | Admin | View any proof file |

Migrations: `007_payments.sql`, `008_payment_instalments.sql`, `009_payment_receipts.sql` (one table each, with composite foreign keys so the database itself guarantees that a payment, instalment and receipt belong to the lead's owner, and CHECK constraints for positive amounts) and `010_deprecate_interview_payment_flag.sql` (comment only; see `docs/payments-and-uploads.md` for the impact on the old interview flag).

## Security choices

- Passwords hashed with scrypt (Node built-in). No default or hardcoded passwords. Accounts are created with `create-user`.
- Session token is random; only its SHA-256 hash is stored in MySQL. Cookie is HttpOnly + SameSite=Lax (+ Secure in production).
- All SQL uses placeholders. Server validates every field; the browser checks are only for quick feedback.
- JSON-only API, request size limit, helmet headers, login rate limit, generic error messages.
- `.env` is git-ignored; `.env.example` has placeholders only.
- Payment proof files: type decided from the file content (JPEG/PNG/PDF only), size limited, stored under random names in an owner-only folder outside any web-served path, never listed in API output, served only to the owning BDE or Admin with `nosniff`/`no-store`/sandbox headers. Limits and production requirements: `docs/payments-and-uploads.md`.

## Assumptions to confirm with TL (nothing here is a confirmed requirement)

| Item | Current behaviour |
|---|---|
| One report per BDE per date | A second report for the same date is rejected (409). BDE cannot edit or delete. |
| Login ID | Employee ID. Admin accounts also have an employee ID. |
| Session length | 8 hours (`SESSION_TTL_HOURS`). |
| Password rule | 10 to 200 characters when created with `create-user`. |
| Date field | Any real date is accepted (future dates too). |
| Category counts | Not required to add up to total calls. |
| Who creates BDE accounts | Command line script for now. |
| **Lead statuses** | The PDF has none. A PROPOSED starter list is seeded by migration `004` (New, Interested, Follow-up Required, No Response / Not Reachable, Not Interested). Statuses live in the `lead_statuses` table, so they are changed with SQL, not code. |
| Statuses that stop follow-up tracking | Column `closes_follow_up`. Only "Not Interested" is flagged in the proposed list; leads in such a status are not counted as overdue/upcoming. |
| "Upcoming" follow-up window | Next 7 days (technical default, `UPCOMING_DAYS`). |
| "Today" for follow-ups | Sent by the browser (the user's own date), so the server needs no timezone guess. |
| Lead contact details | Phone and email are separate fields; at least one is required. Phone: 7 to 15 digits. |
| Course / internship | Free text (a fixed list needs TL confirmation). |
| Possible duplicates | Same phone (last 10 digits) or same email (case-insensitive), across all BDEs. Nothing is merged or blocked: the BDE must confirm. Details are shown only for the BDE's own leads; other BDEs' matches are shown as a count. |
| Lead delete / reassign to another BDE | Not built (not confirmed). |
| **Interviews** | Statuses, the "outcome only after attended" rule, several interviews per lead, wall-clock time with no time zone, Admin read-only, payment-confirmed as a plain flag: all are proposals. 18 numbered questions are in `docs/interview-assumptions.md`. |
| **Payments** | Commitment vs instalments, derived status, over-payment refused, revenue = instalments as entered (unverified), proof rules, interview "payment confirmed" meaning "a payment record exists": all are proposals. 20 numbered questions are in `docs/payment-assumptions.md`. |
| Admin permissions | Read-only. Admin cannot submit, edit or delete reports. |
| Inactive BDEs on the admin dashboard | Shown only for dates where they did submit a report. |
| Dashboard totals | Plain sums of the submitted Daily Calling Reports for the chosen date. Not a defined KPI. |

## Folder layout

```
backend/   Express API: src/modules/<feature>, db/migrations, scripts, tests
frontend/  React (Vite): src/pages, src/components, src/auth, src/api
```

Next to `bde-app/` in the repository root (kept exactly as they were, not edited for this merge):
- `bde-tracker/`: the early static HTML prototype of the Daily Calling Report. It is **unused**: nothing in `bde-app/` reads, serves or depends on it, and it saves nothing.
- `CONSOLIDATION-STATUS.md`: written for the OLD Phase 6 baseline package, before Module 1 was merged. Its statements that Profile / Change Password and the login-race work are not included describe that old baseline, not this integration tree.

## Profile and change password (Module 1 of the merge)
- Pages: **Profile** in the sidebar for BDE and Admin users (`/profile`). Name, employee ID and role are shown read-only; phone and email can be edited; the password can be changed (current password required).
- API (any logged-in user, own record only): `GET /api/profile`, `PATCH /api/profile` (`phone`, `email` only), `POST /api/profile/password` (`currentPassword`, `newPassword`).
- **Database:** migrations `007_users_phone.sql` and `008_users_email.sql` (additive, nullable). On an existing database back up, then run `npm run migrate` **before** starting the new backend, otherwise the profile API fails. In this tree those two files share their numbers with Phase 6's `007_payments.sql` and `008_payment_instalments.sql`; the runner tracks files by full name, so all four are applied. Read `docs/migration-map.md` before running anything against a database that already has some of these files recorded.
- **Password change guarantees and limits:** other sessions that were open are signed out, a concurrent change cannot silently overwrite another (409), and every error message states only what is known. A login that was already in flight when the password changed is re-checked after its session is created and refused if the password changed. On MySQL 8.0.46 this was demonstrated for five fixed statement orderings at all four isolation levels (a control reproduces the old bug); it is not proven for statements overlapping at the same instant, other servers, or production setups. This was shown on the standalone Module 1 tree; the login-race database test has not been run on the merged tree. Details, partial-failure behaviour and recovery: `docs/profile-assumptions.md`.
- Tests: `npm test` (backend, no database needed) includes the Profile tests. `npm run test:db` needs MySQL with all 20 migration files (a development database only) and also runs `profile.db.test.js` and `login-race.db.test.js`. Module 1 checkpoint result, standalone tree, before the merge, against a throwaway MySQL 8.0.46: 43/43 passed. The Profile screen was exercised in headless Chromium against the production build of that standalone tree. No database test or browser check has been run on the merged tree. Scope, evidence and what remains unverified: `docs/profile-assumptions.md`.


## Admin lead import (Excel / CSV)

Admin menu: **Import Leads** (`/admin/import`). API: `/api/admin/imports/*` (admin only).

1. Upload an `.xlsx` or `.csv` (max `IMPORT_MAX_BYTES`, default 5 MB, max 5000 data rows, first row = headings).
2. Columns are matched automatically (Name, Phone/Mobile, Email, Course, Status, Follow-up date, Remarks, Employee ID) and can be re-mapped.
3. Each lead goes to one BDE: pick a **default BDE**, and/or include an **Employee ID** column (an unknown ID makes that row invalid).
4. The preview classifies every row: ready, has errors, repeated in the file (first occurrence wins), already in the system (same phone or email as any existing lead).
5. Nothing is inserted until you tick the review box and press Import. Errors and duplicates are skipped unless you explicitly opt in to importing existing duplicates. Failed rows can be downloaded as CSV.
6. Uploaded cell values are stored only while the import is in preview; they are erased when it is committed or cancelled.

Dates may be Excel dates, `YYYY-MM-DD`, or day-first `DD-MM-YYYY` / `DD/MM/YYYY`. Status text is matched to the configured lead statuses (a few synonyms such as "follow up" are accepted); an empty status becomes "New".

Setup: `cd backend && npm install` (adds `exceljs`), then `npm run migrate` (adds migrations 011 and 012).


## Monthly report and targets

- Admin: **Reports** (`/admin/reports`, API `GET /api/admin/reports/monthly?month=YYYY-MM`, `PUT /api/admin/reports/targets`).
- BDE: **My Month** (`/monthly`, API `GET /api/reports/monthly?month=YYYY-MM`): own figures only; the id comes from the session.
- Figures are read from the database: **calls come from the Call desk call log and from manual daily reports, one source per BDE per day (a day with Call desk calls ignores that day's manual report; nothing is added twice)**, and interested = interested leads; conversion = interested leads / calls (one decimal). Definitions and the exact rules: `docs/call-log-assumptions.md`. Also: leads added (created time, UTC), interviews (by scheduled date),
  payment commitments (by commitment date) and **revenue = instalments recorded as received (by date paid)**.
- Targets (calls, interested, interviews scheduled, revenue received) are typed in by an admin per BDE per month; blank = no target.
- "Achieved" percentages are CALCULATED (actual / target) and are shown only where a target exists. They may exceed 100%.
- Setup: `npm run migrate` applies migration 013 (`monthly_targets`).
- Requirements status: see `docs/STATUS.md`.


## Payment proof review (admin)

On an admin payment detail page each proof shows **Awaiting review / Approved / Rejected**. Admin: **Approve**, or **Reject** with a reason (required, max 300 characters). The latest decision, reviewer and time are stored (migration 014: columns on `payment_receipts`); a decision can be changed. BDE: sees the same status and the reason on their own payment, plus a count of rejected proofs on the Dashboard. API: `PUT /api/admin/receipt-reviews/:receiptId` with `{ "decision": "approved" | "rejected", "note": "..." }`.

## Report exports (admin)

Reports page: **Download Excel** (`GET /api/admin/reports/monthly.xlsx?month=YYYY-MM`) and **Download PDF** (`.../monthly.pdf?month=YYYY-MM`). They use the same query as the screen. Libraries: `exceljs` and `pdfkit` (declared in `backend/package.json`). Text from the database is made formula-safe in the Excel file. **The table layout is unit-tested; the library calls were not run in the authoring environment.** After `npm install` run `npm run verify:exports` in `backend`: it generates a real .xlsx and .pdf, reads the xlsx back, checks the PDF structure and prints the folder, so you can open both files.

## Employees (admin)

Admin menu **Employees**: create a BDE with employee ID, full name and password (10 to 200 characters, confirmed twice; hashed on the server, never shown again). The role is fixed to BDE in the server code. `POST /api/admin/employees`. Duplicate employee IDs are refused.

## Verify on your machine

Nothing below could be run where this code was written. Run in this order and fix what fails:

```bash
cd backend
npm install                 # installs exceljs, pdfkit, express, mysql2 ... and creates package-lock.json (commit it)
npm test                    # expected: all unit tests pass (487 when last run)
cp .env.example .env        # fill in DB values and RECEIPT_STORAGE_DIR
npm run migrate             # 20 files, 001-018
npm run create-user -- --role admin --employee-id <ID> --name "<Full Name>"
npm run test:db             # real MySQL integration tests of the older modules, plus tests-integration/call-logs.db.test.js, monthly-calls.db.test.js and chat.db.test.js (written, never run: the import/report/review SQL has no DB test yet)
npm run verify:exports      # real .xlsx and .pdf: open them
npm run dev
# second terminal: the smoke test (see section 3 above)
cd ../frontend
npm install
npm test                    # expected: all unit tests pass (154 when last run)
npm run build               # first-ever production build of the merged frontend: expect to fix small things
```

Then click through in a browser as admin and as a BDE (including the Call desk: click each result on a few leads, double-click one button quickly, undo a call, then check the admin dashboard table): create an employee, import a small CSV and a small .xlsx, submit a daily report, add a lead, schedule an interview, record a payment with a proof, review it, set a target, view the monthly report and download both exports. Check the layout at phone, tablet and desktop widths.
