-- Team chat, part 3 of 3: who has read how far. One row per user: the id of the newest message they have read. Everything with a higher id
-- (sent by someone else) counts as unread for them. The cursor only ever moves forward (the service uses GREATEST). A user with no row has
-- read nothing. The same cursors tell an admin how many people have read an announcement.
CREATE TABLE chat_reads (
  user_id              BIGINT UNSIGNED NOT NULL,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at           DATETIME NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_chat_reads_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
