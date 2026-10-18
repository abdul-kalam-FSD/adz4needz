# Leads — assumptions awaiting TL confirmation

The project PDF lists these Lead Management fields: candidate name and contact details, course or
internship interested in, lead status, follow-up date, next action required. It does **not** define
the lead statuses, the follow-up window, or any duplicate policy. Everything below is a technical
proposal, not a company policy. Nothing here should be presented to the company as confirmed.

## Proposed lead statuses (seeded by `backend/db/migrations/004_seed_proposed_lead_statuses.sql`)

| Status | Why proposed | Stops follow-up tracking? |
|---|---|---|
| New | Starting state for a lead just added | No |
| Interested | Mirrors "Interested candidates" in the PDF's Daily Calling Report | No |
| Follow-up Required | Mirrors "Follow-up required" in the PDF | No |
| No Response / Not Reachable | Mirrors "No response / not reachable" in the PDF | No |
| Not Interested | Mirrors "Not interested candidates" in the PDF | **Yes** (`closes_follow_up = 1`) |

Later stages (interview scheduled, selected, payment pending, paid ...) are deliberately NOT
included: they belong to the Interview and Payment modules, and the TL should decide whether lead
status or those modules own that progression.

### How to change the list after the TL decides
Statuses are rows in `lead_statuses`, not code. No redeploy is needed.

```sql
UPDATE lead_statuses SET name = '<new name>' WHERE name = '<old name>';          -- rename
INSERT INTO lead_statuses (name, sort_order, closes_follow_up, is_active, created_at)
  VALUES ('<name>', 60, 0, 1, UTC_TIMESTAMP());                                  -- add
UPDATE lead_statuses SET is_active = 0 WHERE name = '<name>';                    -- retire
UPDATE lead_statuses SET closes_follow_up = 1 WHERE name = '<name>';             -- stop follow-up tracking
```
Do not DELETE a status that leads use (foreign key). Retire it instead: existing leads keep it and
stay editable; it just disappears from the choices for new leads.

## Other assumptions

| Topic | What the code does | Needs TL decision |
|---|---|---|
| Contact details | Phone and email both optional, but at least one is required; phone 7–15 digits | Is one always mandatory? |
| Course / internship | Free text, max 150 characters | Fixed list or free text? |
| "Upcoming" follow-up | Next 7 days after today (`UPCOMING_DAYS`) | Window length |
| "Today" | Sent by the browser, so no server timezone guess | — |
| Duplicates | Same phone (last 10 digits) or same email (case-insensitive), across all BDEs. Warns; BDE must confirm; never merges or blocks | Should a duplicate across BDEs be blocked, or routed to the TL? Who owns a lead two BDEs both contacted? |
| Duplicate privacy | A BDE sees details of own matches only; other BDEs' matches appear as a count | Is that the right visibility? |
| Admin rights | Read-only on leads | Should admin be able to edit or reassign? |
| Delete / reassign | Not built | Needed? |
| Edit history | None (only `updated_at`) | Is an audit trail required? |
