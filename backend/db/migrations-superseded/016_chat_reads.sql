-- Read position per user and conversation, used for unread counts. peer_id = 0 is the team channel, otherwise the other user's id
-- (no foreign key on peer_id because 0 is not a user). Single statement (MySQL DDL is not transactional).
CREATE TABLE chat_reads (
  user_id      BIGINT UNSIGNED NOT NULL,
  peer_id      BIGINT UNSIGNED NOT NULL,
  last_read_id BIGINT UNSIGNED NOT NULL,
  updated_at   DATETIME NOT NULL,
  PRIMARY KEY (user_id, peer_id),
  CONSTRAINT fk_chat_reads_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
