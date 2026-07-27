-- Reverses 007_org_profile_fields.up.sql.
--
-- Note: any org profile data entered via PATCH /api/v1/org (address,
-- country, contact info, org structure, member count) is dropped along
-- with the columns below. Back up anything you need before rolling back.

ALTER TABLE organisations DROP CONSTRAINT IF EXISTS chk_org_total_members_nonneg;

ALTER TABLE organisations DROP COLUMN IF EXISTS total_members;
ALTER TABLE organisations DROP COLUMN IF EXISTS org_structure;
ALTER TABLE organisations DROP COLUMN IF EXISTS contact_phone;
ALTER TABLE organisations DROP COLUMN IF EXISTS contact_email;
ALTER TABLE organisations DROP COLUMN IF EXISTS country;
ALTER TABLE organisations DROP COLUMN IF EXISTS address;