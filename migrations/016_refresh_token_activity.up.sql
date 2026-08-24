-- StratPlan / SPE-Light  —  016 refresh token activity tracking
--
-- Adds refresh_tokens.last_used_at so authsvc.Service.RefreshToken can
-- enforce SESSION_IDLE_TIMEOUT_MIN (see internal/config/config.go) — a
-- session that has gone idle for longer than that is rejected (and
-- revoked) on its next refresh attempt, independent of the token's own
-- absolute expires_at (JWT_REFRESH_EXPIRY_DAYS, 30 days by default).
--
-- Without this column there was no server-side signal of how long a
-- session had actually been quiet — only when it was issued and when it
-- hard-expires — so an idle session could sit unused for weeks and still
-- silently refresh itself back to life on the next click.

ALTER TABLE refresh_tokens
    ADD COLUMN last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill existing rows from created_at rather than leaving every
-- pre-existing session stamped at migration-run time, which would
-- otherwise hand each of them a fresh idle clock it didn't earn.
UPDATE refresh_tokens SET last_used_at = created_at;

-- Every refresh call filters against this column — index it the same way
-- expires_at-style lookups elsewhere in this schema are indexed.
CREATE INDEX idx_refresh_tokens_last_used_at ON refresh_tokens(last_used_at);