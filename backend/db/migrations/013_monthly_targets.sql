-- Monthly targets set by an admin, one row per BDE per month. NULL = no target for that measure. Requires MySQL 8.0+.
-- month_start is always the first day of the month. Single statement (MySQL DDL is not transactional).
CREATE TABLE monthly_targets (
  user_id           BIGINT UNSIGNED NOT NULL,
  month_start       DATE NOT NULL,
  target_calls      INT UNSIGNED NULL,
  target_interested INT UNSIGNED NULL,
  target_interviews INT UNSIGNED NULL,
  target_revenue    DECIMAL(12,2) NULL,
  set_by            BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL,
  PRIMARY KEY (user_id, month_start),
  CONSTRAINT fk_monthly_targets_user   FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_monthly_targets_setter FOREIGN KEY (set_by)  REFERENCES users (id),
  CONSTRAINT chk_monthly_targets_revenue CHECK (target_revenue IS NULL OR target_revenue > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
