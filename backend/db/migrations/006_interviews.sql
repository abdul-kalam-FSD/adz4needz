-- Interview tracking. Requires MySQL 8.0+. created_at / updated_at are UTC.
-- scheduled_at is the WALL-CLOCK date and time exactly as the BDE entered it (no timezone conversion).
--   ASSUMPTION (TL to confirm): one company timezone, so no conversion is needed.
-- The composite foreign key makes the database itself guarantee that interviews.user_id (the responsible BDE)
-- is the owner of the lead the interview belongs to.
-- ASSUMPTION (TL to confirm): a lead may have several interviews (e.g. a reschedule); there is no unique key on lead_id.
-- attendance / outcome values come from the PDF (Attended / Did not attend; Selected). "Pending" and "Not Selected" are
-- the neutral/negative counterparts requested for Phase 5.
-- interested_in_joining: NULL = not recorded yet, 1 = yes, 0 = no.
-- payment_confirmed: only a yes/no flag ("candidates who confirmed payment"). Amounts, dates, instalments and receipts
-- belong to the Payments module and are NOT stored here.
CREATE TABLE interviews (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id              BIGINT UNSIGNED NOT NULL,
  user_id              BIGINT UNSIGNED NOT NULL,   -- responsible BDE; always equals the lead's owner (composite FK)
  scheduled_at         DATETIME NOT NULL,
  attendance           ENUM('pending','attended','did_not_attend') NOT NULL DEFAULT 'pending',
  outcome              ENUM('pending','selected','not_selected')   NOT NULL DEFAULT 'pending',
  interested_in_joining TINYINT(1) NULL,
  payment_confirmed    TINYINT(1) NOT NULL DEFAULT 0,
  created_at           DATETIME NOT NULL,
  updated_at           DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_interviews_lead (lead_id, user_id),
  KEY idx_interviews_user_scheduled (user_id, scheduled_at),
  KEY idx_interviews_scheduled (scheduled_at),
  CONSTRAINT fk_interviews_lead_owner FOREIGN KEY (lead_id, user_id) REFERENCES leads (id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
