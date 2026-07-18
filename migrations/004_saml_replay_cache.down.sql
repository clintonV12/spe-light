DROP TRIGGER  IF EXISTS trg_saml_replay_cache_cleanup ON saml_replay_cache;
DROP FUNCTION IF EXISTS saml_replay_cache_cleanup();
DROP INDEX    IF EXISTS idx_saml_replay_cache_expires;
DROP TABLE    IF EXISTS saml_replay_cache;