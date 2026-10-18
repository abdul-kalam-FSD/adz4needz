-- Money actually received against a payment commitment (full payment = one instalment; partial payments = several).
-- Revenue is the SUM of these rows, each counted exactly once. The application keeps SUM(amount) <= amount_committed
-- (checked inside a transaction with a row lock on the payment); the database guarantees the owner is consistent.
CREATE TABLE payment_instalments (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,   -- always equals the payment's BDE (composite FK)
  amount     DECIMAL(12,2) NOT NULL,
  paid_on    DATE NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_instalments_id_user (id, user_id),
  KEY idx_instalments_payment (payment_id, user_id),
  KEY idx_instalments_user_paid (user_id, paid_on),
  KEY idx_instalments_paid (paid_on),
  CONSTRAINT fk_instalments_payment_owner FOREIGN KEY (payment_id, user_id) REFERENCES payments (id, user_id),
  CONSTRAINT chk_instalments_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
