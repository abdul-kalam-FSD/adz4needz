// Checks the team chat stylesheet and the rendering rules: WCAG contrast of every text/background pair (computed from the real CSS variables),
// structural requirements (focus, touch targets, reduced motion, no external resources), and that message text is never put into the page as
// HTML. It does NOT render the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../pages/ChatPage.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../components/AppShell.jsx', import.meta.url), 'utf8');
const start = css.indexOf('.chat-page {');
const block = css.slice(start, start + css.slice(start).indexOf('}') + 1);
const vars = Object.fromEntries([...block.matchAll(/--chat-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const v = (name) => { assert.ok(vars[name], 'missing token --chat-' + name); return vars[name]; };
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const atLeast = (fg, bg, min, label) => { const r = ratio(v(fg), v(bg)); assert.ok(r >= min, `${label}: --chat-${fg} on --chat-${bg} is ${r.toFixed(2)}:1, needs ${min}:1`); };
const hexOf = (re) => { const m = css.match(re); assert.ok(m, 'rule not found: ' + re); return m[1]; };

test('all chat colour tokens exist as 6-digit hex values', () => {
  assert.ok(Object.keys(vars).length >= 20, 'found ' + Object.keys(vars).length);
  for (const n of ['page', 'panel', 'ink', 'muted', 'border', 'field-border', 'accent', 'focus', 'mine', 'announce', 'announce-ink', 'announce-edge', 'chip', 'chip-ink', 'on-accent', 'tag', 'tag-ink', 'error', 'error-bg', 'send', 'send-strong', 'on-send']) v(n);
});
test('WCAG AA text contrast (4.5:1) for message text and secondary text on every surface a message can sit on', () => {
  for (const bg of ['page', 'mine', 'panel', 'announce']) { atLeast('ink', bg, 4.5, 'message text'); atLeast('muted', bg, 4.5, 'time and hints'); }
  assert.ok(ratio(v('ink'), v('panel')) >= 7, 'body text on white reaches AAA');
});
test('WCAG AA for labels, chips, tags, links, errors and the send button', () => {
  atLeast('announce-ink', 'announce', 4.5, '"Read by" line'); atLeast('on-accent', 'announce-ink', 4.5, 'Announcement tag');
  atLeast('chip-ink', 'chip', 4.5, 'mention chip'); atLeast('chip-ink', 'mine', 4.5, 'mention chip text on my bubble'); atLeast('on-accent', 'accent', 4.5, 'mention of me / view button / "Mentions you" tag');
  atLeast('tag-ink', 'tag', 4.5, 'Admin tag'); atLeast('error', 'error-bg', 4.5, 'error box'); atLeast('error', 'panel', 4.5, 'character count over the limit');
  atLeast('accent', 'page', 4.5, '"New messages" line'); atLeast('accent', 'panel', 4.5, 'link buttons'); atLeast('ink', 'chip', 4.5, 'selected @ suggestion');
  atLeast('on-send', 'send', 4.5, 'Send button'); atLeast('on-send', 'send-strong', 4.5, 'Send button');
});
test('non-text contrast (3:1): the writing box border and the focus ring', () => {
  atLeast('field-border', 'panel', 3, 'writing box border'); atLeast('focus', 'panel', 3, 'focus ring on white'); atLeast('focus', 'page', 3, 'focus ring on the message area');
});
test('the menu badge colours (set outside the token block) are readable: white on purple, white on dark', () => {
  const bg = hexOf(/\.nav-badge \{[^}]*background: (#[0-9a-f]{6})/i); const fg = hexOf(/\.nav-badge \{[^}]*color: (#[0-9a-f]{6})/i); const bg2 = hexOf(/\.nav-badge-mention \{ background: (#[0-9a-f]{6})/i);
  assert.ok(ratio(fg, bg) >= 4.5, 'badge'); assert.ok(ratio(fg, bg2) >= 4.5, 'mention badge');
});

test('keyboard focus is visible on every chat control: buttons get an outline, the writing box a ring, the message list an outline', () => {
  assert.match(css, /\.chat-view-btn:focus-visible, \.chat-link-btn:focus-visible, \.chat-jump:focus-visible, \.chat-send:focus-visible \{ outline: 3px solid var\(--chat-focus\)/);
  assert.match(css, /\.chat-box-wrap textarea:focus, \.chat-box-wrap textarea:focus-visible \{[^}]*box-shadow: 0 0 0 3px/); assert.match(css, /\.chat-list:focus-visible \{ outline: 3px solid/);
  assert.ok(!/\.chat-[a-z-]+[^{]*\{[^}]*outline:\s*none/.test(css.replace(/\.chat-box-wrap textarea:focus, \.chat-box-wrap textarea:focus-visible \{[^}]*\}/, '')), 'no chat control removes its outline without a replacement');
});
test('touch targets: send 52px, writing box 52px, view buttons 40px, suggestions 44px, jump bar 40px', () => {
  assert.match(css, /\.chat-send \{[^}]*min-height: 52px/); assert.match(css, /\.chat-box-wrap textarea \{[^}]*min-height: 52px/); assert.match(css, /\.chat-view-btn \{[^}]*min-height: 40px/);
  assert.match(css, /\.chat-mention-option \{[^}]*min-height: 44px/); assert.match(css, /\.chat-jump \{[^}]*min-height: 40px/);
});
test('messages keep line breaks and long words cannot break the layout (plain text, pre-wrap, wrapping)', () => {
  assert.match(css, /\.chat-body \{[^}]*white-space: pre-wrap/); assert.match(css, /\.chat-body \{[^}]*overflow-wrap: anywhere/);
});
test('layout: fits the screen height under the top bar (desktop and phone), the message list scrolls inside, the page itself does not', () => {
  assert.match(block, /height: calc\(100dvh - var\(--topbar-height\) - 48px\)/); assert.match(css, /@media \(max-width: 768px\) \{\s*\.chat-page \{ height: calc\(100vh - var\(--topbar-height\) - 32px\)/);
  assert.match(css, /\.chat-list \{[^}]*overflow-y: auto/); assert.match(css, /\.chat-panel \{[^}]*min-height: 0/);
});
test('reduced motion and high contrast are handled for chat', () => {
  const m = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].find((x) => x[1].includes('.chat-send')); assert.ok(m, 'a chat reduced-motion block exists');
  assert.match(m[1], /transition: none/); assert.ok(!/translateY\(-1px\)/.test(css.slice(css.indexOf('.chat-send {'), css.indexOf('.chat-composer-foot'))), 'no lifting send button');
  assert.ok([...css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)].some((x) => x[1].includes('.chat-msg')));
});
test('no external resources anywhere in the stylesheet', () => assert.ok(!/@import|url\(\s*['"]?https?:/i.test(css)));

test('SAFE RENDERING: message text is only ever shown as React text nodes; the page never injects HTML or evaluates anything', () => {
  for (const [name, src] of [['ChatPage.jsx', page], ['AppShell.jsx', shell]]) {
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/.test(src), name + ' injects HTML or evaluates code');
  }
  assert.match(page, /segments\.map\(\(s, i\) => \(s\.type === 'mention'/); assert.match(page, /<span key=\{i\}>\{s\.text\}<\/span>/); assert.match(page, /@\{s\.name \|\| s\.text\.slice\(1\)\}/);
  assert.ok(!/href=\{[^}]*(body|text|message)/.test(page), 'no link is built from message text');
});
test('the menu entry exists for BOTH roles and the badge is announced in words, not just shown', () => {
  assert.equal((shell.match(/<ChatNavLink onNavigate/g) || []).length, 2, 'one in the BDE menu and one in the admin menu');
  assert.match(shell, /aria-label=\{'Team chat' \+ words\}/); assert.match(shell, /className=\{'nav-badge'[\s\S]*?\)\} aria-hidden="true"/);
});
test('the page is available to any logged-in user (like the profile page), not restricted to one role', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<Route path="chat" element=\{<ChatPage \/>\} \/>/); assert.ok(!/path="chat" element=\{<RequireRole/.test(app));
});

test('writing is locked until the conversation has loaded (a message you cannot see appear would look like it failed and be sent twice)', () => {
  assert.match(page, /const ready = load\.status === 'ready'/); assert.match(page, /if \(!ready \|\| trimmed === '' \|\| tooLong\) return;/);
  assert.match(page, /readOnly=\{sending \|\| !ready\}/); assert.match(page, /disabled=\{sending \|\| !ready \|\| trimmed === '' \|\| tooLong\}/);
});
test('the safe-send rules are wired in: one send at a time, request id per attempt, text kept on failure, error shown, success clears the box', () => {
  assert.match(page, /beginSend\(sendRef\.current, trimmed, kind, newRequestId\)/); assert.match(page, /if \(!begun\.attempt\) return;/);
  assert.match(page, /setSend\(sendFailed\(sendRef\.current, err\)\)/); assert.match(page, /setText\(''\); setCaret\(0\); setKind\('message'\)/);
  assert.ok(page.indexOf("setText('')") > page.indexOf('await api.chatSend('), 'the box is only cleared AFTER the server confirms');
  assert.match(page, /Not sent: \{send\.error\}/);
});
test('only the "all messages" view marks messages read, and only when visible, at the bottom, and newer than what the server knows', () => {
  assert.match(page, /shouldMarkRead\(\{ view, tabVisible, atBottom, newestSeenId: newest, lastReadId: lastKnown \}\)/);
  assert.match(page, /\.catch\(\(\) => \{ markingRef\.current = readRef\.current; \}\)/);
});
test('polling pauses while the tab is hidden and backs off after errors', () => {
  assert.match(page, /document\.visibilityState === 'visible'/); assert.match(page, /nextPollDelay\(POLL_CHAT_MS, failuresRef\.current\)/); assert.match(page, /clearTimeout\(timer\); document\.removeEventListener\('visibilitychange', onVisible\)/);
});
