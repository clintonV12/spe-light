-- Reverses 011_kpi_tracking_up.sql.
--
-- Both tables are additive and independent of activities/pillars/plans
-- beyond their FKs, so — like 009's down-migration — this is non-destructive
-- to anything outside itself: dropping these tables loses only Tracking
-- Module content (KPIs and their measurements), never activities, pillars,
-- objectives, or plans.

DROP TABLE IF EXISTS kpi_measurements CASCADE;
DROP TABLE IF EXISTS kpis             CASCADE;