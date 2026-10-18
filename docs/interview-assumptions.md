# Interviews — assumptions awaiting TL confirmation

The project PDF lists these Interview Tracking items: number of interviews scheduled, candidates who attended,
candidates who did not attend, candidates selected or interested in joining, candidates who confirmed payment.
It does **not** define stages, rules between them, who may change what, or how scheduling works.
Everything below is a technical proposal, not a company policy. Nothing here should be presented to the company as confirmed.

## What the PDF gives vs. what was added

| Item | Source |
|---|---|
| Scheduled, Attended, Did not attend | PDF |
| Selected | PDF ("selected or interested in joining") |
| Interested in joining, Payment confirmed | PDF |
| **Pending** (attendance, outcome) and **Not Selected** (outcome) | Requested for Phase 5; the PDF has no neutral/negative outcome values |
| Date **and time** of the interview | Requested for Phase 5 |

## Decisions that need a TL answer

| # | Topic | What the code does now | Question for the TL |
|---|---|---|---|
| 1 | Attendance values | Pending / Attended / Did Not Attend (database ENUM) | Any other value, e.g. Rescheduled or Cancelled? Changing the list needs a new migration, not just SQL. |
| 2 | Outcome values | Pending / Selected / Not Selected (database ENUM) | Same question (e.g. On Hold). |
| 3 | **Outcome only after attendance** | An outcome other than Pending is rejected unless attendance is Attended. One constant in `validate-interview.js` (`OUTCOME_REQUIRES_ATTENDANCE`) turns this off. | Is this right? Can someone be Selected without attending (e.g. selected from a portfolio)? |
| 4 | Several interviews per lead | Allowed (no unique key on the lead). Each has its own attendance/outcome. | Is one interview per lead enough, or are second rounds tracked here? Does a "Selected" in round 1 count again in round 2 for the monthly report? |
| 5 | Reschedule | Edit the date/time of the same interview; there is no history of earlier dates. | Must reschedules be counted or audited? |
| 6 | Time zone | The date and time are stored exactly as typed (no conversion). Correct only if the whole team uses one time zone. | Confirm a single company time zone. |
| 7 | Past dates | Allowed, so a BDE can record an interview afterwards. | Should scheduling in the past be blocked? Should attendance be blockable before the interview time? (Not enforced.) |
| 8 | "Interested in joining" | Yes / No / Not recorded (three states, independent of the outcome). | Is it recorded only for Selected candidates, or for everyone who attended? |
| 9 | "Payment confirmed" | A yes/no flag on the interview only. No amount, date, instalment or receipt (those belong to the Payments module). Not tied to Selected or Interested. | Can payment be confirmed without being Selected? When Payments is built, does this flag stay manual or become derived from payment records? |
| 10 | Status indicators | "Update attendance" = interview date has passed and attendance is still Pending. "Today" / "Upcoming" (any day after today, no limit) by date only. "Today" comes from the browser. | Different rules, e.g. a grace period? |
| 11 | Relation to lead status | None. Scheduling an interview does not change the lead's status, and lead statuses do not include interview stages. | Should lead status follow the interview (e.g. Interview Scheduled, Selected)? Or stay separate? |
| 12 | Leads that are "closed" | Interviews can still be scheduled for a lead whose status stops follow-up (e.g. Not Interested). | Block it? |
| 13 | Admin rights | **Read-only** for interviews: lists, details and a per-BDE overview. Admin cannot create, edit or delete. | Should Admin or the TL correct attendance or outcome? (Would need an audit trail.) |
| 14 | Delete / cancel | Not built. | Is deleting a wrongly created interview needed? Who may do it? |
| 15 | Moving an interview to another lead or BDE | Not possible. An interview always keeps its lead; its BDE always equals the lead's owner (enforced by the database). | Lead reassignment between BDEs is not built; if it is wanted later, interviews must move with the lead. |
| 16 | Edit rule | A BDE can edit all fields of their own interviews at any time, including after an outcome is set. | Lock after a certain point? |
| 17 | Update semantics | An update must send every field (no silent resets). | Technical choice, no business impact. |
| 18 | Overview counts | Per BDE, over interviews whose date falls in the chosen range: scheduled, attended, did not attend, attendance pending, selected, not selected, interested in joining (= Yes), payment confirmed. Plain counts, not defined KPIs. | Which counts feed the monthly performance report, and is "attended" counted per interview or per candidate? |

## Not part of this phase
Payment amounts, dates, instalments, receipts and Admin review of proofs; Admin dashboard metrics; monthly performance report; Excel export.
