ALTER TABLE organisations    DISABLE ROW LEVEL SECURITY;
ALTER TABLE users             DISABLE ROW LEVEL SECURITY;
ALTER TABLE sso_configs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE invitations       DISABLE ROW LEVEL SECURITY;
ALTER TABLE plans             DISABLE ROW LEVEL SECURITY;
ALTER TABLE activities        DISABLE ROW LEVEL SECURITY;
ALTER TABLE reports           DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log  DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON organisations;
DROP POLICY IF EXISTS org_isolation ON users;
DROP POLICY IF EXISTS org_isolation ON sso_configs;
DROP POLICY IF EXISTS org_isolation ON invitations;
DROP POLICY IF EXISTS org_isolation ON plans;
DROP POLICY IF EXISTS org_isolation ON activities;
DROP POLICY IF EXISTS org_isolation ON reports;
DROP POLICY IF EXISTS org_isolation ON notification_log;
DROP POLICY IF EXISTS org_isolation ON audit_log;

DROP FUNCTION IF EXISTS current_org_id();
DROP FUNCTION IF EXISTS rls_bypassed();
