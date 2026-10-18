-- Admin review of payment proofs (receipts / screenshots). Existing receipts become 'pending'. Requires MySQL 8.0+ or TiDB 6.6+.
-- review_status: pending (not looked at yet) | approved | rejected. A rejection must carry a note (enforced by the API; the note is
-- shown to the BDE). reviewed_by / reviewed_at record who decided and when (the latest decision; a decision may be changed).
-- Three statements, run in this order by scripts/migrate.js (each checked separately if one fails): the columns first, then the index
-- and the foreign key. TiDB cannot add a column and an index/constraint that uses it in the SAME ALTER ("column does not exist"),
-- MySQL can; separate statements work on both. DDL is not transactional, so a failure after statement 1 leaves a PARTIAL state
-- that the runner reports and refuses to re-run (see docs/migration-map.md).
ALTER TABLE payment_receipts
  ADD COLUMN review_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  ADD COLUMN reviewed_by   BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_at   DATETIME NULL,
  ADD COLUMN review_note   VARCHAR(300) NULL;

ALTER TABLE payment_receipts ADD KEY idx_receipts_review (review_status);

ALTER TABLE payment_receipts ADD CONSTRAINT fk_receipts_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id);
