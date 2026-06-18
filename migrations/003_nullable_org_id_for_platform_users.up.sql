-- StratPlan / SPE-Light  —  003 nullable org_id for platform-tier users
--
-- Bug fix: users.org_id was NOT NULL, but super_admin and platform_support
-- are platform-tier roles with no single-org scope (see models.Role.IsPlatformRole
-- and TokenClaims.OrgID, which is meant to be nil for these roles). Under the
-- original schema, every platform user had to be artificially homed in some
-- org, and their JWTs incorrectly carried that org's ID — defeating the
-- "platform-tier has cross-org visibility" design intent documented in the
-- README and enforced in code via Role.IsPlatformRole().
--
-- This migration:
--   1. Drops the NOT NULL constraint on users.org_id.
--   2. Adds a CHECK constraint requiring org_id IS NOT NULL for every role
--      EXCEPT super_admin and platform_support, so org-tier users still
--      cannot be created without an org (no regression for the common case).
--   3. Adds a partial unique index so (org_id, email) uniqueness still holds
--      for org-scoped users; platform users (org_id IS NULL) are checked for
--      email uniqueness globally instead, since the original UNIQUE(org_id, email)
--      constraint would allow duplicate emails across NULL org_id rows
--      (NULL is never equal to NULL in SQL uniqueness checks).

ALTER TABLE users ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE users ADD CONSTRAINT chk_org_tier_requires_org
  CHECK (
    org_id IS NOT NULL
    OR role IN ('super_admin', 'platform_support')
  );

-- The original migration's UNIQUE(org_id, email) constraint remains for
-- org-scoped rows. Add a separate partial unique index to prevent duplicate
-- platform-tier emails (where org_id IS NULL).
CREATE UNIQUE INDEX uq_users_platform_email
  ON users (email)
  WHERE org_id IS NULL;
