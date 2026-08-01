-- Reverses 012_activity_kpi_tracking_up.sql.
--
-- Note: the UPDATE in the up-migration that cleared non-enum target_period
-- values is not reversible — any free-text values it wiped are gone. This
-- only undoes the constraint and recreates 011's tables (empty); it does
-- not restore data.

ALTER TABLE activities DROP CONSTRAINT IF EXISTS chk_activities_target_period;

-- Recreate 011_kpi_tracking's tables exactly as they were, for a clean
-- rollback path. See 011_kpi_tracking_up.sql for the original with full
-- comments if you need to inspect it.

CREATE TABLE IF NOT EXISTS kpis (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id    UUID        NOT NULL REFERENCES plans(id),
    org_id     UUID        NOT NULL REFERENCES organisations(id),
    name       TEXT        NOT NULL,
    direction  TEXT        NOT NULL DEFAULT 'increase',
    user_order INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_kpis_direction CHECK (direction IN ('increase', 'decrease'))
);
CREATE INDEX IF NOT EXISTS idx_kpis_plan_id ON kpis(plan_id);
CREATE INDEX IF NOT EXISTS idx_kpis_org_id  ON kpis(org_id);
CREATE TRIGGER trg_kpis_updated_at
    BEFORE UPDATE ON kpis FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON kpis
    USING (rls_bypassed() OR org_id = current_org_id());

CREATE TABLE IF NOT EXISTS kpi_measurements (
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
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_plan_id ON kpi_measurements(plan_id);
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_org_id  ON kpi_measurements(org_id);
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_kpi_id  ON kpi_measurements(kpi_id);
CREATE TRIGGER trg_kpi_measurements_updated_at
    BEFORE UPDATE ON kpi_measurements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE kpi_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON kpi_measurements
    USING (rls_bypassed() OR org_id = current_org_id());