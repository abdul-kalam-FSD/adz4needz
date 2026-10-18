-- Module 1 (Profile): optional contact email on a user. Requires MySQL 8.0+.
-- ADDITIVE and NULLABLE: existing rows and existing code are unaffected (old code simply ignores the column).
-- Length 254 matches leads.email. No UNIQUE key: two colleagues may legitimately share a team mailbox.
-- Must be applied together with 007 before the profile API is used. Single statement, same reason as 007.
-- Recovery if ever needed: ALTER TABLE users DROP COLUMN email;  (this discards the stored emails only)
ALTER TABLE users ADD COLUMN email VARCHAR(254) NULL;
