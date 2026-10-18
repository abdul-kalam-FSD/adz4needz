-- Team chat, part 2 of 3: @mentions. One row per mention occurrence, written in the same transaction as the message.
-- The server finds mentions itself by matching "@handle" in the message text against the active team directory; the browser cannot
-- claim a mention. start_pos / end_pos are the position of the "@handle" text inside body (JavaScript string offsets, end exclusive), so
-- the screen can highlight exactly that text and old messages never change if someone is later renamed or deactivated.
CREATE TABLE chat_mentions (
  message_id BIGINT UNSIGNED NOT NULL,
  start_pos  SMALLINT UNSIGNED NOT NULL,
  end_pos    SMALLINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (message_id, start_pos),
  KEY idx_chat_mentions_user (user_id, message_id),
  CONSTRAINT fk_chat_mentions_message FOREIGN KEY (message_id) REFERENCES chat_messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_mentions_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
