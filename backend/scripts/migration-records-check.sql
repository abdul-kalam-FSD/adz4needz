-- READ-ONLY. Every statement below is a SELECT; nothing here changes data or schema.
-- Run it in the TiDB Cloud SQL editor (or any client) against the application's database and send the RESULT ROWS only (no connection details).
-- It answers: which migration files are recorded as applied, and what do the chat and call tables look like right now.

-- 1. Which migration files has the runner recorded?
SELECT filename, applied_at FROM schema_migrations ORDER BY filename;

-- 2. Which of the tables the migrations create exist?
SELECT table_name FROM information_schema.tables
 WHERE table_schema = DATABASE()
   AND table_name IN ('schema_migrations','users','sessions','lead_statuses','leads','interviews','payments','payment_instalments','payment_receipts',
                      'lead_import_batches','lead_import_rows','daily_reports','monthly_targets','call_logs','chat_messages','chat_mentions','chat_reads')
 ORDER BY table_name;

-- 3. Which shape does chat_messages have? (new design has kind + client_request_id; the stale 015 design has recipient_id)
SELECT column_name, column_type, is_nullable FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'chat_messages' ORDER BY ordinal_position;

-- 4. Does it hold any messages? (decides how careful a fix must be)
SELECT COUNT(*) AS chat_messages_rows FROM chat_messages;
