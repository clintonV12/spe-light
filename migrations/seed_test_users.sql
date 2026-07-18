-- seed_test_users.sql
--
-- Creates test accounts directly in the database, bypassing the invite/email
-- flow entirely, so you can log in and test the real backend immediately.
--
-- Password hashes use pgcrypto's crypt()/gen_salt('bf', 12) — this produces
-- the same bcrypt format ($2a$, cost 12) as internal/auth.HashPassword, so
-- these accounts log in through the normal /auth/login path with no special
-- casing required.
--
-- DEV/TEST USE ONLY. Do not run against a production database — this creates
-- accounts with a known, published password.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/seed_test_users.sql
--
-- Safe to re-run: every insert is idempotent (ON CONFLICT ... DO UPDATE),
-- so re-running just resets the password/active status rather than erroring
-- or duplicating rows.
--
-- ── Test credentials ─────────────────────────────────────────────────────
--   Platform super admin : superadmin@stratplan.test  /  TestPass123!
--     (org_id NULL — platform tier, cross-org access, drives /platform-admin)
--
--   Org admin            : admin@acme.test            /  TestPass123!
--     (org: "Acme Test Co", slug acme-test — drives /admin, the org's own
--      Team & access page: invite users, change roles, deactivate, etc.)

BEGIN;

-- ── Platform-tier super admin (org_id NULL) ─────────────────────────────
-- Matches the partial unique index uq_users_platform_email from migration
-- 003 (email uniqueness among org_id IS NULL rows), so ON CONFLICT must
-- target that exact index via its predicate.
INSERT INTO users (id, org_id, email, password_hash, name, role, locale, is_active)
VALUES (
    uuid_generate_v4(),
    NULL,
    'superadmin@stratplan.test',
    crypt('TestPass123!', gen_salt('bf', 12)),
    'Super Admin (test)',
    'super_admin',
    'en',
    TRUE
)
ON CONFLICT (email) WHERE org_id IS NULL DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        is_active      = TRUE,
        updated_at     = NOW();

-- ── Test organisation ────────────────────────────────────────────────────
-- Fixed UUID so it's easy to reference from psql/tests without looking it
-- up each run (e.g. to create a plan directly under this org).
INSERT INTO organisations (id, name, slug, locale, industry, is_active)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Acme Test Co',
    'acme-test',
    'en',
    'Software',
    TRUE
)
ON CONFLICT (slug) DO UPDATE
    SET is_active  = TRUE,
        updated_at = NOW();

-- ── Org admin for the test organisation ──────────────────────────────────
INSERT INTO users (id, org_id, email, password_hash, name, role, locale, is_active)
VALUES (
    uuid_generate_v4(),
    'a0000000-0000-0000-0000-000000000001',
    'admin@acme.test',
    crypt('TestPass123!', gen_salt('bf', 12)),
    'Acme Admin (test)',
    'org_admin',
    'en',
    TRUE
)
ON CONFLICT (org_id, email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        is_active      = TRUE,
        updated_at     = NOW();

COMMIT;

-- ── Sanity check ──────────────────────────────────────────────────────────
SELECT email, role, org_id, is_active FROM users
WHERE email IN ('superadmin@stratplan.test', 'admin@acme.test');