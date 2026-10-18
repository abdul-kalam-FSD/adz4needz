// Source-level guards for the chat wiring (no database, no installed packages needed), in the style of call-logs-app-structure.test.js.
// Behaviour over real HTTP and real SQL is covered by tests-integration/chat.db.test.js (needs MySQL; see docs/team-chat.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config/env.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const app = read('../src/app.js'); const server = read('../src/server.js');
const base = { DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' };

test('every chat route is authenticated, restricted to the two roles, and runs behind the JSON-only guard', () => {
  const guard = app.indexOf('api.use(requireJsonBody)'); assert.ok(guard > 0);
  const routes = [...app.matchAll(/api\.(get|post|put|patch|delete)\('(\/chat[^']*)'([^\n]*)\n/g)];
  assert.deepEqual(routes.map((m) => `${m[1].toUpperCase()} ${m[2]}`).sort(), ['GET /chat/members', 'GET /chat/messages', 'GET /chat/unread', 'POST /chat/messages', 'POST /chat/read']);
  for (const m of routes) {
    assert.ok(app.indexOf(m[0]) > guard, `${m[2]} is registered after the JSON guard`);
    assert.match(m[3], /authenticate, authorize\('admin', 'bde'\)/, `${m[2]} needs a logged-in admin or BDE`);
  }
});
test('sending is rate limited per logged-in user (not per address), after authentication', () => {
  assert.match(app, /api\.post\('\/chat\/messages', authenticate, authorize\('admin', 'bde'\), chatSendLimiter, asyncHandler\(chat\.send\)\)/);
  assert.match(app, /keyGenerator: \(req\) => 'user:' \+ req\.user\.id/); assert.match(app, /limit: config\.chatSendRateLimitMax/); assert.match(app, /TOO_MANY_MESSAGES/);
});
test('there is no way to edit or delete a message, and no route that takes a sender or user id', () => {
  assert.equal((app.match(/api\.(put|patch|delete)\('\/chat/g) || []).length, 0);
  assert.ok(!/\/chat\/[^']*:/.test(app), 'no /chat/:id style routes');
  const h = read('../src/modules/chat/chat.handlers.js');
  assert.ok(!/req\.(body|query|params)\.(userId|user_id|senderId|sender)/.test(h));
  assert.match(h, /chatService\.send\(req\.user, req\.body\)/); assert.match(h, /chatService\.list\(req\.user, req\.query\)/); assert.match(h, /chatService\.markRead\(req\.user, req\.body\)/);
});
test('the service takes the sender only from the session user and only admins may post announcements', () => {
  const s = read('../src/modules/chat/chat.service.js');
  assert.match(s, /senderId: actor\.id/); assert.ok(!/senderId: (v|check|body)\./.test(s));
  assert.match(s, /v\.kind === 'announcement' && actor\.role !== 'admin'\) throw new HttpError\(403/);
  assert.ok(!/dangerouslySetInnerHTML|innerHTML|escapeHtml/.test(s), 'the server stores plain text; it does not build HTML');
});
test('server.js builds the chat service from the chat repository and passes it to createApp', () => {
  assert.match(server, /createChatService\(\{ repo: createChatRepository\(db\) \}\)/); assert.match(server, /employeeService, callLogService, chatService, assignmentService, activityService, leadSheetService, checkDb:/);
});
test('migrations 016-018: three single-statement, additive CREATE TABLEs with the keys the code relies on', () => {
  const strip = (f) => read('../db/migrations/' + f).split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  for (const [file, table] of [['016_chat_messages.sql', 'chat_messages'], ['017_chat_mentions.sql', 'chat_mentions'], ['018_chat_reads.sql', 'chat_reads']]) {
    const sql = strip(file);
    assert.equal(sql.split(';').map((x) => x.trim()).filter(Boolean).length, 1, file + ' holds one statement'); assert.match(sql, new RegExp(`^\\s*CREATE TABLE ${table}\\b`));
    // "ON DELETE CASCADE" is a foreign-key clause, not a statement; remove it before looking for destructive statements.
    assert.ok(!/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|RENAME|INSERT)\b/i.test(sql.replace(/ON DELETE (CASCADE|RESTRICT|SET NULL|NO ACTION)/gi, '')), file + ' is additive');
  }
  const m = strip('016_chat_messages.sql');
  assert.match(m, /UNIQUE KEY uq_chat_messages_request \(sender_id, client_request_id\)/); assert.match(m, /kind\s+ENUM\('message','announcement'\) NOT NULL/); assert.match(m, /body\s+VARCHAR\(2000\) NOT NULL/);
  assert.match(m, /FOREIGN KEY \(sender_id\) REFERENCES users \(id\)/);
  const t = strip('017_chat_mentions.sql'); assert.match(t, /PRIMARY KEY \(message_id, start_pos\)/); assert.match(t, /KEY idx_chat_mentions_user \(user_id, message_id\)/); assert.match(t, /message_id\) REFERENCES chat_messages \(id\) ON DELETE CASCADE/);
  const r = strip('018_chat_reads.sql'); assert.match(r, /PRIMARY KEY \(user_id\)/); assert.match(r, /last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0/);
});
test('config: CHAT_SEND_RATE_LIMIT_MAX defaults to 20, is overridable, and rejects nonsense', () => {
  assert.equal(loadConfig(base).chatSendRateLimitMax, 20); assert.equal(loadConfig({ ...base, CHAT_SEND_RATE_LIMIT_MAX: '5' }).chatSendRateLimitMax, 5);
  for (const bad of ['0', '1001', 'abc', '1.5', '-2']) assert.throws(() => loadConfig({ ...base, CHAT_SEND_RATE_LIMIT_MAX: bad }), /CHAT_SEND_RATE_LIMIT_MAX/);
  assert.match(read('../.env.example'), /^CHAT_SEND_RATE_LIMIT_MAX=20$/m);
});
