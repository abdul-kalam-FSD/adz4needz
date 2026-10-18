-- Phase 6: interviews.payment_confirmed (created in 006) is no longer read or written by the application. The value shown
-- as "payment confirmed" is now DERIVED from payment records (see lib/payment-confirmed-sql.js). The column is kept, not
-- dropped, so no data is lost and the change can be reviewed or rolled back; drop it only after the TL confirms the rule.
-- Metadata-only change (comment); 006 is not edited and no values are modified.
ALTER TABLE interviews MODIFY payment_confirmed TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'DEPRECATED since Phase 6: legacy manual flag, ignored. Derived from payments instead.';
