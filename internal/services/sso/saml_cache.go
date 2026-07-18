// saml_cache.go — PostgreSQL-backed SAML assertion replay cache.
//
// crewjam/saml prevents replay attacks by checking every incoming assertion
// ID before the resulting session is created. Earlier revisions of this file
// tried to wire that check in via a `saml.ServiceProvider.AssertionStore`
// field — that field does not exist in crewjam/saml; there is no built-in
// assertion-ID store to plug into.
//
// The actual extension point crewjam/saml provides for this is the
// `samlsp.AssertionHandler` interface: `samlsp.Middleware` calls
// `AssertionHandler.HandleAssertion(assertion)` on every successfully
// signature-and-timestamp-validated assertion, immediately before it creates
// a session from it. Returning a non-nil error there rejects the login. The
// library's default AssertionHandler (NopAssertionHandler) does nothing,
// which is why replay protection needs to be supplied here.
//
// PGAssertionHandler persists each assertion's ID in Postgres (see the
// saml_replay_cache table from migration 004) so a duplicate — whether from
// a network resend, a captured/replayed HTTP POST, or two app instances
// racing — is caught even across restarts and multiple instances, which an
// in-memory set would not survive.
//
// Wire it into BuildSAMLSP by assigning it to sp.AssertionHandler after
// samlsp.New(opts) — see auth.go.
package ssosvc

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/crewjam/saml"
	"github.com/crewjam/saml/samlsp"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Compile-time check that PGAssertionHandler satisfies samlsp.AssertionHandler.
var _ samlsp.AssertionHandler = (*PGAssertionHandler)(nil)

// PGAssertionHandler is a PostgreSQL-backed SAML assertion replay guard,
// scoped to a single organisation.
type PGAssertionHandler struct {
	db    *pgxpool.Pool
	orgID uuid.UUID
}

// NewPGAssertionHandler creates a replay guard for one org.
func NewPGAssertionHandler(db *pgxpool.Pool, orgID uuid.UUID) *PGAssertionHandler {
	return &PGAssertionHandler{db: db, orgID: orgID}
}

// HandleAssertion is called by samlsp.Middleware.ServeACS with every
// assertion that has already passed signature, audience, and timestamp
// validation — but before a session is created from it. Returning an error
// here aborts the login.
//
// It records the assertion's ID in saml_replay_cache. Because (id, org_id)
// is unique, a second attempt to record the same assertion ID fails with a
// unique-violation, which we surface as a replay error.
func (h *PGAssertionHandler) HandleAssertion(assertion *saml.Assertion) error {
	if assertion == nil || assertion.ID == "" {
		return fmt.Errorf("SAML assertion is missing an ID")
	}

	// Expire the cache row when the assertion itself would no longer be
	// valid, so the table doesn't grow forever. Prefer the bearer
	// SubjectConfirmationData's NotOnOrAfter (the actual expiry crewjam/saml
	// enforces); fall back to IssueInstant+MaxIssueDelay if that's absent.
	expiry := assertion.IssueInstant.Add(saml.MaxIssueDelay)
	if assertion.Subject != nil {
		for _, sc := range assertion.Subject.SubjectConfirmations {
			if sc.SubjectConfirmationData != nil && !sc.SubjectConfirmationData.NotOnOrAfter.IsZero() {
				expiry = sc.SubjectConfirmationData.NotOnOrAfter
				break
			}
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := h.db.Exec(ctx,
		`INSERT INTO saml_replay_cache (id, org_id, not_on_or_after)
		 VALUES ($1, $2, $3)`,
		assertion.ID, h.orgID, expiry,
	)
	if err != nil {
		// SQLSTATE 23505 = unique_violation — assertion ID already consumed.
		if strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "unique") {
			return fmt.Errorf("SAML assertion replay detected (assertion ID %q already used)", assertion.ID)
		}
		return fmt.Errorf("record assertion id: %w", err)
	}
	return nil
}
