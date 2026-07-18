-- StratPlan / SPE-Light  —  005 nullable org_id/user_id on notification_log
--
-- Bug fix: notification_log.org_id and user_id were NOT NULL, but several
-- notification types have no resolvable value for one or both at send time:
--
--   - Invitation emails (org user invite, org-onboarding invite, platform
--     team invite) are sent to an email address with no corresponding
--     users row yet — the recipient doesn't become a user until they accept
--     via POST /invitations/accept.
--   - Platform-level invites (InvitePlatformUser) have no org_id at all —
--     same rationale as migration 003's users.org_id fix for platform-tier
--     roles, and matches invitations.org_id, which is already nullable
--     ("NULL = platform invite").
--
-- Mirrors the precedent already set by migration 003 and by
-- invitations.org_id in the initial schema.

ALTER TABLE notification_log ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE notification_log ALTER COLUMN user_id DROP NOT NULL;