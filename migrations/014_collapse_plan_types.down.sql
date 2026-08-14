-- Reverses 014_collapse_plan_types_up.sql.
--
-- Note: this is not a full reversal. The up-migration permanently deleted
-- every "international" plan (and its activities/links/milestones/reports/
-- viewer grants) — that data is gone and cannot be restored by this
-- down-migration, the same as 008's down-migration can't restore local-plan
-- data it deletes on rollback. This also has no way to convert an
-- 'advanced_research' activity created after the up-migration back into a
-- phase-bearing international activity (it never had a phase to restore),
-- so those are deleted here too, for the same reason 008's down-migration
-- deletes activities with phase IS NULL — they can't satisfy the restored
-- schema shape.

-- Every remaining plan is the (formerly "local") pillar/objective
-- structure, so that's what every existing row backfills to.
ALTER TABLE plans ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'local';
ALTER TABLE plans ADD CONSTRAINT chk_plans_plan_type
    CHECK (plan_type IN ('international', 'local'));

-- Advanced Research activities (category = 'advanced_research') have
-- neither a phase nor an objective_id — they cannot satisfy the restored
-- exactly-one-hierarchy CHECK below. Clear the FK-blocking rows first, same
-- as the up-migration's international cleanup, then delete them.
DELETE FROM activity_links
  WHERE source_id IN (SELECT id FROM activities WHERE category = 'advanced_research')
     OR target_id IN (SELECT id FROM activities WHERE category = 'advanced_research');
DELETE FROM milestones
  WHERE linked_activity_id IN (SELECT id FROM activities WHERE category = 'advanced_research');
DELETE FROM activities WHERE category = 'advanced_research';

ALTER TABLE activities DROP CONSTRAINT IF EXISTS chk_activities_exactly_one_hierarchy;

DROP INDEX IF EXISTS idx_activities_category;
ALTER TABLE activities DROP CONSTRAINT IF EXISTS chk_activities_category;
ALTER TABLE activities DROP COLUMN IF EXISTS category;

-- Restore phase exactly as it stood pre-014: nullable (008 already relaxed
-- the original 001 NOT NULL and never re-tightened it), CHECK'd to P1-P3.
ALTER TABLE activities ADD COLUMN phase TEXT;
ALTER TABLE activities ADD CONSTRAINT activities_phase_check CHECK (phase IN ('P1', 'P2', 'P3'));
CREATE INDEX idx_activities_phase ON activities(phase);

ALTER TABLE activities ADD CONSTRAINT chk_activities_exactly_one_hierarchy
    CHECK (
        (phase IS NOT NULL AND objective_id IS NULL)
        OR
        (phase IS NULL AND objective_id IS NOT NULL)
    );