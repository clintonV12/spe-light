// This file provides helpers for setting PostgreSQL session-level variables
// that the row-level security policies in migration 002 depend on.
//
// IMPORTANT — integration status:
// The RLS policies in migrations/002_row_level_security.up.sql are defense
// in depth: every service method already filters by org_id explicitly, so
// the application is safe even without this wired in. WithOrgContext is
// provided so RLS can be activated as an additional layer once the team is
// ready to pay the cost of acquiring a dedicated connection per request
// (pgxpool normally multiplexes queries across connections, and session-level
// SET statements only apply to the connection they were run on — so this
// must be combined with pool.Acquire() / conn.Release() rather than pool.Exec()
// directly, or every query in the request must run through tx).
//
// Recommended integration point: wrap the authenticated route group in
// middleware that does:
//
//	conn, _ := pool.Acquire(ctx)
//	defer conn.Release()
//	database.WithOrgContext(ctx, conn, claims.OrgID, claims.Role.IsPlatformRole())
//	ctx = context.WithValue(ctx, connKey, conn)
//
// and have service methods use the connection from context instead of the pool.
// This is left as a Sprint 3 task since it touches every service method's
// signature; tracked as a known gap below.
package database

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// WithOrgContext sets the PostgreSQL session variables consumed by the RLS
// policies (current_org_id() and rls_bypassed()) on the given connection.
//
// Call this once per acquired connection, before running any tenant-scoped
// queries on it. bypassRLS should be true for platform-tier roles
// (super_admin, platform_support) who are allowed to see across orgs.
func WithOrgContext(ctx context.Context, conn *pgx.Conn, orgID *uuid.UUID, bypassRLS bool) error {
	orgIDStr := ""
	if orgID != nil {
		orgIDStr = orgID.String()
	}

	if _, err := conn.Exec(ctx, `SELECT set_config('app.current_org_id', $1, false)`, orgIDStr); err != nil {
		return fmt.Errorf("set app.current_org_id: %w", err)
	}
	bypassStr := "false"
	if bypassRLS {
		bypassStr = "true"
	}
	if _, err := conn.Exec(ctx, `SELECT set_config('app.bypass_rls', $1, false)`, bypassStr); err != nil {
		return fmt.Errorf("set app.bypass_rls: %w", err)
	}
	return nil
}
