-- Team chat. recipient_id IS NULL = the team-wide channel (everyone); otherwise a direct message to that user.
-- Requires MySQL 8.0+. created_at is UTC. Messages are plain text only (the API enforces 1..2000 characters).
-- Single statement (MySQL DDL is not transactional).
CREATE TABLE chat_messages (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_id    BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NULL,
  body         VARCHAR(2000) NOT NULL,
  created_at   DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_chat_channel (recipient_id, id),
  KEY idx_chat_pair (sender_id, recipient_id, id),
  CONSTRAINT fk_chat_sender    FOREIGN KEY (sender_id)    REFERENCES users (id),
  CONSTRAINT fk_chat_recipient FOREIGN KEY (recipient_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
