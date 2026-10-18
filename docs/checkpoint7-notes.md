# Checkpoint 7 notes (import sheet selection, login redesign, Team Chat)

Status: **code + unit tests only.** Not run against MySQL, not built with Vite, not seen in a browser. Nothing here is a Team Lead decision unless stated.

## What changed
- **Import:** the XLSX reader prefers a sheet named "Leads Import" or "Leads" (case-insensitive), else the first non-empty sheet (old behaviour). An EMPTY preferred sheet is reported as empty, never replaced by another sheet. New header aliases: "Contact Person" (candidate name), "Assigned BDE ID" (employee ID). No required-field, status or schema change.
- **Login:** split layout (brand panel + sign-in panel) after the Team Lead's reference video, show/hide password, same `login(employeeId, password)` call, same generic error. Login-only colours. Reference-video items NOT built because the app has no such feature: e-mail login, onboarding, client chat.
- **Team Chat (migration 016, routes under `/api/chat`, page `/chat`):** any logged-in user reads and posts; announcements are admin-only (service-enforced); sender always comes from the session; `@EMPLOYEE_ID` mentions link only ACTIVE employees (self-mention ignored, unknown IDs stay plain text); sender or admin can remove (soft delete via `POST /chat/messages/:id/remove`, the project has no DELETE routes); send is retry-safe (client request id); 30 posts/min/user; new messages by 20 s polling.

## Assumptions (to confirm with the Team Lead)
Chat scope (announcements + team chat + @mentions) is the scope given in the continuation brief; the earlier HANDOFF listed chat as needing a TL decision. No private/direct messages, read receipts, attachments, editing, notifications or websockets. All members can see colleagues' names and employee IDs (mention picker). Login colours are a proposal.

## Not verified
Migration 016 and every chat SQL statement on MySQL; real `exceljs` XLSX read; `vite build`; browser behaviour of the login and chat pages (only static HTML mirrors of the markup were rendered with the real CSS); role-based access over real HTTP.
