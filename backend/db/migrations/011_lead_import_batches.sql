-- Admin Excel/CSV import: one row per uploaded file. Requires MySQL 8.0+. Timestamps are UTC.
-- The uploaded cell values (raw_rows_json) can contain personal data of students, so they are kept ONLY while the batch is in
-- 'preview'. Committing or cancelling a batch sets raw_rows_json to NULL and deletes its staging rows (see 012).
-- Kept in its own file with a single statement (MySQL DDL is not transactional).
CREATE TABLE lead_import_batches (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id               BIGINT UNSIGNED NOT NULL,
  file_name                   VARCHAR(255) NOT NULL,
  file_format                 VARCHAR(8)   NOT NULL,
  status                      ENUM('preview','committed','cancelled') NOT NULL DEFAULT 'preview',
  headers_json                TEXT         NOT NULL,
  raw_rows_json               LONGTEXT     NULL,
  mapping_json                TEXT         NOT NULL,
  default_bde_id              BIGINT UNSIGNED NULL,
  default_course              VARCHAR(150) NULL,
  include_existing_duplicates TINYINT(1)   NOT NULL DEFAULT 0,
  total_rows                  INT UNSIGNED NOT NULL DEFAULT 0,
  valid_rows                  INT UNSIGNED NOT NULL DEFAULT 0,
  invalid_rows                INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_in_file_rows      INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_existing_rows     INT UNSIGNED NOT NULL DEFAULT 0,
  inserted_rows               INT UNSIGNED NULL,
  skipped_rows                INT UNSIGNED NULL,
  created_at                  DATETIME NOT NULL,
  updated_at                  DATETIME NOT NULL,
  committed_at                DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_import_batches_created (created_at),
  CONSTRAINT fk_import_batches_admin FOREIGN KEY (admin_user_id) REFERENCES users (id),
  CONSTRAINT fk_import_batches_bde   FOREIGN KEY (default_bde_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
