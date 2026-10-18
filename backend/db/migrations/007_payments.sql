-- Payment records (Phase 6). One row = one payment COMMITMENT for a lead and course/internship.
-- Money actually received is stored separately in payment_instalments (008); the status (Pending / Partially Paid /
-- Paid) is DERIVED from the two and is never stored, so it can never contradict the amounts.
-- Requires MySQL 8.0.16+ (CHECK constraints are enforced). Timestamps are UTC.
-- Amounts: DECIMAL(12,2), exact (no floating point). The PDF names no currency: ASSUMPTION (TL to confirm) a single currency.
-- commitment_date: the date the candidate committed to pay. ASSUMPTION (TL to confirm): needed to place commitments in
-- daily / weekly / monthly reports; the PDF does not define it.
-- The composite foreign key makes the database itself guarantee that payments.user_id (the responsible BDE) is the owner
-- of the lead (uses the unique key added in 005). A lead may have several payment records (e.g. two courses).
CREATE TABLE payments (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id              BIGINT UNSIGNED NOT NULL,
  user_id              BIGINT UNSIGNED NOT NULL,   -- responsible BDE; always equals the lead's owner (composite FK)
  course_or_internship VARCHAR(150) NOT NULL,
  amount_committed     DECIMAL(12,2) NOT NULL,
  commitment_date      DATE NOT NULL,
  created_at           DATETIME NOT NULL,
  updated_at           DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_id_user (id, user_id),
  KEY idx_payments_lead (lead_id, user_id),
  KEY idx_payments_user_date (user_id, commitment_date),
  KEY idx_payments_date (commitment_date),
  CONSTRAINT fk_payments_lead_owner FOREIGN KEY (lead_id, user_id) REFERENCES leads (id, user_id),
  CONSTRAINT chk_payments_amount_positive CHECK (amount_committed > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
