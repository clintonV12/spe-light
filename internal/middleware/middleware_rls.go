// Package middleware — rls.go
//
// RLS request middleware (gap from rls.go integration note).
//
// Migration 002 added PostgreSQL row-level security policies, but the
// internal/database/rls.go file documents that they are "not yet wired into
// the live connection pool." This middleware closes that gap.
//
// How it works:
//
//  1. It acquires a *dedicated* connection from the pool for the duration of
//     the request (pgxpool normally multiplexes — SET on one conn doesn't
//     carry to another, so we need a pinned conn).
//  2. It calls SET app.current_org_id and SET app.bypass_rls on that conn.
//  3. It stores the acquired *pgx.Conn in the request context under connKey.
//  4. Service methods read the conn from context using ConnFrom(ctx); if absent
//     (e.g. public routes that don't run this middleware) they fall back to
//     using the pool directly as before.
//  5. The conn is released back to the pool at the end of the request via defer.
//
// IMPORTANT — service method migration:
// For RLS to actually protect anything, every service method that queries
// tenant-scoped tables must use ConnFrom(ctx) instead of s.db.QueryRow/Query/Exec
// directly. Until that migration is complete (touch every method in plansvc,
// orgsvc, etc.) the middleware is active but RLS policies are not firing on
// pool-direct queries. The safe, incremental approach is:
//
//  1. Wire this middleware now (this file).
//  2. Add ConnFrom to the highest-risk reads first (ListPlans, ListActivities).
//  3. Migrate remaining methods over multiple PRs.
//
// This is safer than a big-bang refactor that touches every service at once.
package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"spe-light/internal/database"
	"spe-light/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type rlsConnKey struct{}

// WithRLS returns middleware that acquires a dedicated DB connection per
// request, sets the RLS session variables on it, and stores it in the
// request context. Must be placed after Authenticate in the chain.
func WithRLS(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := ClaimsFrom(r.Context())
			if claims == nil {
				// No JWT claims means a public route — just pass through.
				next.ServeHTTP(w, r)
				return
			}

			conn, err := pool.Acquire(r.Context())
			if err != nil {
				slog.Error("rls middleware: acquire connection", "err", err)
				// Fail open: serve the request without RLS rather than returning 500.
				// Application-layer org_id filtering is still active.
				next.ServeHTTP(w, r)
				return
			}
			defer conn.Release()

			// bypass grants cross-org visibility on RLS-scoped queries.
			// super_admin/platform_support get it because their whole
			// console is cross-tenant. RoleAdvisor gets it too — but only
			// while it has no selected org (claims.OrgID nil here, at the
			// top of the authenticated group): that's exactly the state an
			// advisor is in while listing/creating organisations in
			// /api/v1/admin/orgs, which is itself a cross-tenant view.
			// Once an advisor selects an org, ResolveAdvisorOrgContext
			// (internal/middleware/advisor_context.go) re-sets this same
			// connection's org context with bypass explicitly false — see
			// that file for why an advisor acting inside one org must NOT
			// keep cross-tenant bypass for the rest of the request.
			bypass := claims.Role == models.RoleSuperAdmin ||
				claims.Role == models.RolePlatformSupport ||
				claims.Role == models.RoleAdvisor

			if err := database.WithOrgContext(r.Context(), conn.Conn(), claims.OrgID, bypass); err != nil {
				slog.Error("rls middleware: set org context", "err", err)
				// Same fail-open approach.
				next.ServeHTTP(w, r)
				return
			}

			ctx := context.WithValue(r.Context(), rlsConnKey{}, conn.Conn())
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ConnFrom returns the RLS-scoped *pgx.Conn stored by WithRLS, or nil if
// the middleware wasn't in the chain (public routes, tests).
func ConnFrom(ctx context.Context) *pgx.Conn {
	c, _ := ctx.Value(rlsConnKey{}).(*pgx.Conn)
	return c
}
