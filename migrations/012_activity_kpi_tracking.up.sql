-- StratPlan / SPE-Light  —  012 Tracking Module pivot: track Activity.KPIs
-- directly instead of a standalone KPI list
--
-- 011_kpi_tracking introduced `kpis` and `kpi_measurements` as a list of
-- KPIs entered independently in the Tracking Module. That's been reworked:
-- the KPIs actually worth tracking are the ones a planner already enters on
-- an activity under a Strategic Pillar (activities.kpis, from 008) — a
-- second, disconnected KPI list just meant re-entering the same indicators
-- twice. This migration:
--
--   1. Drops the 011 tables — nothing else references them.
--   2. Adds a CHECK constraint making activities.target_period a strict
--      monthly/quarterly/annual enum instead of free text (it previously
--      held e.g. "Year 1"), enforced at the same point the frontend now
--      collects it: right alongside due date, when the activity is
--      created/edited. This is what buckets an activity's KPIs into a
--      Tracking Module reporting period.
--
-- No schema change was needed for KPIs gaining target_value/actual_value/
-- direction — activities.kpis is JSONB (008), so those are purely an
-- application-layer (Go struct / TS type) change; existing rows' `kpis`
-- arrays are still valid JSON, just missing those keys until edited.
--
-- If you haven't applied 011 yet, you can skip straight past it to this
-- migration instead — running both in sequence is equally safe, since this
-- one's DROP TABLE IF EXISTS is a no-op when 011 was never applied.

DROP TABLE IF EXISTS kpi_measurements CASCADE;
DROP TABLE IF EXISTS kpis             CASCADE;

-- Existing rows with free-text target_period values (e.g. "Year 1") would
-- violate this constraint — clear them first so the ALTER TABLE below
-- doesn't fail. Anyone who had already set a target_period will need to
-- re-pick monthly/quarterly/annual for that activity; there's no reliable
-- automatic mapping from arbitrary free text to the new enum.
UPDATE activities
SET target_period = NULL
WHERE target_period IS NOT NULL
  AND target_period NOT IN ('monthly', 'quarterly', 'annual');

ALTER TABLE activities ADD CONSTRAINT chk_activities_target_period
    CHECK (target_period IS NULL OR target_period IN ('monthly', 'quarterly', 'annual'));