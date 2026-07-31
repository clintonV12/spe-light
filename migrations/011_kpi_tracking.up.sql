-- StratPlan / SPE-Light  —  011 Tracking Module (KPI target/actual tracking)
--
-- Adds the two tables behind the Tracking Module: `kpis` (one row per
-- tracked KPI) and `kpi_measurements` (one row per KPI per reporting
-- period, holding that period's Target/Actual pair).
--
-- Design notes:
--   - A KPI belongs directly to a plan (plan_id), not to a phase or a
--     strategic_objective — the Tracking Module works the same way for
--     'international' and 'local' plans, unlike strategic_pillars (008)
--     and the chapter 2/3/6/7 tables (009), which are local-plan-only.
--   - period is a checked string ('monthly' | 'quarterly' | 'annual')
--     rather than three separate columns on kpi_measurements, so a fourth
--     period can be added later by extending the CHECK constraint alone.
--   - UNIQUE (kpi_id, period) means saving a period's numbers is always an
--     upsert (INSERT ... ON CONFLICT DO UPDATE at the app layer) — there is
--     no accumulating history of past edits to a period, only its current
--     Target/Actual.
--   - kpi_measurements.kpi_id cascades on delete (unlike
--     org_structure_roles.reports_to_id in 009, which SETs NULL) — a
--     measurement has no meaning once its KPI is gone, whereas a child role
--     surviving its former parent does.
--   - Same conventions as 008/009: org-scoped, user_order for display
--     sequence on kpis, updated_at trigger, RLS org_isolation policy.

-- ── KPIs ─────────────────────────────────────────────────────────────────

CREATE TABLE kpis (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    name       TEXT        NOT NULL,
    -- 'increase': a higher actual value is better (e.g. revenue growth).
    -- 'decrease': a lower actual value is better (e.g. defect rate).
    direction  TEXT        NOT NULL DEFAULT 'increase',
    user_order INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_kpis_direction CHECK (direction IN ('increase', 'decrease'))
);
CREATE INDEX idx_kpis_plan_id ON kpis(plan_id);
CREATE INDEX idx_kpis_org_id  ON kpis(org_id);
CREATE TRIGGER trg_kpis_updated_at
    BEFORE UPDATE ON kpis FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON kpis
    USING (rls_bypassed() OR org_id = current_org_id());

-- ── KPI measurements (Target/Actual per reporting period) ──────────────────

CREATE TABLE kpi_measurements (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    kpi_id       UUID        NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
    plan_id      UUID        NOT NULL REFERENCES plans(id),
    org_id       UUID        NOT NULL REFERENCES organisations(id),
    period       TEXT        NOT NULL,
    target_value DOUBLE PRECISION,
    actual_value DOUBLE PRECISION,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_kpi_measurements_period CHECK (
        period IN ('monthly', 'quarterly', 'annual')
    ),
    CONSTRAINT uq_kpi_measurements_kpi_period UNIQUE (kpi_id, period)
);
CREATE INDEX idx_kpi_measurements_plan_id ON kpi_measurements(plan_id);
CREATE INDEX idx_kpi_measurements_org_id  ON kpi_measurements(org_id);
CREATE INDEX idx_kpi_measurements_kpi_id  ON kpi_measurements(kpi_id);
CREATE TRIGGER trg_kpi_measurements_updated_at
    BEFORE UPDATE ON kpi_measurements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE kpi_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON kpi_measurements
    USING (rls_bypassed() OR org_id = current_org_id());