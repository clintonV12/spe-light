-- StratPlan / SPE-Light  —  008 plan types + local (Eswatini) plan hierarchy
--
-- Adds a second plan structure alongside the existing fixed P1/P2/P3 phase
-- model ("international", the default / current behaviour). The new "local"
-- plan type follows the ESWAMCU Strategic Plan standard:
--
--   Plan
--    └─ Strategic Pillar        (user-defined per plan, e.g. "LEADERSHIP,
--                                 GOVERNANCE AND HUMAN RESOURCE")
--        └─ Strategic Objective (KPA)
--            └─ Activity (Action/Activity row)
--                 ├─ KPI(s) + Target
--                 ├─ Budget
--                 ├─ Responsibility
--                 └─ Target period
--
-- Design notes:
--   - plan_type lives on `plans` and drives which hierarchy a plan's
--     activities use. It is NOT retroactively enforced on existing rows
--     beyond the DEFAULT — every existing plan becomes 'international',
--     matching current behaviour exactly.
--   - strategic_pillars / strategic_objectives are new, minimal tables
--     mirroring the existing activities/milestones conventions: org-scoped,
--     user_order for display sequence, updated_at trigger, RLS org_isolation
--     policy.
--   - activities.phase is relaxed to nullable and a new activities.objective_id
--     FK is added. A CHECK constraint enforces that an activity belongs to
--     exactly one hierarchy — a phase (international) XOR an objective
--     (local) — never both, never neither. This keeps the existing
--     P1/P2/P3 code paths completely untouched for international plans.
--   - budget/responsibility/target_period/kpis are additive, nullable (or
--     defaulted) columns on activities, only ever populated for local-plan
--     activities. International-plan activities simply never set them.

-- ── plans.plan_type ─────────────────────────────────────────────────────
ALTER TABLE plans ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'international';
ALTER TABLE plans ADD CONSTRAINT chk_plans_plan_type
    CHECK (plan_type IN ('international', 'local'));

-- ── Strategic pillars (local plans only) ────────────────────────────────
CREATE TABLE strategic_pillars (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    title      TEXT        NOT NULL,
    user_order INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_strategic_pillars_plan_id ON strategic_pillars(plan_id);
CREATE INDEX idx_strategic_pillars_org_id  ON strategic_pillars(org_id);
CREATE TRIGGER trg_strategic_pillars_updated_at
    BEFORE UPDATE ON strategic_pillars FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE strategic_pillars ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON strategic_pillars
    USING (rls_bypassed() OR org_id = current_org_id());

-- ── Strategic objectives (KPAs), nested under a pillar ──────────────────
CREATE TABLE strategic_objectives (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    pillar_id  UUID        NOT NULL REFERENCES strategic_pillars(id),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    title      TEXT        NOT NULL,
    user_order INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_strategic_objectives_plan_id   ON strategic_objectives(plan_id);
CREATE INDEX idx_strategic_objectives_pillar_id ON strategic_objectives(pillar_id);
CREATE INDEX idx_strategic_objectives_org_id    ON strategic_objectives(org_id);
CREATE TRIGGER trg_strategic_objectives_updated_at
    BEFORE UPDATE ON strategic_objectives FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE strategic_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON strategic_objectives
    USING (rls_bypassed() OR org_id = current_org_id());

-- ── Activities: relax phase, add local-plan fields ──────────────────────

-- 1. phase becomes optional — local-plan activities hang off an objective
--    instead. Existing rows are all international with a phase already set,
--    so no backfill needed.
ALTER TABLE activities ALTER COLUMN phase DROP NOT NULL;

-- 2. objective_id links a local-plan activity to its Strategic Objective.
ALTER TABLE activities ADD COLUMN objective_id UUID REFERENCES strategic_objectives(id);
CREATE INDEX idx_activities_objective_id ON activities(objective_id);

-- 3. Fields from the ESWAMCU "Implementation Framework" table that have no
--    equivalent on international activities. All nullable/defaulted so
--    international activities are entirely unaffected.
ALTER TABLE activities ADD COLUMN budget         NUMERIC(14, 2);
ALTER TABLE activities ADD COLUMN responsibility TEXT;
ALTER TABLE activities ADD COLUMN target_period  TEXT;
-- kpis: [{ "indicator": "...", "target": "..." }, ...] — an activity row in
-- the source document commonly lists more than one KPI (see e.g. "Identify
-- policy gaps..." -> two KPIs), so this is an array rather than two columns.
ALTER TABLE activities ADD COLUMN kpis JSONB NOT NULL DEFAULT '[]';

ALTER TABLE activities ADD CONSTRAINT chk_activities_budget_nonneg
    CHECK (budget IS NULL OR budget >= 0);

-- 4. Exactly one of phase / objective_id must be set — an activity belongs
--    to precisely one hierarchy. This is what keeps international and local
--    activities from being mixed up within the same plan.
ALTER TABLE activities ADD CONSTRAINT chk_activities_exactly_one_hierarchy
    CHECK (
        (phase IS NOT NULL AND objective_id IS NULL)
        OR
        (phase IS NULL AND objective_id IS NOT NULL)
    );