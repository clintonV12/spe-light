DROP INDEX IF EXISTS uq_users_platform_email;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_org_tier_requires_org;
-- Re-adding NOT NULL requires no existing NULL rows; this will fail if any
-- platform-tier users with NULL org_id currently exist. Reassign or remove
-- them before rolling back.
ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;
