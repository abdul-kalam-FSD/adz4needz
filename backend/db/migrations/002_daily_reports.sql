-- Daily Calling Report (fields from the project brief).
-- ASSUMPTION (needs TL confirmation): one report per BDE per date -> unique key below.
-- No rule requires the category counts to add up to total_calls.
CREATE TABLE daily_reports (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            BIGINT UNSIGNED NOT NULL,
  report_date        DATE NOT NULL,
  total_calls        INT UNSIGNED NOT NULL,
  interested         INT UNSIGNED NOT NULL,
  not_interested     INT UNSIGNED NOT NULL,
  follow_up_required INT UNSIGNED NOT NULL,
  no_response        INT UNSIGNED NOT NULL,
  created_at         DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_reports_user_date (user_id, report_date),
  CONSTRAINT fk_daily_reports_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
