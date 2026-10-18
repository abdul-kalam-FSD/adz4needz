# Call desk (call log): how it works, assumptions, and the open TL decision

Added in Checkpoint 5. The TL asked that BDEs should not retype what they already know: the admin imports the Excel of students,
and the BDE only clicks **Interested / Not interested / Follow-up / No response** per call. The numbers are then counted by the system.

## What exists

| Piece | Where |
|---|---|
| Table `call_logs` (one row per call) | `backend/db/migrations/015_call_logs.sql` (additive; no existing table changed) |
| Rules (validation, counting, date) | `backend/src/lib/call-log.js` (pure, unit-tested) |
| API | `POST /api/call-logs`, `POST /api/call-logs/:id/undo`, `GET /api/call-logs/summary?date=` (BDE only); `GET /api/admin/call-stats?date=` (admin only, read-only) |
| BDE screen | `/call-desk` ("Call desk" in the menu) |
| Admin screen | "Calls and conversion by BDE" table on the admin dashboard |
| Setting | `REPORT_UTC_OFFSET_MINUTES` (default 330 = India). Decides which working date a call belongs to |

The manual Daily Calling Report (`daily_reports`, `/daily-report`) is **kept as a fallback for days a BDE did not use the Call desk**. For a day that has Call desk calls, the manual report for that day is ignored (never added). See "Monthly report" below.

## Counting rules (NOT defined by the TL; these are my assumptions, each covered by unit tests)

For one BDE on one working date, using their non-undone calls:

| Figure | Rule |
|---|---|
| Total calls | The number of recorded calls. **Every call counts, including repeated calls to the same lead.** A lead is never silently counted once. |
| Different leads called | Number of distinct leads. Repeat calls = total calls - different leads. Shown separately, never as a replacement for total calls. |
| Interested / Not interested / Follow-up / No response | Number of **calls** with that result, so the four always add up to total calls. |
| Interested leads | Number of distinct leads whose **latest** call of that day was "Interested". A lead who said interested and later "not interested" does not count; a lead is never counted twice. |
| Conversion rate | Interested leads / total calls (the TL's example: 30 calls, 5 leads). Shown as "no value" (a dash), never 0%, when there were no calls. |

Why "per call" for the four results but "per lead" for interested leads: the TL's example counts leads per call made, and a lead who is
called three times and finally says yes is one lead, not three.
**Decision needed (small):** is "interested leads / total calls" the intended conversion figure, or "interested leads / different leads called"? (Built as interested leads / total calls everywhere; changing it means changing one function, `conversionPercent`.)

## Working date and time

- The server decides the date; the browser cannot choose it. The date is the server clock plus `REPORT_UTC_OFFSET_MINUTES` (default +05:30), fixed when the call is saved. A call at 00:30 IST belongs to the new day.
- `called_at` is stored in UTC. The browser shows it in the viewer's local time.
- The admin's date picker and the BDE's own "today" are the browser's local dates; they agree with the server's only if the browser is in the same timezone as the setting. **TL to confirm one company timezone.**

## Duplicate clicks

- Every click sends a random request id. The database has a unique key on (BDE, request id), so a repeated delivery of the same click (double-click, retry after a dropped connection) is answered with the original call and counts once.
- In the browser, a lead's buttons are disabled while a save is running, and a retry after a failed save re-sends the same id for the same button.
- Two separate deliberate clicks are two calls. There is no time window that merges them (that would silently lose real repeat calls).
- A request id reused for a different lead or result is refused (409), not treated as success.

## Errors are never shown as success

The page shows "Saved" only after the server confirms. Totals are the server's numbers, re-read after each save; the browser never adds one itself.
If the save fails, the row shows "Not saved: ..." and nothing is counted. If the save succeeds but the totals cannot be refreshed, the page says so.

## Undo

A BDE can undo their own call **on the same working day**. The row is kept (`voided_at`) for the audit trail but is excluded from every figure.
Undo does **not** change the lead's status back (the status may have been edited since). Recording the right result overwrites the status.

## Lead status

Recording a result moves the lead to the status with the matching **name** (Interested, Not Interested, Follow-up Required, No Response / Not Reachable; migration 004).
Statuses are data and the TL may rename them: if a name is not found, the call is still saved and the response says the status was not updated.
A follow-up date can be given with "Follow-up"; it is stored on the lead (not in the past).

## Admin figures: which source wins

For each BDE and date: if the BDE has Call-desk calls, those are used; otherwise the manual report is used; **the two are never added together.**
If both exist, the manual figures stay visible next to the call-log figures. A BDE with only a manual report has no per-lead data, so their typed "interested" is used as the lead count and "different leads" is blank.

## Monthly report, My Month, targets and exports (Checkpoint 6)

All of these read **one** set of figures: `monthlyRows()` in `monthly-reports.repository.js`, which merges the call log and the manual reports with the pure function `monthlyCallingByUser()` (`backend/src/lib/monthly-calls.js`). The team screen, My Month, target progress, and the Excel and PDF files cannot disagree because they are built from the same report object.

**Source rule, per BDE per working date:** a day with at least one non-undone Call desk call uses the call log, and that day's manual report is **ignored** (reported only as "manual calls ignored"); otherwise a day with a manual report uses the typed figures; otherwise the day has no activity. The same rule is used by the admin daily table.

| Monthly figure | Definition |
|---|---|
| Calls | Call desk calls (every call, repeats included) + typed total of manual-only days |
| Interested (leads) | Distinct leads whose **latest call in the month** was Interested, + typed "interested" of manual-only days. This is the figure the interested target is measured against |
| Interested calls | Calls that ended Interested + the same typed number (in the API as `interestedCalls`) |
| Not interested / Follow-up / No response | Calls with that result (call-log days) + typed counts (manual-only days) |
| Distinct leads / Repeat calls | Different leads called on Call-desk days; repeat calls = Call-desk calls - distinct leads. Manual days carry no lead data, so they are not included |
| Conversion | Interested leads / calls, percentage rounded **half-up to one decimal**, shared by every screen and file (`conversionPercent`). Empty (not 0) with no calls. Team conversion = team interested / team calls, not an average of BDE rates |
| Days with activity | Call-desk days + manual-only days. Also shown: days from each source, days with both, manual calls ignored |
| Target progress | Calls: calls / calls target. Interested: interested leads / interested target. Revenue and interviews unchanged |

Things that behave differently from before, on purpose:
- A lead is counted once **per month** as interested, so the monthly interested figure can be lower than the sum of the daily ones (a lead who is interested on Monday and again on Wednesday is one lead, two interested calls).
- Manual days cannot be de-duplicated against Call desk leads (they have no lead identity). A BDE who mixes manual and Call desk days has typed interested numbers added to lead counts.
- The conversion rounding changed from "floor" to the shared "round half-up to one decimal" so the daily and monthly numbers are always identical. For existing manual-only data this can change the last digit (for example 16.66% was shown as 16.6 and is now 16.7).
- Dates are working dates (`REPORT_UTC_OFFSET_MINUTES`). A call at 00:30 IST on 1 November is a November call.
- API (additive; no field was removed or renamed): `figures.calls` gained `interestedCalls`, `distinctLeads`, `repeatCalls`, `sources`; `figures.calls.interested` now means interested **leads**. Excel: new columns after "Interested", and "Days with a daily report" is now "Days with activity". PDF: two columns appended (Conversion, Distinct leads).

Scale note: the call events of the month are read into memory and summarised in JavaScript (a few thousand rows per BDE per month at most; about 100,000 for a 30-person team making 100 calls a day). If this ever becomes slow, replace the event read with a grouped query per BDE, day and lead; the pure function's tests describe the expected result.

## Still not built

- Admin per-BDE drill-down of the individual calls (names and times) is not built; the per-BDE figures are.
- Bulk marking of many leads at once is not built (one click per call).

## TL decision recorded: no end-of-day lock

The TL's wording in the transcript about BDEs "locking" their details was ambiguous. The decision relayed on 2026-10-14 is: **auto-save, immediate admin visibility, no mandatory end-of-day locking.** That is what exists: calls are saved on each click, the admin sees them at once, and nothing freezes a day. I did not build a lock, a `day_locks` table, or a "Submit day" button. (This decision is taken from the request that started Checkpoint 6; it is not in the supplied transcript, so please keep the TL's confirmation with the project records.)

Consequences to be aware of, not bugs:
- Figures for a day can still change until the BDE stops calling (undo works on the same day only), so a monthly figure for the **current** month moves as the month goes on, and yesterday's numbers can change only through a same-day undo or a manual report added later.
- The manual daily report can still be created once per day and cannot be edited through the app (existing behaviour, unchanged). If a BDE submits a manual report and then uses the Call desk the same day, the Call desk calls win.

## What has and has not been verified

Verified here: unit tests (rules, service with an in-memory repository, wiring guards, frontend click-state logic) and a syntax check of every JSX file.
**Never run:** migration 015, any SQL in `call-logs.repository.js` and the new `monthlyRows()` SQL, `tests-integration/call-logs.db.test.js` and `tests-integration/monthly-calls.db.test.js` (both written, never executed), the real Excel/PDF generation (`npm run verify:exports`), the Vite build, the pages in a browser, and concurrency behaviour under real MySQL (the lock-order and retry code are reasoned, not observed).
