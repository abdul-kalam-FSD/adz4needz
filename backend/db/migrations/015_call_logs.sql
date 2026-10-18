-- Call log: one row per call attempt a BDE records with the one-click outcome buttons ("Call desk"). Additive: a new table only;
-- no existing table is altered, and the manual Daily Calling Report (daily_reports) keeps working as a fallback.
-- Requires MySQL 8.0+. Apply with: npm run migrate
--
-- Every row is ONE call. Calling the same lead twice produces two rows, and both count as calls (see docs/call-log-assumptions.md).
-- outcome mirrors the four categories of the Daily Calling Report in the project PDF.
-- call_date is the BDE's working date (server clock + REPORT_UTC_OFFSET_MINUTES, fixed when the row is written); called_at is UTC.
-- client_request_id is a random id the browser creates for each click. The unique key (user_id, client_request_id) makes a repeated
-- delivery of the same click (double-click, retry after a dropped connection) a no-op instead of a second call.
-- voided_at: a BDE can undo a mistaken click on the same day. The row is kept (audit trail) but excluded from every count.
-- The composite foreign key makes the database itself guarantee that user_id is the owner of the lead (same pattern as interviews, 006).
CREATE TABLE call_logs (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  lead_id           BIGINT UNSIGNED NOT NULL,
  outcome           ENUM('interested','not_interested','follow_up','no_response') NOT NULL,
  call_date         DATE NOT NULL,
  called_at         DATETIME NOT NULL,
  client_request_id CHAR(36) NOT NULL,
  voided_at         DATETIME NULL,
  created_at        DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_call_logs_request (user_id, client_request_id),
  KEY idx_call_logs_user_date (user_id, call_date),
  KEY idx_call_logs_date (call_date),
  KEY idx_call_logs_lead (lead_id),
  CONSTRAINT fk_call_logs_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_call_logs_lead_owner FOREIGN KEY (lead_id, user_id) REFERENCES leads (id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
