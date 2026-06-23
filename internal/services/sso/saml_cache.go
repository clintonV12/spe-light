// saml_cache.go — PostgreSQL-backed SAML assertion replay cache.
//
// crewjam/saml prevents replay attacks by checking every incoming assertion
// ID against a store before processing. The default is an in-memory map that
// doesn't survive restarts and doesn't coordinate across instances. This file
// provides a PostgreSQL-backed implementation using the saml_replay_cache
// table from migration 004.
//
// Wire it into BuildSAMLSP by passing a *PGAssertionStore via samlsp.Options.
// See the comment in auth.go's BuildSAMLSP for where to set it.
package ssosvc

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGAssertionStore is a PostgreSQL-backed SAML assertion replay cache scoped
// to a single organisation.
type PGAssertionStore struct {
	db    *pgxpool.Pool
	orgID uuid.UUID
}

// NewPGAssertionStore creates a replay store for one org.
func NewPGAssertionStore(db *pgxpool.Pool, orgID uuid.UUID) *PGAssertionStore {
	return &PGAssertionStore{db: db, orgID: orgID}
}

// Add records an assertion ID as consumed up to expiry.
// Returns an error if the ID already exists (replay attack detected).
// crewjam/saml calls this before processing the assertion body; any error
// causes the assertion to be rejected.
func (s *PGAssertionStore) Add(id string, expiry time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := s.db.Exec(ctx,
		`INSERT INTO saml_replay_cache (id, org_id, not_on_or_after)
		 VALUES ($1, $2, $3)`,
		id, s.orgID, expiry,
	)
	if err != nil {
		// SQLSTATE 23505 = unique_violation — assertion ID already consumed.
		if strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "unique") {
			return fmt.Errorf("SAML assertion replay detected (assertion ID %q already used)", id)
		}
		return fmt.Errorf("store assertion ID: %w", err)
	}
	return nil
}

// Has reports whether the assertion ID is present and not yet expired.
// crewjam/saml uses this as a quick pre-check before calling Add.
func (s *PGAssertionStore) Has(id string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var exists bool
	_ = s.db.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM saml_replay_cache
		   WHERE id = $1 AND org_id = $2 AND not_on_or_after > NOW()
		 )`,
		id, s.orgID,
	).Scan(&exists)
	return exists
}
