-- StratPlan / SPE-Light  —  004 SAML assertion replay cache
--
-- crewjam/saml validates SAML assertions and prevents replay attacks by
-- checking that each assertion ID has not been used before within the
-- assertion's NotOnOrAfter window. By default it uses an in-memory cache
-- which is lost on restart — this migration provides a PostgreSQL-backed
-- store so replay protection survives process restarts and works correctly
-- in multi-instance deployments.
--
-- The table is queried via the samlsp.PostgresSessionProvider (or equivalent
-- custom implementation in internal/services/sso/saml_cache.go).
--
-- Cleanup: rows expire naturally after their not_on_or_after time. A
-- background sweep or a pg_cron job can DELETE WHERE not_on_or_after < NOW()
-- periodically, but this is not required for correctness — the application
-- always checks not_on_or_after before accepting an entry.

CREATE TABLE IF NOT EXISTS saml_replay_cache (
    id               TEXT        PRIMARY KEY,    -- SAML assertion ID (<samlp:Response ID="...">)
    org_id           UUID        NOT NULL REFERENCES organisations(id),
    not_on_or_after  TIMESTAMPTZ NOT NULL,        -- assertion validity window end
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index to make expiry sweeps fast.
CREATE INDEX idx_saml_replay_cache_expires ON saml_replay_cache(not_on_or_after);

-- Clean up expired entries automatically. This trigger fires on INSERT so the
-- table stays bounded without a separate cron job. It deletes entries older
-- than 24 hours beyond their not_on_or_after (generous buffer for clock skew).
CREATE OR REPLACE FUNCTION saml_replay_cache_cleanup() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM saml_replay_cache
    WHERE not_on_or_after < NOW() - INTERVAL '24 hours';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_saml_replay_cache_cleanup
    AFTER INSERT ON saml_replay_cache
    FOR EACH STATEMENT EXECUTE FUNCTION saml_replay_cache_cleanup();