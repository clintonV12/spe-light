-- StratPlan / SPE-Light  —  009 local-plan sections (chapters 2, 3, 6, 7)
--
-- 008 modeled chapters 4+5 of the ESWAMCU Strategic Plan standard (Strategic
-- Pillars → Strategic Objectives → Activities/KPI/Budget/Responsibility).
-- This migration adds the chapters that sit around that tree, so a "local"
-- plan follows the full document shape instead of treating pillars as the
-- entire plan:
--
--   Ch 1  Introduction                    — not modeled (narrative-only, no
--                                            structured data in the sample doc)
--   Ch 2  Strategic Focus                  -> plans.vision / plans.mission
--                                              + core_values
--   Ch 3  Situational Analysis             -> stakeholders
--                                              + swot_items
--                                              + pestel_items
--   Ch 4  Strategic Pillars                -> strategic_pillars (008, unchanged)
--   Ch 5  Implementation Framework         -> strategic_objectives + activities (008, unchanged)
--   Ch 6  Organisational Structure         -> org_structure_roles
--   Ch 7  Monitoring & Evaluation          -> me_items
--
-- All new tables follow the exact convention set by strategic_pillars in 008:
-- org-scoped, user_order for display sequence, updated_at trigger, RLS
-- org_isolation policy. All are meaningful for local plans only, mirroring
-- how strategic_pillars is gated to plan_type = 'local' at the service layer
-- (see requireLocalPlan in strategic_pillars.go) — the same gate is reused
-- for every table here rather than re-implemented per table.

-- ── Chapter 2: Strategic Focus (Vision / Mission / Core Values) ────────────

-- Vision and mission are singleton per-plan text, so they live directly on
-- plans rather than as one-row tables — consistent with how e.g.
-- plans.description already works. Nullable/unused for international plans.
ALTER TABLE plans ADD COLUMN vision  TEXT;
ALTER TABLE plans ADD COLUMN mission TEXT;

CREATE TABLE core_values (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id     UUID        NOT NULL REFERENCES plans(id),
    org_id      UUID        NOT NULL REFERENCES organisations(id),
    name        TEXT        NOT NULL,
    description TEXT,
    user_order  INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_core_values_plan_id ON core_values(plan_id);
CREATE INDEX idx_core_values_org_id  ON core_values(org_id);
CREATE TRIGGER trg_core_values_updated_at
    BEFORE UPDATE ON core_values FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE core_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON core_values
    USING (rls_bypassed() OR org_id = current_org_id());

-- ── Chapter 3: Situational Analysis (Stakeholders / SWOT / PESTEL) ─────────

CREATE TABLE stakeholders (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    name       TEXT        NOT NULL,
    -- Power/interest grid quadrant, per Table 1 of the ESWAMCU doc:
    -- (high influence, high interest)  -> manage closely
    -- (high influence, low interest)   -> keep satisfied
    -- (low influence,  high interest)  -> keep informed
    -- (low influence,  low interest)   -> monitor
    influence  TEXT        NOT NULL,
    interest   TEXT        NOT NULL,
    notes      TEXT,
    user_order INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stakeholders_influence CHECK (influence IN ('high', 'low')),
    CONSTRAINT chk_stakeholders_interest  CHECK (interest  IN ('high', 'low'))
);
CREATE INDEX idx_stakeholders_plan_id ON stakeholders(plan_id);
CREATE INDEX idx_stakeholders_org_id  ON stakeholders(org_id);
CREATE TRIGGER trg_stakeholders_updated_at
    BEFORE UPDATE ON stakeholders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE stakeholders ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON stakeholders
    USING (rls_bypassed() OR org_id = current_org_id());

CREATE TABLE swot_items (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    category   TEXT        NOT NULL,
    text       TEXT        NOT NULL,
    user_order INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_swot_items_category CHECK (
        category IN ('strength', 'weakness', 'opportunity', 'threat')
    )
);
CREATE INDEX idx_swot_items_plan_id ON swot_items(plan_id);
CREATE INDEX idx_swot_items_org_id  ON swot_items(org_id);
CREATE TRIGGER trg_swot_items_updated_at
    BEFORE UPDATE ON swot_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE swot_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON swot_items
    USING (rls_bypassed() OR org_id = current_org_id());

-- The source doc has two PESTEL tables (factor+implication, and
-- factor+positive/negative) that describe the same six factors from two
-- angles. Merged into one row per factor-entry here — implication is the
-- general note, positive/negative are the specific-to-this-Apex angle —
-- rather than forcing two separate tables for what's conceptually one
-- per-factor analysis. An org can add multiple rows per factor if they have
-- more than one implication/positive/negative to record.
CREATE TABLE pestel_items (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id     UUID        NOT NULL REFERENCES plans(id),
    org_id      UUID        NOT NULL REFERENCES organisations(id),
    factor      TEXT        NOT NULL,
    implication TEXT,
    positive    TEXT,
    negative    TEXT,
    user_order  INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_pestel_items_factor CHECK (
        factor IN ('political', 'economic', 'social', 'technological', 'environmental', 'legal')
    )
);
CREATE INDEX idx_pestel_items_plan_id ON pestel_items(plan_id);
CREATE INDEX idx_pestel_items_org_id  ON pestel_items(org_id);
CREATE TRIGGER trg_pestel_items_updated_at
    BEFORE UPDATE ON pestel_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE pestel_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON pestel_items
    USING (rls_bypassed() OR org_id = current_org_id());

-- ── Chapter 6: Organisational Structure ─────────────────────────────────────

-- A flat list with a self-referencing parent gives a simple org chart
-- (General Membership -> Board -> Executive Manager -> ... in the sample
-- doc) without a rigid fixed-depth schema. reports_to_id is nullable (top of
-- the chart) and ON DELETE SET NULL so removing a role never cascades into
-- silently deleting everyone below it — the caller re-parents or leaves
-- children detached.
CREATE TABLE org_structure_roles (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id       UUID        NOT NULL REFERENCES plans(id),
    org_id        UUID        NOT NULL REFERENCES organisations(id),
    title         TEXT        NOT NULL,
    description   TEXT,
    reports_to_id UUID        REFERENCES org_structure_roles(id) ON DELETE SET NULL,
    user_order    INTEGER     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_org_structure_roles_plan_id       ON org_structure_roles(plan_id);
CREATE INDEX idx_org_structure_roles_org_id        ON org_structure_roles(org_id);
CREATE INDEX idx_org_structure_roles_reports_to_id ON org_structure_roles(reports_to_id);
CREATE TRIGGER trg_org_structure_roles_updated_at
    BEFORE UPDATE ON org_structure_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE org_structure_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON org_structure_roles
    USING (rls_bypassed() OR org_id = current_org_id());

-- ── Chapter 7: Monitoring & Evaluation ──────────────────────────────────────

-- M&E chapter content in the source doc is a handful of short bulleted
-- lists under different headings (M&E objectives, critical success factors,
-- review cadence, conclusion/rollout measures) — modeled as one table with
-- a category discriminator rather than four near-identical tables.
CREATE TABLE me_items (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    category   TEXT        NOT NULL,
    text       TEXT        NOT NULL,
    user_order INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_me_items_category CHECK (
        category IN ('objective', 'critical_success_factor', 'review_note', 'conclusion_measure')
    )
);
CREATE INDEX idx_me_items_plan_id ON me_items(plan_id);
CREATE INDEX idx_me_items_org_id  ON me_items(org_id);
CREATE TRIGGER trg_me_items_updated_at
    BEFORE UPDATE ON me_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE me_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON me_items
    USING (rls_bypassed() OR org_id = current_org_id());