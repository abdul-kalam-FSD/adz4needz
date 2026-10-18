# Requirement status matrix

**How to read this.** *Code + unit tests*: the code exists and its logic has unit tests that I ran and that passed (backend 487, frontend 154).
Every source file also passes a syntax check (`node --check`; the TypeScript parser for JSX). **No row is verified end to end**:
the application has not been installed, built, run against MySQL or opened in a browser by the authors (no npm registry, no MySQL, no browser were available).
"Verify" below lists what to check on a real machine. Requirements PDF and the TL transcript were first available in Checkpoint 5; earlier checkpoints worked from the brief and notes.

| # | Requirement | Status | Evidence that exists | Still to verify on a real machine |
|---|---|---|---|---|
| 1 | Roles, login, employee ID, password hashing, route guards, profiles | Code + unit tests | auth, users services and tests; older phases were run against MySQL and a browser BEFORE the merge (README "Testing") | login on the merged tree |
| 1b | Admin creates employees | Code + unit tests (new) | `employees.test.js`, `validate-employee.test.js`; BDE role only, admin accounts stay CLI-only | INSERT on MySQL; the Employees screen. No deactivate / reset-password UI |
| 1c | **Sign-in screen redesign** (split screen, states, expired-session handling) | Code + unit tests; CSS/layout checked in headless Chromium on static markup (Checkpoint 7) | `validate-login.test.js`, `client.test.js`, `login-contrast.test.js`; `docs/login-design.md` | the React page itself, real sign-in, build, screen reader. Email sign-in not built (decision needed); no password reset exists |
| 1d | **Team chat** (shared conversation, admin announcements, @mentions, read/unread) (Checkpoint 8) | Code + unit tests; CSS/layout checked in headless Chromium on mirrored markup | `chat.test.js`, `chat.service.test.js`, `chat.repository.test.js`, `chat-app-structure.test.js`, frontend `chat.test.js`, `chat-contrast.test.js`, `client.test.js`; `docs/team-chat.md` | migrations 016-018 on MySQL, all chat SQL, `tests-integration/chat.db.test.js` (written, never run), the React page, build, real HTTP, screen reader. No edit/delete/moderation |
| 2 | Admin dashboard: all BDEs, per-BDE daily activity, calls, leads, interviews, payments | Code + unit tests | admin module + pages (older phases) | browser |
| 3 | BDE dashboard + daily calling report | Code + unit tests | daily-reports module; new `/dashboard` built from existing APIs, helpers tested (`dashboard.test.js`) | browser; the page has never been rendered |
| 3b | **BDE quick-outcome "Call desk"** (one click per call; counts derived from calls) | Code + unit tests (new, Checkpoint 5) | `call-log.test.js`, `call-logs.service.test.js`, `call-logs-app-structure.test.js`, `lib/call-desk.test.js`; rules in `docs/call-log-assumptions.md` | migration 015 + all SQL on MySQL; `tests-integration/call-logs.db.test.js` (written, never run); the page in a browser. Monthly report, My Month, targets and exports now read call logs (row 8) |
| 2b | Admin per-BDE daily calls, interested leads, conversion, status | Code + unit tests (new, Checkpoint 5) | service tests (source precedence, no double counting); admin table `AdminCallStats.jsx` | browser; SQL on MySQL. No per-call drill-down yet |
| 3c | Report **lock / end-of-day freeze** | **Decided: not wanted.** TL chose auto-save with immediate admin visibility (as relayed 2026-10-14; not in the supplied transcript) | nothing to build; see `docs/call-log-assumptions.md` | keep the TL's confirmation on record |
| 4 | Lead management | Code + unit tests | leads module + tests | browser |
| 5 | Interview tracking | Code + unit tests | interviews module + tests | browser |
| 6 | Payment tracking + receipt upload | Code + unit tests | payments module + tests; older phase run against MySQL BEFORE the merge | upload on disk on the merged tree |
| 6b | Payment-proof approve / reject | Code + unit tests (new) | `payment-receipt-review.test.js`; reject needs a note; reviewer + time stored; BDE sees status and reason | migration 014 and the UPDATE on MySQL; the review buttons in a browser |
| 7 | Excel/CSV import with preview, validation, duplicates, confirmation | Code + unit tests (new) | `lead-import`, `import-file-reader`, `imports.service` tests (service with an in-memory fake repo) | **real .xlsx through exceljs**, SQL + migrations 011/012 on MySQL, the page |
| 8 | Monthly report + targets, **now including Call desk calls** (Checkpoint 6) | Code + unit tests | `monthly-calls.test.js` (manual-only, call-log, mixed days, repeats, undone calls, month boundaries, 300-case property test), `monthly-reports.repository.test.js` (SQL text and parameters on a recording fake DB; screen = My Month = targets = export input), `monthly-report.test.js` | **the new `monthlyRows()` SQL on MySQL**; `tests-integration/monthly-calls.db.test.js` (written, never run); the pages |
| 9 | Export: Excel and PDF (new call columns, Checkpoint 6) | Code + unit tests of the table content; **library output never generated** | table cells checked against the report for every BDE and the team total | run `npm run verify:exports` and open both files; the DB test parses the real .xlsx |
| 10 | Responsive UI with loading/empty/error states | Partly | new pages use the shared shell and have loading, error and empty states; no "Coming soon" entries remain in the menu | no responsive or browser check was done at all |
| – | Chat (TL transcript mentions it) | **Not built** | – | needs a decision (1:1 or group, polling or websockets). Optional unless the TL confirms it as mandatory |
| – | Refunds, deleting records, admin password reset, deactivate employee, audit log, upload malware scanning | **Not built** | – | not confirmed requirements |

## Known risks for the first run

- The frontend has never been compiled by Vite. Expect small fixes on the first `npm run build`.
- `exceljs` and `pdfkit` are declared but were never installed where this code was written; no `package-lock.json` exists yet (npm creates it on first install; commit it).
- Migrations 011 to 015 and all SQL (including the rewritten `monthlyRows()`) of the import, monthly report, proof review, dashboard counts and employee creation have never touched a MySQL server. `tests-integration/` has no tests for them yet.
- Monthly report date basis: calls by report date, interviews by scheduled date, commitments by commitment date, revenue by date paid, leads added by created time in UTC. Documented in the README and in the report's "About" sheet.
- 2026-10-18: see docs/CHANGE-REPORT-2026-10-18.md and docs/MIGRATION-RESOLUTION.md for the latest verified status (supersedes older claims where they differ).
