# UI redesign: muted purple + sage green (2026-10-17)

Stylesheet in use: `frontend/src/styles/styles.css` (imported by `src/main.jsx`). The old `style.css` was an unreferenced duplicate and was removed.

## Tokens
Old token names (`--purple-*`, `--green-*`) are kept so every rule keeps working; `--green-*` now holds sage. New code should use the semantic aliases
`--color-sidebar / -primary / -primary-hover / -page / -surface / -text / -text-muted / -border / -success / -warning / -danger / -focus`.

| Role | Value | Notes |
|---|---|---|
| Sidebar / top bar / login brand panel | `#292640` | flat, no gradient |
| Primary action (button fill) | `#647B68` | white text 4.6:1 |
| Primary hover, **and all sage text/links** | `#566C5B` | 5.7:1 on white. `#647B68` as text is only 4.2:1 on the warm page, so it is never used for text |
| Page / card | `#F5F4F1` / `#FFFFFF` | |
| Text / secondary text | `#34343B` / `#5F5E69` | |
| Lavender tint | `#EEECF3` | slightly lighter than `#E8E6EF` so secondary text stays above 4.5:1 on it |
| Form-field borders | `#8A8794` (login/chat `#7D7A88`) | 3.5:1 or better on white |

## Verified
Computed-style sweep of every visible text node on every routed page (admin and BDE, 1280 and 390 px): 0 findings below 4.5:1 (3:1 for large text).
Excludes disabled controls, and non-text UI contrast is covered only by the pinned token pairs in `src/styles/*.test.js`.

## Behaviour changes (not only styling)
- BDE lead list: status dropdown per lead. There is no status-only endpoint, so `api.setLeadStatus` reads the lead (`GET /leads/:id`) and writes it back
  with `PUT /leads/:id` changing only `leadStatusId`. The row changes only after the server confirms; failures leave the old value and show the message.
  `HANDOFF.md` mentions `PATCH /leads/:id/status`: that route does not exist in this code base.
- Call Desk and Leads tables become stacked cards at 640 px and below (labels via `data-label`, explicit ARIA table roles).
- Login Employee/Admin tab and link styles added (they were missing from the loaded stylesheet).

## Test files that were edited, and why
`src/styles/design-system.test.js`, `login-contrast.test.js`, `chat-contrast.test.js`, `login-tabs.test.js`: the hard-coded hex values and the
"dark text on neon green / measured against the gradient / button lift" assertions described the old design. Hex values were remapped with the CSS, and
thresholds were kept (4.5:1 text, 3:1 borders and focus rings); two new tests were added. `src/lib/lead-status.test.js`: the wiring test pinned a
`PATCH` client call to an endpoint the server does not have; it now pins the real GET+PUT contract and asserts no PATCH /leads route exists.

## Known issues
- `TeamChatPage.jsx` exists but is not routed (`/chat` uses `ChatPage.jsx`). Left untouched.
- Call Desk integration test 6 (unique-lead count after an undo) fails; business-rule question for the owner.
- Wide report/admin tables scroll inside their container (with edge shadows) instead of restacking.
