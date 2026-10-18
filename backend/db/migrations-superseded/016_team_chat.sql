-- Team Chat: admin announcements + team chat messages with @mentions. Additive: two new tables, no existing table is altered.
-- Requires MySQL 8.0+. Apply with: npm run migrate
--
-- kind 'announcement' can only be written by an admin (enforced in the service); 'chat' by any logged-in user.
-- client_request_id is a random id the browser creates per send: the unique key (sender_user_id, client_request_id) turns a repeated
-- delivery (double-click, retry after a dropped connection) into a no-op instead of a second message.
-- A message is never physically deleted: "remove" sets deleted_at / deleted_by_user_id (the sender, or an admin) and the message
-- disappears from every list. chat_mentions holds the active employees addressed with @EMPLOYEE_ID in the body at send time.
CREATE TABLE chat_messages (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_user_id     BIGINT UNSIGNED NOT NULL,
  kind               ENUM('chat','announcement') NOT NULL DEFAULT 'chat',
  body               VARCHAR(2000) NOT NULL,
  client_request_id  CHAR(36) NOT NULL,
  created_at         DATETIME NOT NULL,
  deleted_at         DATETIME NULL,
  deleted_by_user_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_messages_request (sender_user_id, client_request_id),
  KEY idx_chat_messages_kind_id (kind, id),
  KEY idx_chat_messages_sender (sender_user_id),
  CONSTRAINT fk_chat_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users (id),
  CONSTRAINT fk_chat_messages_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE chat_mentions (
  message_id        BIGINT UNSIGNED NOT NULL,
  mentioned_user_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (message_id, mentioned_user_id),
  KEY idx_chat_mentions_user (mentioned_user_id, message_id),
  CONSTRAINT fk_chat_mentions_message FOREIGN KEY (message_id) REFERENCES chat_messages (id),
  CONSTRAINT fk_chat_mentions_user FOREIGN KEY (mentioned_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
