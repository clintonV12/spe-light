// Package handlers wires together all HTTP routes and their middleware for
// StratPlan. This is the single entry point for the HTTP layer.
//
// Route layout:
//
//	Public (no auth):
//	  GET  /health
//	  POST /auth/login                              — rate-limited
//	  POST /auth/refresh
//	  POST /auth/logout
//	  POST /auth/password-reset/request
//	  POST /auth/password-reset/confirm
//	  POST /invitations/accept
//
//	  SSO (public — token is the credential or IdP posts here):
//	  GET  /auth/saml/:orgSlug/metadata             — SAML SP metadata XML   [501]
//	  POST /auth/saml/:orgSlug/acs                  — SAML ACS (IdP post-back) [501]
//	  GET  /auth/oidc/:orgSlug/login                — OIDC redirect           [501]
//	  GET  /auth/oidc/:orgSlug/callback             — OIDC callback           [501]
//
//	Authenticated (Bearer JWT required):
//	  RLS middleware runs on every authenticated route — acquires a dedicated
//	  connection and sets app.current_org_id / app.bypass_rls for the request.
//
//	  Org admin (/api/v1/org):
//	    GET    /users
//	    PATCH  /users/{userID}
//	    GET    /invitations
//	    POST   /invitations
//	    DELETE /invitations/{invitationID}
//	    POST   /invitations/{invitationID}/resend
//	    GET    /sso                                 — get SSO config
//	    PUT    /sso                                 — create/replace SSO config
//	    DELETE /sso                                 — remove SSO config
//
//	  Platform admin (/api/v1/admin):
//	    GET   /orgs
//	    POST  /orgs                                 — super_admin only
//	    PATCH /orgs/{orgID}                         — super_admin only
//	    POST  /org-invitations                      — super_admin only
//
//	  Plans (/api/v1/plans):
//	    GET    /
//	    POST   /                                    — planner+
//	    GET    /{planID}
//	    PUT    /{planID}                            — planner+
//	    DELETE /{planID}                            — org_admin only
//	    GET    /{planID}/activities
//	    POST   /{planID}/activities                 — planner+
//	    GET    /{planID}/progress
//	    GET    /{planID}/links                      — NEW: all links for a plan
//	    GET    /{planID}/auto-links                 — NEW: suggested candidate links
//	    POST   /{planID}/viewers                    — org_admin only
//	    DELETE /{planID}/viewers/{userID}           — org_admin only
//	    GET    /{planID}/milestones
//	    POST   /{planID}/milestones                 — planner+
//	    POST   /{planID}/reports                    — planner+ [501]
//
//	  Activities (/api/v1/activities/{activityID}):
//	    PUT  /                                      — planner+ or assigned contributor
//	    POST /links                                 — planner+
//	    GET  /links                                 — NEW: links for this activity
//
//	  Milestones (/api/v1/milestones/{milestoneID}):
//	    PUT    /                                    — planner+
//	    DELETE /                                    — org_admin only
//
//	  AI (/api/v1/ai):
//	    POST /draft                                 — planner+ [501]
//	    POST /summary                              — planner+ [501]
//
//	  Reports:
//	    GET /api/v1/reports/{jobID}                 [501]
package handlers

import (
	"net/http"

	"spe-light/internal/config"
	"spe-light/internal/middleware"
	"spe-light/internal/models"
	"spe-light/internal/response"
	adminsvc "spe-light/internal/services/admin"
	authsvc "spe-light/internal/services/auth"
	milestonesvc "spe-light/internal/services/milestone"
	orgsvc "spe-light/internal/services/org"
	plansvc "spe-light/internal/services/plan"
	ssosvc "spe-light/internal/services/sso"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewRouter builds and returns the fully configured HTTP handler tree.
func NewRouter(cfg *config.Config, db *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()

	// ── Global middleware ─────────────────────────────────────────────
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.CleanPath)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", cfg.AppURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// ── Service construction ──────────────────────────────────────────
	emailSvc, _ := newEmailService(cfg)
	authService := authsvc.New(db, cfg, emailSvc)
	orgService := orgsvc.New(db, cfg, emailSvc)
	adminService := adminsvc.New(db, cfg, emailSvc)
	planService := plansvc.New(db, cfg)
	milestoneService := milestonesvc.New(db)
	ssoService := ssosvc.New(db) // Sprint A

	// ── Handler construction ──────────────────────────────────────────
	authH := NewAuth(authService)
	orgH := NewOrg(orgService)
	adminH := NewAdmin(adminService)
	planH := NewPlan(planService)
	milestoneH := NewMilestone(milestoneService)
	ssoH := NewSSO(ssoService) // Sprint A

	// ── Public routes ─────────────────────────────────────────────────
	r.Get("/health", Health)

	r.Route("/auth", func(r chi.Router) {
		r.With(middleware.RateLimit).Post("/login", authH.Login)
		r.Post("/refresh", authH.Refresh)
		r.Post("/logout", authH.Logout)
		r.Post("/password-reset/request", authH.RequestPasswordReset)
		r.Post("/password-reset/confirm", authH.ConfirmPasswordReset)

		// SSO flows — public because the IdP posts/redirects here directly.
		// Role: none (these create or continue an auth session).
		// Sprint A: stub 501 until crewjam/saml + coreos/go-oidc are vendored.
		r.Get("/saml/{orgSlug}/metadata", notImplemented)
		r.Post("/saml/{orgSlug}/acs", notImplemented)
		r.Get("/oidc/{orgSlug}/login", notImplemented)
		r.Get("/oidc/{orgSlug}/callback", notImplemented)
	})

	r.Post("/invitations/accept", authH.AcceptInvitation)

	// ── Authenticated routes ──────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(middleware.Authenticate(cfg.JWTSecret))
		// RLS: acquires a dedicated connection and sets app.current_org_id
		// so PostgreSQL row-level security policies fire for every request.
		r.Use(middleware.WithRLS(db))

		// ── Org admin ──────────────────────────────────────────────
		r.Route("/api/v1/org", func(r chi.Router) {
			r.Use(middleware.RequireRole(models.RoleOrgAdmin))
			r.Get("/users", orgH.ListUsers)
			r.Patch("/users/{userID}", orgH.UpdateUser)
			r.Get("/invitations", orgH.ListInvitations)
			r.Post("/invitations", orgH.SendInvitation)
			r.Delete("/invitations/{invitationID}", orgH.CancelInvitation)
			r.Post("/invitations/{invitationID}/resend", orgH.ResendInvitation)

			// SSO config management (Sprint A).
			r.Get("/sso", ssoH.GetConfig)
			r.Put("/sso", ssoH.UpsertConfig)
			r.Delete("/sso", ssoH.DeleteConfig)
		})

		// ── Platform admin ─────────────────────────────────────────
		r.Route("/api/v1/admin", func(r chi.Router) {
			r.Use(middleware.RequireRole(models.RoleSuperAdmin, models.RolePlatformSupport))
			r.Get("/orgs", adminH.ListOrgs)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/orgs", adminH.CreateOrg)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Patch("/orgs/{orgID}", adminH.UpdateOrg)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/org-invitations", adminH.SendOrgInvitation)
		})

		// ── Plans ──────────────────────────────────────────────────
		r.Route("/api/v1/plans", func(r chi.Router) {
			r.Get("/", planH.ListPlans)
			r.Get("/{planID}", planH.GetPlan)
			r.Get("/{planID}/progress", planH.GetProgress)
			r.Get("/{planID}/activities", planH.ListActivities)

			// NEW Sprint A: link graph endpoints.
			r.Get("/{planID}/links", planH.ListPlanLinks)
			r.Get("/{planID}/auto-links", planH.ListAutoLinks)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/", planH.CreatePlan)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/{planID}", planH.UpdatePlan)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin,
			)).Delete("/{planID}", planH.DeletePlan)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/activities", planH.CreateActivity)

			// Plan-scoped viewer management (Sprint B).
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin,
			)).Post("/{planID}/viewers", planH.GrantPlanViewer)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin,
			)).Delete("/{planID}/viewers/{userID}", planH.RevokePlanViewer)

			// Milestones (Sprint B).
			r.Get("/{planID}/milestones", milestoneH.ListMilestones)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/milestones", milestoneH.CreateMilestone)

			// Report generation — Sprint D.
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/reports", notImplemented)
		})

		// ── Activities ─────────────────────────────────────────────
		r.Route("/api/v1/activities/{activityID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner, models.RoleContributor,
			)).Put("/", planH.UpdateActivity)

			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/links", planH.CreateActivityLink)

			// NEW Sprint A: list links for a specific activity.
			r.Get("/links", planH.ListActivityLinks)
		})

		// ── Milestones ─────────────────────────────────────────────
		r.Route("/api/v1/milestones/{milestoneID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", milestoneH.UpdateMilestone)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin,
			)).Delete("/", milestoneH.DeleteMilestone)
		})

		// ── AI (Sprint C) ───────────────────────────────────────────
		r.Route("/api/v1/ai", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/draft", notImplemented)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/summary", notImplemented)
		})

		// ── Reports (Sprint D) ─────────────────────────────────────
		r.Get("/api/v1/reports/{jobID}", notImplemented)
	})

	return r
}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	response.ErrorJSON(w, "not yet implemented", http.StatusNotImplemented)
}
