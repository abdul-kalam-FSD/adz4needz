# Team chat (Checkpoint 8)

One shared conversation for the whole team, with admin-only announcements, @mentions and read/unread indicators. Menu entry **Team chat** for both admins and BDEs (`/chat`).

## What the TL asked for, and where it is

| Requirement | How it is done | Verified how |
|---|---|---|
| Shared team conversation, persisted | Table `chat_messages`; `GET/POST /api/chat/messages`; polling every 5 s while the page is open | Unit tests with an in-memory repository; SQL text checked; **real MySQL: not run** |
| Admin-only announcements | `kind = 'announcement'`; the service answers **403** to anyone who is not an admin, nothing is stored; announcements are highlighted and have their own tab | Unit tests (incl. mutation checks); **HTTP and MySQL: not run** |
| @mentions of specific people | Typed as `@handle`; the **server** finds them and stores their positions in `chat_mentions` | Unit tests incl. Tamil/Hindi names, punctuation, emoji offsets |
| Read/unread indicators | One read cursor per person (`chat_reads`); menu badge, "New messages" line in the thread, "mentions you" tag, and "Read by N of M" on announcements for admins | Unit tests; layout in a real browser on mirrored markup; **real MySQL: not run** |
| Responsive UI consistent with the new login design | Same purple and green identity; phone, tablet, desktop; contrast, focus, reduced motion | CSS tests and headless Chromium on mirrored markup; **the React page itself never rendered** |
| Backend authorization, validation, tests | Every route needs a logged-in admin or BDE; sender comes from the session; input validated; per-person rate limit | Unit and source-level tests; **real HTTP: not run** |

## Design decisions (and why)

- **Polling, not WebSockets.** Session-cookie authentication already works for plain requests; WebSockets would need new server infrastructure and a dependency. At about 30 people the load is small: the chat page asks "anything new after message N?" every 5 s only while it is open and the tab is visible; the menu badge asks a very small question every 30 s on every page. Worst case roughly 6 requests per second for the whole team, each a few indexed queries. Delay: a new message appears within about 5 s on the chat page and within about 30 s on the badge. Polling pauses while the tab is hidden and backs off (up to 60 s) after errors.
- **A read cursor, not a flag per message.** Each person has one number: the newest message they have read. Unread = newer than the cursor and not sent by you. The cursor only moves forward and cannot pass the newest message. A person who has never opened the chat has read nothing (their badge shows up to "99+" until they open it once).
- **Mentions use a name-based handle, never the employee ID.** The employee ID is also the login name, so listing IDs to every colleague (and showing who the admins are) would hand out half of every credential. A handle is the display name in lower case with words joined by dots: "Asha Verma" is `@asha.verma`. If two active people would get the same handle, the one with the lower id keeps it and the other gets `-<id>` added (`@asha.verma-17`), so existing handles never change when someone joins. Handles keep letters of any script (Tamil, Hindi, ...).
- **Mentions are found by the server.** The text is matched against the active team directory; the browser cannot claim a mention. The position of each `@handle` is stored with the message, so old messages never change if someone is later renamed or deactivated (the chip shows the person's current name). Matching is strict and case-insensitive; a trailing `.` `-` `_` is ignored ("thanks @asha.verma."); partial handles, unknown people, inactive people and email-like text (`a@b.com`) are not mentions. At most 20 per message.
- **Messages are plain text.** Stored as typed (trimmed, line breaks normalised), up to 2,000 characters; control characters are refused. The browser shows them as text nodes (React escapes them); the page never uses `innerHTML` or `dangerouslySetInnerHTML` (a test fails if that appears). Links are not made clickable.
- **Repeated sends are safe.** Every send carries a random request id; a unique key on (sender, request id) turns a double click or a retry after a dropped connection into one message. After a failed send the same text re-sends the same id. A request id reused for a different text is refused (409).
- **Flood protection.** 20 messages per person per minute (setting `CHAT_SEND_RATE_LIMIT_MAX`), then `429`. Reading is not limited.
- **No edit, no delete, no direct messages, no attachments.** Not requested. See limitations.

## Data model (migrations 016, 017, 018; three files because MySQL DDL is not transactional)

| Table | Holds |
|---|---|
| `chat_messages` | id, sender_id, kind (`message`/`announcement`), body (max 2000 chars), client_request_id, created_at (UTC). Unique (sender_id, client_request_id) |
| `chat_mentions` | message_id, start_pos, end_pos, user_id. One row per mention occurrence |
| `chat_reads` | user_id (primary key), last_read_message_id, updated_at |

All three are new tables; no existing table, rule or data is touched (account creation, call log, monthly report and Excel import are unchanged).

## API (all require a logged-in admin or BDE; JSON only; the sender is always the session user)

| Request | Purpose | Notes |
|---|---|---|
| `GET /api/chat/members` | People you can mention: `[{ id, name, handle }]` | Active accounts only; no employee IDs, no roles |
| `GET /api/chat/messages?kind=all\|announcement&limit=1..100&before=ID` | Newest page (default 50), or older messages | Oldest first; `hasMore` says whether older ones exist |
| `GET /api/chat/messages?after=ID&kind=...` | Everything newer than ID (what the screen polls for) | Up to 200; `more: true` means ask again at once |
| `POST /api/chat/messages` `{ body, kind?, clientRequestId }` | Send. `201` new, `200` + `duplicate: true` if the same request id was already used | `403` for an announcement by a BDE; `400` with field messages; `409` request id reused for other text; `429` too many |
| `GET /api/chat/unread` | `{ lastReadMessageId, latestId, unread: { unread, mentions, announcements } }` | What the menu badge polls |
| `POST /api/chat/read` `{ upTo }` | "I have read up to this message." Forward only; clamped to the newest message | Returns the same shape as `unread` |

Every message in a response: `id, kind, body, createdAt (UTC), sender { id, name, role }, mine, mentions [ { start, end, userId, name } ], mentionsMe`, and for admins on announcements `readBy { count, total }`.
"Read by" = people (other than the sender, active accounts only) whose cursor is at or past that announcement. It means "opened the chat after it was posted", not proof that someone read it carefully.

## Applying the migrations

```
cd bde-app/backend
# 1. Back up first (recommended on any real database):
mysqldump -u <user> -p <database> > backup-before-chat.sql
# 2. Apply (safe to repeat: applied files are skipped):
npm run migrate
```
Expected output ends with `apply  016_chat_messages.sql`, `apply  017_chat_mentions.sql`, `apply  018_chat_reads.sql` and `Done. 3 migration(s) applied.` Check:
```sql
SELECT filename FROM schema_migrations WHERE filename LIKE '01[678]%';   -- 3 rows
SHOW TABLES LIKE 'chat_%';                                              -- chat_messages, chat_mentions, chat_reads
```
Before applying, run `npm run chat:schema` (read-only). If it reports old-design chat tables, follow "Team chat table clash" in `docs/migration-map.md` first.

No downtime is needed: the tables are new and the running application does not use them until the new code is deployed. Restart the backend after deploying the code (and optionally set `CHAT_SEND_RATE_LIMIT_MAX` in `.env`).

## Rollback path

- **Code:** restore the Checkpoint 7 package (`BDE_Team_Management_Checkpoint7.zip` is unchanged). Checkpoint 7 does not read the chat tables, so leaving them in place is harmless.
- **Data (destructive, only after a backup; this deletes every chat message):**
```sql
DROP TABLE chat_mentions;   -- children first
DROP TABLE chat_reads;
DROP TABLE chat_messages;
DELETE FROM schema_migrations WHERE filename IN ('016_chat_messages.sql', '017_chat_mentions.sql', '018_chat_reads.sql');
```
  Running `npm run migrate` again re-creates the tables (empty).

## Manual browser test (needs the backend with MySQL, the frontend, and three accounts: one admin, two BDEs "Asha" and "Ravi")

1. Open two different browsers (or one normal and one private window): sign in as Asha in one, Ravi in the other, admin in a third.
2. Asha opens **Team chat**: she sees "No messages yet". The composer is enabled.
3. Asha sends `Hello team`. It appears at once on her screen as "You". Within about 5 s it appears on Ravi's open chat page, and Ravi's menu shows a badge (within about 30 s if he is on another page).
4. Double-click **Send** quickly with a new text: only one message appears. Press Enter twice quickly: still one.
5. Ravi types `@` and part of Asha's name: a list opens; arrow keys and Enter pick her; `@asha.verma` is inserted. He sends it. For Asha the message shows "Mentions you", a highlighted bar, and her badge reads `@ 1`.
6. Type `@nobody` and `me@example.com` in a message: neither is highlighted.
7. Paste `<script>alert(1)</script> <img src=x onerror=alert(1)>`: it is shown as literal text; no alert appears.
8. As Ravi try to post an announcement: there is no checkbox for BDEs. (To test the server rule directly, send `{"body":"x","kind":"announcement","clientRequestId":"<uuid>"}` to `POST /api/chat/messages` with Ravi's cookie: expect `403`.)
9. As admin tick **Send as an announcement**, post it: green card, "Announcement" tag, the **Announcements** tab shows it, Asha and Ravi see "(1 new)" on that tab. The admin sees "Read by 0 of N" rising as they open the chat.
10. Open chat as Ravi while scrolled to the bottom: the "New messages" line shows above what was unread, the badge clears. Scroll up, have Asha send another message: Ravi sees "New messages below" and is **not** marked as having read it until he scrolls down.
11. Send 21 messages within a minute: the 21st shows "You are sending messages too quickly. Please wait a moment." and the text stays in the box.
12. Stop the backend while the chat is open: a "Trying to reconnect" notice appears; send a message: "Not sent: Could not reach the server..." and the text is kept. Start the backend, press Send: it is delivered once.
13. In MySQL delete Asha's row in `sessions` and click anything: she is returned to the sign-in screen with "Your session has ended".
14. Resize to phone width (about 390 px): the conversation fits the screen, the box and Send stay at the bottom, the menu drawer shows the badge.

## What was verified and what was not

| Check | Status |
|---|---|
| Backend unit tests (487) and frontend unit tests (154) | **Passed** (see the final report for the exact commands) |
| 21 deliberate breaks of the backend rules and 11 of the stylesheet/rendering rules | All caught (after two test gaps were closed) |
| Contrast, focus, tab order, reduced motion, touch targets, page fit, no overflow at 390 and 1440 px | **Checked in headless Chromium on hand-written markup that mirrors the page** |
| The React page rendered and clicked; `npm run build`; real HTTP; MySQL migrations and all chat SQL; the race test (`tests-integration/chat.db.test.js`, written, never run); screen reader; Safari/Firefox; a real phone | **Not run** |

## Known limitations

- No editing or deleting of messages and no admin moderation. A wrong announcement cannot be retracted from the app (recommended next step).
- One conversation only: no direct messages, rooms, threads, search, attachments, reactions, typing indicators, push or email notifications.
- Updates are polling: up to about 5 s on the page, about 30 s for the badge; nothing arrives while the tab is hidden or the phone is asleep.
- A person who has never opened the chat sees every message as unread (badge "99+"). Messages never expire.
- "Read by" is cursor-based (see above). Reading a later message counts as reading earlier ones.
- If someone is renamed, new messages use their new handle for suggestions; stored messages keep their positions and show the current name. Two people with the same name are told apart by the `-<id>` suffix in the suggestion list.
- Times are stored in UTC and shown in the viewer's local time.
- Everyone who is signed in can see every message ever sent (there is no per-person or per-role privacy inside the single conversation).
- Behind a reverse proxy, nothing special is needed (the rate limit is per person, not per address), but proxies must not cache `GET /api/chat/*`.
