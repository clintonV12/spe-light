// Package handlers wires together all HTTP routes and their middleware for
// StratPlan. This is the single entry point for the HTTP layer.
//
// Route layout:
//
//	Public (no auth):
//	  GET  /health
//	  POST /auth/login                      — email+password login (rate-limited)
//	  POST /auth/refresh                    — rotate refresh token
//	  POST /auth/logout                     — revoke session
//	  POST /auth/password-reset/request     — request a reset link
//	  POST /auth/password-reset/confirm     — consume reset token + set new password
//	  POST /invitations/accept              — accept an invite token
//
//	Authenticated (Bearer JWT required):
//	  Org admin (/api/v1/org):
//	    GET    /users
//	    PATCH  /users/{userID}
//	    GET    /invitations
//	    POST   /invitations
//	    DELETE /invitations/{invitationID}
//	    POST   /invitations/{invitationID}/resend
//
//	  Platform admin (/api/v1/admin) — super_admin + platform_support:
//	    GET  /orgs                          — list all orgs
//	    POST /orgs                          — create org  (super_admin only)
//	    PATCH /orgs/{orgID}                 — update org  (super_admin only)
//	    POST /org-invitations               — invite org admin (super_admin only)
//
//	  Plans + activities (/api/v1/plans, /api/v1/activities) — Sprint 2:
//	    GET    /plans
//	    POST   /plans                       — planner+
//	    GET    /plans/{planID}
//	    PUT    /plans/{planID}              — planner+
//	    DELETE /plans/{planID}              — org_admin only
//	    GET    /plans/{planID}/activities
//	    POST   /plans/{planID}/activities   — planner+
//	    GET    /plans/{planID}/progress
//	    PUT    /activities/{activityID}     — planner+ or assigned contributor
//	    POST   /activities/{activityID}/links — planner+
//
//	  AI + Reports (Sprint 3+):
//	    POST /ai/draft
//	    POST /ai/summary
//	    POST /plans/{planID}/reports
//	    GET  /reports/{jobID}
package handlers

import (
	"net/http"

	"spe-light/internal/config"
	"spe-light/internal/middleware"
	"spe-light/internal/models"
	"spe-light/internal/response"
	adminsvc "spe-light/internal/services/admin"
	authsvc "spe-light/internal/services/auth"
	orgsvc "spe-light/internal/services/org"
	plansvc "spe-light/internal/services/plan"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewRouter builds and returns the fully configured HTTP handler tree.
// It constructs all services internally so the caller (main) only needs to
// supply config and a DB pool.
func NewRouter(cfg *config.Config, db *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()

	// ── Global middleware ─────────────────────────────────────────────
	r.Use(chimw.RequestID) // injects X-Request-ID into every response
	r.Use(chimw.RealIP)    // populates r.RemoteAddr from X-Forwarded-For
	r.Use(chimw.Logger)    // structured request/response logging
	r.Use(chimw.Recoverer) // recovers panics and returns 500
	r.Use(chimw.CleanPath) // normalises double slashes etc.
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", cfg.AppURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// ── Service construction ──────────────────────────────────────────
	emailSvc, _ := newEmailService(cfg) // panics on template error at startup
	authService := authsvc.New(db, cfg, emailSvc)
	orgService := orgsvc.New(db, cfg, emailSvc)
	adminService := adminsvc.New(db, cfg, emailSvc)
	planService := plansvc.New(db, cfg)

	// ── Handler construction ──────────────────────────────────────────
	authH := NewAuth(authService)
	orgH := NewOrg(orgService)
	adminH := NewAdmin(adminService)
	planH := NewPlan(planService)

	// ── Public routes ─────────────────────────────────────────────────
	r.Get("/health", Health)

	r.Route("/auth", func(r chi.Router) {
		// Rate-limit login to prevent brute-force attacks (REQ-NF-015).
		r.With(middleware.RateLimit).Post("/login", authH.Login)
		r.Post("/refresh", authH.Refresh)
		r.Post("/logout", authH.Logout)
		r.Post("/password-reset/request", authH.RequestPasswordReset)
		r.Post("/password-reset/confirm", authH.ConfirmPasswordReset)
	})

	// Invite acceptance is public — the token is the credential.
	r.Post("/invitations/accept", authH.AcceptInvitation)

	// ── Authenticated routes ──────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(middleware.Authenticate(cfg.JWTSecret))

		// ── Org admin — user and invitation management ─────────────
		r.Route("/api/v1/org", func(r chi.Router) {
			r.Use(middleware.RequireRole(models.RoleOrgAdmin))
			r.Get("/users", orgH.ListUsers)
			r.Patch("/users/{userID}", orgH.UpdateUser)
			r.Get("/invitations", orgH.ListInvitations)
			r.Post("/invitations", orgH.SendInvitation)
			r.Delete("/invitations/{invitationID}", orgH.CancelInvitation)
			r.Post("/invitations/{invitationID}/resend", orgH.ResendInvitation)
		})

		// ── Platform admin — cross-org console ────────────────────
		r.Route("/api/v1/admin", func(r chi.Router) {
			// Both super_admin and platform_support can read.
			r.Use(middleware.RequireRole(models.RoleSuperAdmin, models.RolePlatformSupport))
			r.Get("/orgs", adminH.ListOrgs)

			// Mutations are super_admin only.
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/orgs", adminH.CreateOrg)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Patch("/orgs/{orgID}", adminH.UpdateOrg)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/org-invitations", adminH.SendOrgInvitation)
		})

		// ── Plans (Sprint 2) ───────────────────────────────────────
		r.Route("/api/v1/plans", func(r chi.Router) {
			// All authenticated org users can list and view plans.
			r.Get("/", planH.ListPlans)
			r.Get("/{planID}", planH.GetPlan)
			r.Get("/{planID}/progress", planH.GetProgress)
			r.Get("/{planID}/activities", planH.ListActivities)

			// Only planner and above can create/edit.
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/", planH.CreatePlan)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/{planID}", planH.UpdatePlan)

			// Only org_admin can delete plans.
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin,
			)).Delete("/{planID}", planH.DeletePlan)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/activities", planH.CreateActivity)

			// Report generation — Sprint 3.
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/reports", notImplemented)
		})

		// ── Activities (Sprint 2) ──────────────────────────────────
		// Activity updates allow contributors (for assigned activities);
		// the handler enforces the assignment check.
		r.Route("/api/v1/activities/{activityID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner, models.RoleContributor,
			)).Put("/", planH.UpdateActivity)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/links", planH.CreateActivityLink)
		})

		// ── AI (Sprint 3+) ─────────────────────────────────────────
		r.Route("/api/v1/ai", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/draft", notImplemented)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/summary", notImplemented)
		})

		// ── Reports (Sprint 3+) ────────────────────────────────────
		r.Get("/api/v1/reports/{jobID}", notImplemented)
	})

	return r
}

// notImplemented returns 501 for routes that are defined but not yet built.
// Returning 501 (not 404) lets the frontend know the route exists but is
// coming in a future sprint, rather than being a routing mistake.
func notImplemented(w http.ResponseWriter, r *http.Request) {
	response.ErrorJSON(w, "not yet implemented", http.StatusNotImplemented)
}
