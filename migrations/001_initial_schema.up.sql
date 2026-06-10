-- StratPlan / SPE-Light  —  001 initial schema
-- Run with: migrate -path ./migrations -database $DATABASE_URL up

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── Organisations ─────────────────────────────────────────────────────────
CREATE TABLE organisations (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT        NOT NULL,
    slug       TEXT        NOT NULL UNIQUE,
    logo_url   TEXT,
    locale     TEXT        NOT NULL DEFAULT 'en',
    industry   TEXT,
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_organisations_updated_at
    BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Users ─────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id        UUID        NOT NULL REFERENCES organisations(id),
    email         TEXT        NOT NULL,
    password_hash TEXT,
    name          TEXT        NOT NULL,
    role          TEXT        NOT NULL CHECK (role IN (
                      'super_admin','platform_support','org_admin',
                      'planner','contributor','viewer')),
    locale        TEXT        NOT NULL DEFAULT 'en',
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    sso_subject   TEXT,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (org_id, email)
);
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_email  ON users(email);
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── SSO configs ───────────────────────────────────────────────────────────
CREATE TABLE sso_configs (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id               UUID        NOT NULL UNIQUE REFERENCES organisations(id),
    protocol             TEXT        NOT NULL CHECK (protocol IN ('saml','oidc')),
    metadata_url         TEXT,
    entity_id            TEXT,
    certificate          TEXT,
    client_id            TEXT,
    client_secret        TEXT,
    discovery_url        TEXT,
    default_role         TEXT        NOT NULL DEFAULT 'viewer',
    jit_enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
    local_login_disabled BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_sso_configs_updated_at
    BEFORE UPDATE ON sso_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Refresh tokens ────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id),
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ
);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- ── Password reset tokens ─────────────────────────────────────────────────
CREATE TABLE password_reset_tokens (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id),
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_prt_user_id ON password_reset_tokens(user_id);

-- ── Invitations ───────────────────────────────────────────────────────────
CREATE TABLE invitations (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID        REFERENCES organisations(id),  -- NULL = platform invite
    email       TEXT        NOT NULL,
    role        TEXT        NOT NULL,
    token_hash  TEXT        NOT NULL UNIQUE,
    invited_by  UUID        NOT NULL REFERENCES users(id),
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    status      TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','accepted','cancelled','expired')),
    plan_ids    UUID[]      NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invitations_email      ON invitations(email);
CREATE INDEX idx_invitations_token_hash ON invitations(token_hash);
CREATE TRIGGER trg_invitations_updated_at
    BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Plans ─────────────────────────────────────────────────────────────────
CREATE TABLE plans (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID        NOT NULL REFERENCES organisations(id),
    title       TEXT        NOT NULL,
    description TEXT,
    status      TEXT        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','active','review','completed','archived')),
    owner_id    UUID        NOT NULL REFERENCES users(id),
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_plans_org_id ON plans(org_id);
CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Plan viewers (plan-scoped viewer grants) ──────────────────────────────
CREATE TABLE plan_viewers (
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    user_id    UUID        NOT NULL REFERENCES users(id),
    granted_by UUID        NOT NULL REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plan_id, user_id)
);

-- ── Activities ────────────────────────────────────────────────────────────
-- phase is a LABEL only — creation order is independent of phase order.
-- user_order records the sequence in which the user created activities.
CREATE TABLE activities (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id     UUID        NOT NULL REFERENCES plans(id),
    org_id      UUID        NOT NULL REFERENCES organisations(id),
    phase       TEXT        NOT NULL CHECK (phase IN ('P1','P2','P3')),
    type        TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    user_order  INTEGER     NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started','in_progress','review','complete')),
    content     JSONB       NOT NULL DEFAULT '{}',
    ai_draft    JSONB,
    assigned_to UUID[]      NOT NULL DEFAULT '{}',
    due_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_activities_plan_id ON activities(plan_id);
CREATE INDEX idx_activities_org_id  ON activities(org_id);
CREATE INDEX idx_activities_phase   ON activities(phase);
CREATE TRIGGER trg_activities_updated_at
    BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Activity links ────────────────────────────────────────────────────────
CREATE TABLE activity_links (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id     UUID        NOT NULL REFERENCES plans(id),
    source_id   UUID        NOT NULL REFERENCES activities(id),
    target_id   UUID        NOT NULL REFERENCES activities(id),
    link_type   TEXT        NOT NULL CHECK (link_type IN ('auto','manual','ai_suggested')),
    created_by  UUID        NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, target_id),
    CHECK (source_id <> target_id)
);
CREATE TRIGGER trg_activity_links_updated_at
    BEFORE UPDATE ON activity_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Milestones ────────────────────────────────────────────────────────────
CREATE TABLE milestones (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id            UUID        NOT NULL REFERENCES plans(id),
    title              TEXT        NOT NULL,
    due_date           DATE        NOT NULL,
    status             TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','reached','missed')),
    linked_activity_id UUID        REFERENCES activities(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_milestones_plan_id ON milestones(plan_id);
CREATE TRIGGER trg_milestones_updated_at
    BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Reports ───────────────────────────────────────────────────────────────
CREATE TABLE reports (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id      UUID        NOT NULL REFERENCES plans(id),
    org_id       UUID        NOT NULL REFERENCES organisations(id),
    type         TEXT        NOT NULL CHECK (type IN ('full','phase','executive','progress','activity')),
    format       TEXT        NOT NULL CHECK (format IN ('pdf','docx','xlsx')),
    status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
    file_path    TEXT,
    generated_by UUID        NOT NULL REFERENCES users(id),
    generated_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reports_plan_id ON reports(plan_id);
CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Notification log ──────────────────────────────────────────────────────
CREATE TABLE notification_log (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    user_id    UUID        NOT NULL REFERENCES users(id),
    type       TEXT        NOT NULL,
    channel    TEXT        NOT NULL CHECK (channel IN ('email','in_app')),
    payload    JSONB       NOT NULL DEFAULT '{}',
    sent_at    TIMESTAMPTZ,
    status     TEXT        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notification_log_user_id ON notification_log(user_id);

-- ── Sync queue (offline writes) ───────────────────────────────────────────
CREATE TABLE sync_queue (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID        NOT NULL REFERENCES users(id),
    operation  TEXT        NOT NULL CHECK (operation IN ('create','update','delete')),
    table_name TEXT        NOT NULL,
    payload    JSONB       NOT NULL,
    synced_at  TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit log (immutable) ─────────────────────────────────────────────────
CREATE TABLE audit_log (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id     UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    action     TEXT        NOT NULL,
    table_name TEXT        NOT NULL,
    record_id  UUID        NOT NULL,
    diff       JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_log_org_id    ON audit_log(org_id);
CREATE INDEX idx_audit_log_record_id ON audit_log(record_id);