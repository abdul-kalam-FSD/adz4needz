-- PROPOSED lead statuses: NOT confirmed by the TL. The project PDF does not define lead statuses.
-- They mirror the Daily Calling Report categories in the PDF (Interested / Not interested /
-- Follow-up required / No response or not reachable) plus "New".
-- After the TL confirms the real list, change it with SQL (rename, add, set is_active = 0).
-- Do not delete a status that leads already use (foreign key).
INSERT INTO lead_statuses (name, sort_order, closes_follow_up, is_active, created_at) VALUES
  ('New',                         10, 0, 1, UTC_TIMESTAMP()),
  ('Interested',                  20, 0, 1, UTC_TIMESTAMP()),
  ('Follow-up Required',          30, 0, 1, UTC_TIMESTAMP()),
  ('No Response / Not Reachable', 40, 0, 1, UTC_TIMESTAMP()),
  ('Not Interested',              50, 1, 1, UTC_TIMESTAMP());
