-- Reverses 016_refresh_token_activity.up.sql.

DROP INDEX  IF EXISTS idx_refresh_tokens_last_used_at;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS last_used_at;