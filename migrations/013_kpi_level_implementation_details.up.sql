-- StratPlan / SPE-Light  —  013 Implementation details move onto each KPI
--
-- The ESWAMCU "Implementation Framework" table's BUDGET / RESPONSIBILITY /
-- TARGET PERIOD columns were originally modelled as one set of values per
-- *activity* (008, narrowed to an enum by 012). In practice two KPIs under
-- the same activity can have different owners, different costs, and get
-- reported on different cadences — so those three fields move onto each
-- KPI individually instead of being answered once for the whole activity.
--
-- No new JSONB shape needed at the DB level: activities.kpis is already
-- JSONB (008), so a KPI object gaining budget/responsibility/target_period
-- keys is purely an application-layer (Go struct / TS type) change, exactly
-- like target_value/actual_value/direction gaining theirs in 012. What
-- *does* need a migration is retiring the old per-activity columns:
--
--   1. Backfill: copy each activity's existing budget/responsibility/
--      target_period onto every KPI in its kpis array that doesn't already
--      have that field set, so existing data isn't silently dropped when
--      the columns go away below. (No existing KPI can already have these
--      set — they didn't exist as KPI fields before this migration — the
--      "doesn't already have it" framing is just future-proofing against
--      re-running this migration.)
--   2. Drop chk_activities_target_period (012) and the three columns.
--
-- If an activity had budget/responsibility/target_period set but an empty
-- kpis array, that data has nothing to attach to and is intentionally
-- dropped — there's no "implementation details for an activity with no
-- KPIs" concept left once this lands.

UPDATE activities
SET kpis = (
    SELECT COALESCE(
        jsonb_agg(
            elem || jsonb_strip_nulls(jsonb_build_object(
                'budget',         CASE WHEN elem ? 'budget'         THEN NULL ELSE to_jsonb(activities.budget) END,
                'responsibility', CASE WHEN elem ? 'responsibility' THEN NULL ELSE to_jsonb(activities.responsibility) END,
                'target_period',  CASE WHEN elem ? 'target_period'  THEN NULL ELSE to_jsonb(activities.target_period) END
            ))
        ),
        '[]'::jsonb
    )
    FROM jsonb_array_elements(activities.kpis) AS elem
)
WHERE jsonb_array_length(kpis) > 0
  AND (budget IS NOT NULL OR responsibility IS NOT NULL OR target_period IS NOT NULL);

ALTER TABLE activities DROP CONSTRAINT IF EXISTS chk_activities_target_period;
ALTER TABLE activities DROP COLUMN IF EXISTS budget;
ALTER TABLE activities DROP COLUMN IF EXISTS responsibility;
ALTER TABLE activities DROP COLUMN IF EXISTS target_period;