-- Staging rows of an import batch (one per data row of the file). Deleted when the batch is committed or cancelled.
-- row_number is the spreadsheet row (header = row 1, first data row = 2).
CREATE TABLE lead_import_rows (
  batch_id          BIGINT UNSIGNED NOT NULL,
  `row_number`      INT UNSIGNED NOT NULL,
  row_status        ENUM('valid','invalid','duplicate_in_file','duplicate_existing') NOT NULL,
  bde_user_id       BIGINT UNSIGNED NULL,
  lead_json         TEXT NULL,
  errors_json       TEXT NULL,
  duplicate_of_row  INT UNSIGNED NULL,
  existing_lead_ids VARCHAR(200) NULL,
  PRIMARY KEY (batch_id, `row_number`),
  KEY idx_import_rows_status (batch_id, row_status),
  CONSTRAINT fk_import_rows_batch FOREIGN KEY (batch_id) REFERENCES lead_import_batches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
