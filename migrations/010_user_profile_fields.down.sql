-- 010_user_profile_fields.down.sql
ALTER TABLE users
    DROP COLUMN IF EXISTS phone,
    DROP COLUMN IF EXISTS avatar_url;