-- StratPlan / SPE-Light  —  006 extend reports table for custom report generation
--
-- The 001_initial_schema `reports` table predates the report-generation
-- feature actually being implemented, and its placeholder `type`/`status`
-- vocabularies and column set don't match what the finished feature
-- (internal/services/report + ReportsPage.tsx) needs:
--
--   1. `type` values in use by the API/frontend are (full_plan,
--      executive_summary, per_phase, progress_status, activity_detail,
--      custom) — not the original (full, phase, executive, progress,
--      activity). The CHECK constraint is dropped and recreated with the
--      real values, including the new "custom" type.
--
--   2. `status` values in use are (processing, complete, failed) — not the
--      original (pending, ready, failed). Same treatment.
--
--   3. `sections JSONB` is added to persist which sections were selected
--      for a `custom` report (executive_summary, phase_activities +
--      phases[], progress_status, milestones, dependency_links,
--      ai_summary). NULL for the five fixed report types.
--
--   4. `error TEXT` is added so a failed generation can record why,
--      alongside `status = 'failed'`.
--
--   5. `generated_at` had no DEFAULT, requiring every INSERT to supply it
--      explicitly. Report generation is currently synchronous (a row is
--      only ever inserted once already complete — see reportsvc's package
--      doc comment), so a DEFAULT NOW() removes the need to pass it in.
--
-- `format` (pdf/docx/xlsx) and the rest of the original columns are left
-- untouched — they already match.
--
-- Constraint names: the original CHECK constraints on `type` and `status`
-- were declared inline without explicit names, so Postgres auto-generated
-- them (normally `reports_type_check` / `reports_status_check`). Rather
-- than assume that naming, this migration looks the constraints up by the
-- column they're attached to and drops whatever it finds — safer than a
-- hardcoded DROP CONSTRAINT that could silently no-op on a differently
-- named constraint and leave the old, incompatible restriction in place
-- alongside the new one.

DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t      ON t.oid = c.conrelid
        JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE t.relname = 'reports'
          AND c.contype = 'c'
          AND a.attname IN ('type', 'status')
    LOOP
        EXECUTE format('ALTER TABLE reports DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

-- Defensive backfill in case any rows exist using the old vocabulary (the
-- report endpoints returned 501 Not Implemented until this feature shipped,
-- so on a normal environment this updates zero rows).
UPDATE reports SET type = CASE type
    WHEN 'full'      THEN 'full_plan'
    WHEN 'phase'      THEN 'per_phase'
    WHEN 'executive'  THEN 'executive_summary'
    WHEN 'progress'   THEN 'progress_status'
    WHEN 'activity'   THEN 'activity_detail'
    ELSE type
END;

UPDATE reports SET status = CASE status
    WHEN 'pending' THEN 'processing'
    WHEN 'ready'   THEN 'complete'
    ELSE status
END;

ALTER TABLE reports
    ADD CONSTRAINT reports_type_check
    CHECK (type IN ('full_plan', 'executive_summary', 'per_phase', 'progress_status', 'activity_detail', 'custom'));

ALTER TABLE reports
    ADD CONSTRAINT reports_status_check
    CHECK (status IN ('processing', 'complete', 'failed'));

ALTER TABLE reports ADD COLUMN IF NOT EXISTS sections JSONB;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS error    TEXT;

ALTER TABLE reports ALTER COLUMN generated_at SET DEFAULT NOW();