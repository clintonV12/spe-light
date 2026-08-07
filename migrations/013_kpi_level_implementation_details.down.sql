-- Reverses 013_kpi_level_implementation_details_up.sql.
--
-- Note: this is not a full reversal. The up-migration folded each
-- activity's budget/responsibility/target_period into every KPI in its
-- kpis array; that fan-out is not reversible in general (an activity with
-- several KPIs that ended up with different budgets/owners/periods after
-- this migration has no single value to fold back "up"). This only
-- restores the three columns (empty) and the CHECK constraint so the
-- schema shape matches pre-013 again — it does not repopulate their
-- values from the kpis JSONB.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS budget         DOUBLE PRECISION;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS responsibility TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS target_period  TEXT;

ALTER TABLE activities ADD CONSTRAINT chk_activities_target_period
    CHECK (target_period IS NULL OR target_period IN ('monthly', 'quarterly', 'annual'));