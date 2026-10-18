-- Phase 5 prerequisite. Adds a UNIQUE key on (id, user_id) of leads so that interviews can reference BOTH the lead
-- and its owning BDE with one composite foreign key (see 006). Since id is already unique this never rejects data.
-- Kept in its own file with a single statement: MySQL DDL is not transactional, so a one-statement migration cannot
-- be left half-applied. Migration 003 is not edited.
ALTER TABLE leads ADD UNIQUE KEY uq_leads_id_user (id, user_id);
