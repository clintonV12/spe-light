// advisor_context.go — resolves the X-Org-Context header for advisor
// requests.
//
// Written against the real middleware_auth.go / middleware_rls.go (not
// guessed): claims live under the package-private claimsKey set by
// Authenticate, and WithRLS pins one dedicated pooled connection per
// request (via ConnFrom) rather than broadcasting session state — so
// "switching" an advisor's effective org means updating that SAME pinned
// connection's RLS vars, not re-acquiring a second one.
package middleware

import (
	"context"
	"errors"
	"net/http"

	"spe-light/internal/database"
	"spe-light/internal/models"
	"spe-light/internal/response"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OrgContextHeader is the header an advisor's client sends to select which
// organisation they're currently acting in. A non-advisor sending this
// header has no effect — this middleware only acts on RoleAdvisor requests.
const OrgContextHeader = "X-Org-Context"

// ResolveAdvisorOrgContext must be mounted on every route tree that serves
// org-scoped data (/api/v1/org, /api/v1/plans, /api/v1/activities, and so
// on) — NOT on /api/v1/me or /api/v1/admin, which are either org-agnostic
// or already have their own advisor-specific route wiring (see router.go).
// It must run after both Authenticate and WithRLS in the chain.
//
// Behaviour:
//   - Non-advisor requests pass through unchanged.
//   - Advisor requests without a valid X-Org-Context header pass through
//     unchanged too — claims.Role stays "advisor" and claims.OrgID stays
//     nil, so the existing RequireRole(RoleOrgAdmin, ...) gates on every
//     org-scoped route correctly reject them. This is what forces "pick an
//     org before touching its data" without any per-route special-casing.
//   - Advisor requests with a valid header (org exists, not deleted, and
//     is_active) get two things updated together:
//     1. The request's *claims* (context, read via ClaimsFrom) — OrgID
//     becomes the target org, Role becomes RoleOrgAdmin. Every
//     downstream handler that reads claims.OrgID directly (org.go,
//     sso.go, etc. all do — see their nil-check-then-*claims.OrgID
//     pattern) then behaves exactly as it would for a real org_admin
//     of that org, including audit logging, which still records the
//     advisor's own UserID as the actor.
//     2. The RLS-scoped connection WithRLS already pinned for this
//     request (ConnFrom(ctx)) — re-pointed at the target org with
//     bypass explicitly false. WithRLS's own bypass calculation
//     treats RoleAdvisor as bypass=true (needed for the org-agnostic
//     /api/v1/admin/orgs listing/creation), so once an advisor has
//     picked an org, this is what turns cross-tenant bypass back off
//     for the rest of the request — an advisor acting inside one org
//     gets that org's normal RLS scoping, not a platform-wide view of
//     every tenant's rows.
//   - An invalid, missing-org, or inactive-org header is a hard 403 rather
//     than a silent pass-through, so a stale or mistyped org ID never
//     quietly falls back to "no org" and produces confusing downstream
//     errors — the advisor gets an explicit, actionable message instead.
func ResolveAdvisorOrgContext(db *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := ClaimsFrom(r.Context())
			if claims == nil || claims.Role != models.RoleAdvisor {
				next.ServeHTTP(w, r)
				return
			}

			raw := r.Header.Get(OrgContextHeader)
			if raw == "" {
				// No org selected yet — let RequireRole reject downstream.
				next.ServeHTTP(w, r)
				return
			}

			orgID, err := uuid.Parse(raw)
			if err != nil {
				response.ErrorJSON(w, "invalid "+OrgContextHeader+" header", http.StatusBadRequest)
				return
			}

			active, err := orgIsActive(r.Context(), db, orgID)
			if errors.Is(err, pgx.ErrNoRows) {
				response.ErrorJSON(w, "organisation not found", http.StatusForbidden)
				return
			}
			if err != nil {
				response.ErrorJSON(w, "failed to verify organisation", http.StatusInternalServerError)
				return
			}
			if !active {
				response.ErrorJSON(w, "this organisation is deactivated", http.StatusForbidden)
				return
			}

			// Re-point the already-pinned RLS connection at the target org,
			// bypass=false. If WithRLS failed open (no conn pinned — see
			// its own fail-open branches), there's nothing to update here;
			// app-layer org_id filtering via the swapped claims below still
			// applies, same as it does for a real org_admin today.
			if conn := ConnFrom(r.Context()); conn != nil {
				if err := database.WithOrgContext(r.Context(), conn, &orgID, false); err != nil {
					response.ErrorJSON(w, "failed to set organisation context", http.StatusInternalServerError)
					return
				}
			}

			effective := *claims // copy — never mutate the advisor's real claims
			effective.OrgID = &orgID
			effective.Role = models.RoleOrgAdmin

			ctx := context.WithValue(r.Context(), claimsKey, &effective)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func orgIsActive(ctx context.Context, db *pgxpool.Pool, orgID uuid.UUID) (bool, error) {
	var active bool
	err := db.QueryRow(ctx,
		`SELECT is_active FROM organisations WHERE id = $1 AND deleted_at IS NULL`, orgID,
	).Scan(&active)
	return active, err
}
