-- StratPlan / SPE-Light  —  015 advisor role
--
-- Adds 'advisor' as a legal users.role value. An advisor is a platform-tier
-- user (org_id NULL, same as super_admin / platform_support) who is not a
-- member of any single organisation — instead they select (or create) an
-- org per session and are granted org_admin-equivalent access to it via a
-- request-scoped X-Org-Context header (see internal/middleware's
-- ResolveAdvisorOrgContext and internal/models.RoleAdvisor).
--
-- Two existing constraints need to know about the new role:
--
--   1. users.role's CHECK (added inline in 001_initial_schema, so Postgres
--      auto-generated its name — likely `users_role_check`, but not
--      guaranteed). Rather than assume that name, this looks the
--      constraint up by column the same defensive way 006 already does for
--      reports.type/status, so this never silently no-ops on a
--      differently-named constraint and leaves the old, narrower list in
--      place alongside a new one.
--
--   2. chk_org_tier_requires_org (003_nullable_org_id_for_platform_users)
--      currently only exempts super_admin/platform_support from requiring
--      org_id — advisor needs the same exemption, since it's equally
--      platform-tier and equally has no home org.
--
-- invitations.role has no CHECK constraint (free TEXT since 001), so
-- inviting an advisor via POST /api/v1/admin/platform-users/invitations
-- needs no schema change — it already reuses the same platform-user invite
-- path as super_admin/platform_support (see adminsvc.InvitePlatformUser,
-- gated on Role.IsPlatformRole() rather than an explicit role list).

DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t      ON t.oid = c.conrelid
        JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE t.relname = 'users'
          AND c.contype = 'c'
          AND a.attname = 'role'
    LOOP
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN (
        'super_admin', 'platform_support', 'advisor', 'org_admin',
        'planner', 'contributor', 'viewer'
    ));

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_org_tier_requires_org;
ALTER TABLE users ADD CONSTRAINT chk_org_tier_requires_org
    CHECK (
        org_id IS NOT NULL
        OR role IN ('super_admin', 'platform_support', 'advisor')
    );