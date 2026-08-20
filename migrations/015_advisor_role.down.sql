-- Reverses 015_advisor_role.up.sql.
--
-- Note: restoring the narrower CHECK constraints requires no existing rows
-- using role = 'advisor'. Reassign or delete any advisor users (and cancel
-- any pending platform invitations with role = 'advisor' — unconstrained
-- TEXT, so no schema change needed there, but they'd reference a role the
-- narrower CHECK below no longer allows once accepted) before rolling back.

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_org_tier_requires_org;
ALTER TABLE users ADD CONSTRAINT chk_org_tier_requires_org
    CHECK (
        org_id IS NOT NULL
        OR role IN ('super_admin', 'platform_support')
    );

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN (
        'super_admin', 'platform_support', 'org_admin',
        'planner', 'contributor', 'viewer'
    ));