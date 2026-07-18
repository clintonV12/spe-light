
-- Re-adding NOT NULL requires no existing NULL rows in either column; this
-- will fail if any notification_log rows currently have a NULL org_id or
-- user_id (which will be common after the up-migration, since that's the
-- whole point of it). Backfill or delete them before rolling back.
ALTER TABLE notification_log ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE notification_log ALTER COLUMN org_id SET NOT NULL;