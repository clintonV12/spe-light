-- StratPlan / SPE-Light  —  014 collapse plan types into a single structure
--
-- Collapses "international" and "local" plan types into a single plan
-- structure (the former "local"/ESWAMCU structure: Strategic Pillars >
-- Strategic Objectives > Activities). Maintaining two parallel activity
-- hierarchies (fixed P1/P2/P3 phases vs. user-defined pillars/objectives)
-- doubled the branching logic in plansvc for no real product benefit going
-- forward. Everything international plans could do that local plans
-- couldn't (Business Model Canvas, Competitive Analysis, Risk Register,
-- OKR/Balanced Scorecard, Operational Roadmap, Resource Plan, Budget
-- Allocation) is preserved as a new optional "Advanced Research" bucket of
-- activities that attach directly to the plan instead of an objective.
--
-- Confirmed with product: no existing "international" plan data needs to
-- be preserved, so this is a clean cutover rather than a data migration —
-- see the deletes below. If that's ever not true for a given environment,
-- do NOT run this migration as-is; write a proper backfill (synthesize a
-- pillar/objective per phase, move activities across) first.

-- ── Clean cutover: remove international plans and everything under them ──
--
-- None of activity_links / milestones / reports / plan_viewers cascade on
-- delete — their FKs to plans/activities were never given ON DELETE
-- CASCADE (001_initial_schema), since the app layer only ever soft-deletes
-- (deleted_at) rather than removing rows. This migration hard-deletes, so
-- each has to be cleared explicitly first, in FK-safe order, or the
-- DELETE FROM activities / plans below fail with a foreign key violation.
DELETE FROM activity_links WHERE plan_id IN (SELECT id FROM plans WHERE plan_type = 'international');
DELETE FROM milestones     WHERE plan_id IN (SELECT id FROM plans WHERE plan_type = 'international');
DELETE FROM reports        WHERE plan_id IN (SELECT id FROM plans WHERE plan_type = 'international');
DELETE FROM plan_viewers   WHERE plan_id IN (SELECT id FROM plans WHERE plan_type = 'international');
DELETE FROM activities     WHERE plan_id IN (SELECT id FROM plans WHERE plan_type = 'international');
DELETE FROM plans          WHERE plan_type = 'international';

-- ── Activities: drop phase, add category ───────────────────────────────────
ALTER TABLE activities DROP CONSTRAINT IF EXISTS chk_activities_exactly_one_hierarchy;

-- The fixed P1/P2/P3 phase concept only ever applied to international
-- plans, which no longer exist. (idx_activities_phase and the inline
-- 001-era phase CHECK are both dropped automatically along with the
-- column — named explicitly here anyway, matching 008's down-migration
-- style, for anyone reading this migration to understand what's leaving.)
DROP INDEX IF EXISTS idx_activities_phase;
ALTER TABLE activities DROP COLUMN IF EXISTS phase;

-- category is NULL for a normal activity attached to a Strategic Objective,
-- or 'advanced_research' for a standalone activity attached directly to the
-- plan (see models.ActivityCategory / models.AdvancedResearchType).
ALTER TABLE activities ADD COLUMN category TEXT;

ALTER TABLE activities ADD CONSTRAINT chk_activities_category
    CHECK (category IS NULL OR category = 'advanced_research');

-- Exactly one of: attached to an objective, or an advanced-research item
-- attached directly to the plan.
ALTER TABLE activities ADD CONSTRAINT chk_activities_exactly_one_hierarchy
    CHECK (
        (objective_id IS NOT NULL AND category IS NULL)
        OR
        (objective_id IS NULL AND category = 'advanced_research')
    );

-- Partial index — category is NULL for the large majority of activities
-- (every ordinary objective-attached one), so only indexing the
-- Advanced-Research rows keeps this small and keeps
-- "list this plan's Advanced Research activities" cheap.
CREATE INDEX idx_activities_category ON activities(category) WHERE category IS NOT NULL;

-- ── Plans: drop plan_type ────────────────────────────────────────────────
ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plans_plan_type;
ALTER TABLE plans DROP COLUMN IF EXISTS plan_type;