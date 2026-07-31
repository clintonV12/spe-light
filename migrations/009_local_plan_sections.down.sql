-- Reverses 009_local_plan_sections.up.sql.
--
-- All tables here are additive and independent of activities/pillars, so
-- unlike 008's down-migration this one is non-destructive to anything
-- outside itself — dropping these tables loses only chapter 2/3/6/7 content,
-- never activities, pillars, or objectives.

DROP TABLE IF EXISTS me_items            CASCADE;
DROP TABLE IF EXISTS org_structure_roles CASCADE;
DROP TABLE IF EXISTS pestel_items        CASCADE;
DROP TABLE IF EXISTS swot_items          CASCADE;
DROP TABLE IF EXISTS stakeholders        CASCADE;
DROP TABLE IF EXISTS core_values         CASCADE;

ALTER TABLE plans DROP COLUMN IF EXISTS mission;
ALTER TABLE plans DROP COLUMN IF EXISTS vision;