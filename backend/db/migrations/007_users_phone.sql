-- Module 1 (Profile): optional contact phone number on a user. Requires MySQL 8.0+.
-- ADDITIVE and NULLABLE: existing rows and existing code are unaffected (old code simply ignores the column).
-- The profile API (GET/PATCH /api/profile) needs this column, so run `npm run migrate` BEFORE starting the new code.
-- Kept in its own file with a single statement: MySQL DDL is not transactional, so it cannot be left half-applied.
-- Recovery if ever needed: ALTER TABLE users DROP COLUMN phone;  (this discards the stored phone numbers only)
ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL;
