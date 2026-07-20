-- Reverses 006_extend_reports_for_custom_type.up.sql.
--
-- Note: the original schema's `type` vocabulary has no equivalent for
-- 'custom' — any custom reports are deleted below so the narrower CHECK
-- constraint can be restored. Back up any custom report rows you need
-- before rolling back.

ALTER TABLE reports ALTER COLUMN generated_at DROP DEFAULT;

ALTER TABLE reports DROP COLUMN IF EXISTS error;
ALTER TABLE reports DROP COLUMN IF EXISTS sections;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_type_check;

DELETE FROM reports WHERE type = 'custom';

UPDATE reports SET type = CASE type
    WHEN 'full_plan'         THEN 'full'
    WHEN 'per_phase'         THEN 'phase'
    WHEN 'executive_summary' THEN 'executive'
    WHEN 'progress_status'   THEN 'progress'
    WHEN 'activity_detail'   THEN 'activity'
    ELSE type
END;

UPDATE reports SET status = CASE status
    WHEN 'processing' THEN 'pending'
    WHEN 'complete'   THEN 'ready'
    ELSE status
END;

ALTER TABLE reports
    ADD CONSTRAINT reports_type_check
    CHECK (type IN ('full', 'phase', 'executive', 'progress', 'activity'));

ALTER TABLE reports
    ADD CONSTRAINT reports_status_check
    CHECK (status IN ('pending', 'ready', 'failed'));