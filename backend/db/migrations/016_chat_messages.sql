-- Team chat, part 1 of 3: the messages. ONE shared conversation for the whole team (no rooms, no direct messages).
-- Requires MySQL 8.0+. Apply with: npm run migrate. Additive: a new table only; no existing table is altered.
--
-- kind: 'message' (anyone) or 'announcement' (admins only; enforced by the service, not by this column).
-- body: plain text, stored exactly as typed (after trimming). It is NEVER treated as HTML: it is escaped when displayed.
-- client_request_id: random id the browser makes for each send. The unique key (sender_id, client_request_id) turns a repeated delivery
--   of the same send (double-click, retry after a dropped connection) into a no-op instead of a duplicate message.
-- sender_id always comes from the logged-in session on the server, never from the request.
-- Messages are never edited or deleted by the application (there is no such feature yet).
CREATE TABLE chat_messages (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_id         BIGINT UNSIGNED NOT NULL,
  kind              ENUM('message','announcement') NOT NULL DEFAULT 'message',
  body              VARCHAR(2000) NOT NULL,
  client_request_id CHAR(36) NOT NULL,
  created_at        DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_messages_request (sender_id, client_request_id),
  KEY idx_chat_messages_kind_id (kind, id),
  CONSTRAINT fk_chat_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
