-- StratPlan / SPE-Light  —  007 self-service organisation profile fields
--
-- Adds descriptive profile fields that an org's own org_admin fills in via
-- PATCH /api/v1/org (internal/services/org's UpdateOrgProfile), distinct
-- from name/slug/is_active, which stay platform_admin-only (adminsvc.UpdateOrg).
--
-- Motivation: the AI draft/summary/suggest-links prompts (internal/services/ai)
-- previously had no way to know what kind of organisation a plan belongs to —
-- its industry, structure, size, or location — beyond whatever the plan's own
-- title/description happened to mention. buildOrgContextSection folds these
-- columns into every AI prompt so output is grounded in the actual
-- organisation instead of guessed from plan text alone.
--
-- All columns are nullable and additive — no backfill needed, no existing
-- row is affected, and an org that hasn't filled its profile in yet simply
-- contributes no org context to AI prompts rather than anything failing.

ALTER TABLE organisations ADD COLUMN address        TEXT;
ALTER TABLE organisations ADD COLUMN country         TEXT;
ALTER TABLE organisations ADD COLUMN contact_email   TEXT;
ALTER TABLE organisations ADD COLUMN contact_phone   TEXT;
ALTER TABLE organisations ADD COLUMN org_structure   TEXT;
ALTER TABLE organisations ADD COLUMN total_members   INTEGER;

ALTER TABLE organisations ADD CONSTRAINT chk_org_total_members_nonneg
    CHECK (total_members IS NULL OR total_members >= 0);