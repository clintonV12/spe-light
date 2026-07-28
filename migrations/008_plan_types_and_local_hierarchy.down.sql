-- Reverses 008_plan_types_and_local_hierarchy_up.sql.
--
-- Note: any local-plan data (plans with plan_type = 'local', their
-- strategic_pillars/strategic_objectives rows, and the objective_id/budget/
-- responsibility/target_period/kpis fields on their activities) is
-- destructive to roll back — an activity with objective_id set and no phase
-- would violate the restored NOT NULL on phase. Back up anything you need
-- before rolling back, or the DELETE statements below will remove it.

-- Local-plan activities have no phase (by the exactly-one-hierarchy CHECK),
-- so they cannot survive phase being restored to NOT NULL. Delete them
-- (cascades naturally via the app layer's soft-delete elsewhere, but this
-- migration hard-deletes since the columns themselves are being dropped).
DELETE FROM activities WHERE phase IS NULL;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS chk_activities_exactly_one_hierarchy;
ALTER TABLE activities DROP CONSTRAINT IF EXISTS chk_activities_budget_nonneg;

ALTER TABLE activities DROP COLUMN IF EXISTS kpis;
ALTER TABLE activities DROP COLUMN IF EXISTS target_period;
ALTER TABLE activities DROP COLUMN IF EXISTS responsibility;
ALTER TABLE activities DROP COLUMN IF EXISTS budget;

DROP INDEX IF EXISTS idx_activities_objective_id;
ALTER TABLE activities DROP COLUMN IF EXISTS objective_id;

ALTER TABLE activities ALTER COLUMN phase SET NOT NULL;

DROP TABLE IF EXISTS strategic_objectives CASCADE;
DROP TABLE IF EXISTS strategic_pillars    CASCADE;

ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plans_plan_type;
ALTER TABLE plans DROP COLUMN IF EXISTS plan_type;