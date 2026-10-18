# Sign-in screen: reference video mapping, decisions, and what was verified

Added in Checkpoint 7. Reference: `adz4needzapp_2.mp4` (54 s screen recording of an employee workspace). The final login screen in that video is the visual reference; the rest of the video was used only to map screens to this application.

## What the video shows, and how it relates to this application

| Video screen | What it is | In this application | Required by the TL? |
|---|---|---|---|
| Final **login** screen ("Welcome back!", split screen, purple gradient left, green button) | Employee ID or email + password, show/hide, "New to the team? Start your onboarding journey", "Start Client Chat" | **Built** (`pages/LoginPage.jsx`), with the differences listed below | Yes (login) |
| New Employee Onboarding wizard (4 steps: Personal, Role & Education, Documents, Review) | A person submits their own application, including date of birth, address and documents | **Not built.** Today an admin creates the employee ID, name and first password (Admin > Employees) | The TL's words: the admin gives an employee ID when onboarding (that is what exists). A self-service application form was not requested |
| Splash "Loading your workspace..." | Transition screen | Not needed; the app already shows a loading state while it checks the session | No |
| Dashboard (greeting, punch in/out clock, task and report counters, team status) | Employee home | The BDE dashboard exists (leads, follow-ups, today's calls, report status). Punch in/out, tasks and team status are not built | No |
| Sidebar: Dashboard, My Tasks, Video Meetings, Team Chat, Leave Requests, Sheets, Daily Report, My Profile, Settings, Sign Out | Navigation | Existing sidebar (Dashboard, Call desk, Daily Report, Leads, Interviews, Payments, My Month, Profile) | **Team Chat: yes (not built yet).** Video meetings, leave, tasks, sheets: no, and not invented |
| My Tasks (kanban), Leave Requests | Task and leave modules | Not built | No |
| My Profile (employee ID, department, email, attendance, status), Settings (change password, notifications) | Profile | Profile page exists (name, email, change password). Attendance, availability status, notifications: not built | No |
| Toast "Signed out successfully" | Feedback | Built as a notice on the sign-in screen | Part of login UX |

## Decisions where this deliberately differs from the reference or from the brief

1. **Sign-in is by employee ID only, not "employee ID or email".** The backend authenticates by employee ID. A user's email is optional, unverified and deliberately **not unique** (migration 008: colleagues may share a team mailbox), so logging in by email could be ambiguous and would be a change to the authentication scheme, which the brief says not to invent. If someone types an email the screen explains this. **TL decision needed:** if email sign-in is wanted, emails must first become unique and verified.
2. **No onboarding link.** The reference links to a public self-onboarding wizard. This application has no public onboarding (accounts are admin-created), so the screen says "Your admin creates your employee ID and first password. Ask them to set you up." Adding a link to a form that does not exist would be a dead control.
3. **No "Start Client Chat" button.** It is a different feature in the reference. Team chat is a TL requirement but is not built; no placeholder button was added.
4. **No password reset.** The app has no reset flow (the Profile page lets a signed-in person change their password). The screen says "Contact your team admin" and does not promise a reset. An admin-initiated password reset is a gap to raise with the TL.
5. **Branding is this project's own:** ADZ4NEEDZ, "BDE Team Management", an "A4" tile. The reference's "Ad Squad" name and wording were not copied.
6. **The sign-in button uses dark text on green.** The reference uses white on green, which measures 1.7:1 (WCAG AA needs 4.5:1). Dark text measures 6.5 to 8.6:1.

## Behaviour

- Real authentication: `POST /api/auth/login`, HttpOnly session cookie, existing password hashing; nothing about the scheme changed. The server still decides who may sign in; the screen only gives faster feedback.
- Frontend checks (`lib/validate-login.js`): ID required, at most 64 characters, no spaces, no `@`; password required, at most 200. Backend check added: an ID longer than 64 characters is refused with 400 before any lookup or password hashing (`auth.service.js`). The password is never trimmed or altered.
- Errors, in plain sentences: wrong details (the same message for an unknown ID, an inactive account and a wrong password, as before), too many attempts (429), no connection, server problem, validation. After wrong details the password is cleared and focus returns to it; after a connection or server problem what was typed is kept so a retry is one click.
- Double submit: a request guard is set synchronously, so a fast second Enter or click cannot start a second request. Fields become read-only (not disabled, so keyboard focus is not lost) while signing in.
- **Expired sessions (new):** a protected API call answered `401 UNAUTHENTICATED` while someone is signed in returns them to the sign-in screen with "Your session has ended...". A failed login (`INVALID_CREDENTIALS`), the startup check and logout never trigger it. It covers JSON calls and the two file uploads; plain download links are browser navigations and cannot be intercepted.
- After signing out on purpose, the screen says so and the next sign-in goes to the home page (not to the previous person's last page). Otherwise a person returns to the page they were trying to open; only paths inside the app are accepted (`safeDestination`).
- Role routing is unchanged: `/` sends admins to `/admin` and BDEs to `/dashboard`; every page is wrapped in `RequireRole`, and the server enforces roles on every API call.

## Accessibility and responsive design

- Colours are tokens on `.login-page`; `styles/login-contrast.test.js` computes WCAG contrast from the real CSS: all text pairs reach 4.5:1 (checked against the lightest purple in the gradient, the worst case), headings on white reach 7:1, input borders and the focus ring reach 3:1.
- Labels are tied to inputs; the required marker is visual plus `aria-required`; errors are linked with `aria-describedby` and `aria-invalid`; the failure alert is `role="alert"` and notices are `role="status"`; show/hide is a real button with `aria-pressed` and a changing label; a Caps Lock hint is announced politely; a skip link jumps to the form; browser password managers work (`autocomplete="username"` and `current-password`).
- Layout: phone (single column, compact brand header, from 320 px), tablet from 640 px (brand banner shows its paragraph), desktop from 960 px (two columns, brand left). Touch targets 48, 52 and 44 px. No external fonts or images. Reduced motion switches off the entrance animation, button lift, transitions and spinner. A forced-colors (high-contrast) fallback exists.

## What was verified, and how

- `npm test` (frontend): validation, failure messages, safe redirect, the expiry hook of the API client (with a stubbed `fetch`), and the stylesheet (contrast, breakpoints, reduced motion, focus styles, no external resources). Eight deliberate stylesheet breaks were all caught.
- In **headless Chromium**, the real `styles.css` rendered with static markup that mirrors the component, at 1440, 820, 390 and 320 px and in eight states (default, validation errors, email typed, failed sign-in, signing in, session ended, signed out, password shown with Caps Lock): no horizontal overflow at any width; keyboard order skip link, ID, password, show/hide, sign in, with a visible indicator on each; reduced motion honoured; the layout switches exactly at 960 px.
- **Not verified:** the React component itself has never been rendered or clicked (no React install here, and `vite build` has not run). The static markup was written by hand to mirror it. Real sign-in against the backend and MySQL has not been exercised. Not tested with a screen reader, Safari or Firefox, or on a real phone.

## Next checks on a real machine

```
cd bde-app/frontend && npm install && npm test && npm run build && npm run dev
```
Then, with the backend running: sign in as an admin and as a BDE; type a wrong password; type an email; sign out and sign back in; delete the session row (or wait for expiry) and click anything to see the "session has ended" notice; resize to phone width; tab through the form.


---

# Update: Employee Sign In, Admin Sign In, Create BDE Account, first-admin bootstrap

Reference: `Screen_Recording_2026-10-16_075339.mp4` (a different product's portal: a Sign In / Create Account switch at the top of the form and an "Are you an employee? Employee Login" link at the bottom). Only the layout idea was used (a segmented switch plus a footer link); the project's own branding, colours and wording were kept.

## What the video shows, and what was deliberately NOT copied

| In the video | Here |
|---|---|
| A public **Create Account** tab with name, email, phone, password | **Not built.** Public self-registration is exactly what the brief forbids. Accounts are created only by a signed-in admin. |
| Sign In / Create Account switch | **Employee Sign In / Admin Sign In** switch (real ARIA tabs, arrow keys work) |
| "Are you an employee? Employee Login" footer link | Footer links to the other tab on each tab |
| A multi-step onboarding wizard | Not built (not requested) |

## The four flows

1. **Employee Sign In (default tab).** Unchanged: same form, same validation, same `POST /api/auth/login` body `{ employeeId, password }` (no new field), same errors and loading state.
2. **Admin Sign In.** Same form, sent with `portal: "admin"`. The **server** then lets only an administrator account in: a BDE who types a correct password here gets the same generic 401 as a wrong password, and no session is created (`auth.service.js`). Admins can still use either tab. The page's wording for a refusal ("incorrect, or this is not an administrator account") does not say which one it was.
3. **Create BDE Account.** A link on the Admin tab (`/login?as=admin&task=create-bde`). It is a *sign-in*, not a form: after an admin signs in it opens **Admin > Employees** (`/admin/employees`), the existing form that calls `POST /api/admin/employees`. That API was already admin-only (`authenticate` + `authorize('admin')`, checked again inside the service), creates only `role = 'bde'` (the role is a constant in the SQL), rejects any extra field such as `role`, hashes with the existing scrypt helper, answers 409 for a duplicate employee ID (the column is UNIQUE; MySQL compares it case-insensitively) and returns no password or hash. Nothing about it changed.
4. **First admin.** `npm run bootstrap-admin -- --employee-id <ID> --name "<Full Name>"`, run once in a shell on the server. It asks for the password at a hidden prompt, validates with the same rules as every account, and creates an admin **only while the users table has no admin** (one `INSERT ... SELECT ... WHERE NOT EXISTS` statement). Once any admin exists it refuses. There is no HTTP route, setup page or "is there an admin?" endpoint, so a public visitor cannot become an admin or even learn that none exists. `create-user --role admin` still exists for adding a further admin by someone with server access.

## Security properties (and where they are tested)

- Public registration cannot assign an admin role: no register/signup/setup route exists (`backend/tests/account-flows.http.test.js`, `backend/tests/bootstrap-admin.test.js`, `frontend/src/lib/login-modes.test.js`).
- Only an authenticated admin can create a BDE: no session -> 401, forged cookie -> 401, BDE -> 403, admin -> 201 (route-level tests against the real Express app).
- Employee ID uniqueness: exact and different-case duplicates -> 409 and the existing account's password still works. **The real MySQL UNIQUE index has not been exercised** (the tests emulate it).
- A `portal` or `role` sent by a client can never grant anything: unknown portal -> 400 before any lookup; `role` in the login body is ignored; `role`, `isActive`, `portal` and every other extra field on account creation -> 400.
- No password or hash in any response (checked on the login, create-account and duplicate-ID responses).

## Not changed (and why)

- The login endpoint, session storage, cookie settings, rate limiter and password hashing.
- The Employees page and `POST /api/admin/employees`.
- No database migration: nothing about the schema needed to change.
- No password reset and no email sign-in (same open items as before).
