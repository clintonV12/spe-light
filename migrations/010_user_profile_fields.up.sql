-- 010_user_profile_fields.up.sql
--
-- Adds the two self-service profile columns the Profile page needs beyond
-- what already exists on users (name, email, role, locale, is_active,
-- last_login_at). Both are optional/nullable — a user who hasn't filled
-- them in yet just omits that part of the profile card, same convention as
-- organisations' self-service fields (see 00X_org_profile_fields).
--
-- Deliberately NOT added here: a username column (the app authenticates by
-- email; introducing a separate username is a bigger design decision than
-- this module needs to make) and an MFA/verification-related column (left
-- for the future-enhancements work called out in profile.go's package doc).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone      TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;