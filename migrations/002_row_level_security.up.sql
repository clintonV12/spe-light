-- StratPlan / SPE-Light  —  002 row-level security
--
-- Enforces tenant isolation at the database layer as a defense-in-depth
-- measure (REQ-NF-011). Application code already filters every query by
-- org_id, but RLS ensures a bug in a single query cannot leak cross-tenant
-- data even if the WHERE clause is forgotten.
--
-- Usage: the application sets the current org via
--   SELECT set_config('app.current_org_id', '<uuid>', false);
-- at the start of each request (see internal/database/rls.go).
-- Platform-tier roles (super_admin, platform_support) bypass RLS entirely
-- by connecting as a role with BYPASSRLS, OR by setting app.bypass_rls = 'true'
-- for the duration of the session (set by middleware based on JWT role).

-- ── Helper: read the current org context, NULL if unset ────────────────
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::UUID
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION rls_bypassed() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true), 'false')::BOOLEAN
$$ LANGUAGE sql STABLE;

-- ── Organisations ─────────────────────────────────────────────────────────
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON organisations
  USING (rls_bypassed() OR id = current_org_id());

-- ── Users ─────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON users
  USING (rls_bypassed() OR org_id = current_org_id());

-- ── SSO configs ───────────────────────────────────────────────────────────
ALTER TABLE sso_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON sso_configs
  USING (rls_bypassed() OR org_id = current_org_id());

-- ── Invitations ───────────────────────────────────────────────────────────
-- org_id is nullable for platform-level invites, so those rows are only
-- visible when RLS is bypassed (platform admin context).
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON invitations
  USING (rls_bypassed() OR org_id = current_org_id());

-- ── Plans ─────────────────────────────────────────────────────────────────
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON plans
  USING (rls_bypassed() OR org_id = current_org_id());

-- ── Activities ────────────────────────────────────────────────────────────
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON activities
  USING (rls_bypassed() OR org_id = current_org_id());

-- ── Reports ───────────────────────────────────────────────────────────────
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON reports
  USING (rls_bypassed() OR org_id = current_org_id());

-- ── Notification log ──────────────────────────────────────────────────────
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON notification_log
  USING (rls_bypassed() OR org_id = current_org_id());

-- ── Audit log ─────────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON audit_log
  USING (rls_bypassed() OR org_id = current_org_id());

-- Note: refresh_tokens, password_reset_tokens, plan_viewers, activity_links,
-- and milestones are intentionally left without direct RLS policies because
-- they are always accessed via a join to an already-scoped parent table
-- (users, plans, activities) in this version. Add policies here if they
-- are ever queried directly by org-unaware code paths.
