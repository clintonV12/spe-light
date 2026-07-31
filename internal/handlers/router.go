// Package handlers wires together all HTTP routes and their middleware for
// StratPlan. This is the single entry point for the HTTP layer.
//
// Changes from Sprint A:
//   - SSOAuth handler constructed and injected (replaces notImplemented stubs
//     on all four /auth/saml/* and /auth/oidc/* routes).
//   - ssosvc.NewAuth wired into service construction.
//
// Full route layout — see Sprint A router.go header for the complete table.
// Only the SSO auth routes are new; everything else is unchanged, except
// invitation acceptance, which moved from bare /invitations/accept to
// /api/v1/invitations/accept to stop colliding with the SPA's own
// /invitations/accept page route (see realEndpoints.ts).
package handlers

import (
	"context"
	"fmt"
	"net/http"

	"spe-light/internal/config"
	"spe-light/internal/middleware"
	"spe-light/internal/models"
	"spe-light/internal/response"
	adminsvc "spe-light/internal/services/admin"
	aisvc "spe-light/internal/services/ai"
	authsvc "spe-light/internal/services/auth"
	milestonesvc "spe-light/internal/services/milestone"
	orgsvc "spe-light/internal/services/org"
	plansvc "spe-light/internal/services/plan"
	reportsvc "spe-light/internal/services/report"
	ssosvc "spe-light/internal/services/sso"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewRouter builds and returns the fully configured HTTP handler tree.
//
// Returns an error if any service fails to construct — most notably the
// email service, whose template parsing can fail. Previously that error was
// discarded by the caller, so a bad template would boot the server fine and
// then panic with a nil-pointer dereference on the first email send. Now it
// fails fast at startup instead.
func NewRouter(cfg *config.Config, db *pgxpool.Pool) (http.Handler, error) {
	r := chi.NewRouter()

	// ── Global middleware ─────────────────────────────────────────────
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.CleanPath)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.FrontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// ── Service construction ──────────────────────────────────────────
	// db is threaded into the email service so send() can persist delivery
	// outcomes to notification_log — previously a failed/successful send was
	// only ever slog'd, with no durable, queryable record of it.
	emailSvc, err := newEmailService(cfg, db)
	if err != nil {
		return nil, fmt.Errorf("init email service: %w", err)
	}
	authService := authsvc.New(db, cfg, emailSvc)
	orgService := orgsvc.New(db, cfg, emailSvc)
	adminService := adminsvc.New(db, cfg, emailSvc)
	planService := plansvc.New(db, cfg)
	milestoneService := milestonesvc.New(db)
	aiService := aisvc.New(db, cfg) // Sprint C — Ollama-backed AI draft/summary
	// reportService's AI-summary section calls back into aiService through a
	// small adapter closure (rather than reportsvc importing aisvc directly)
	// so the report package doesn't need to know aisvc's request/response
	// shapes. A failed/unreachable AI service degrades to a placeholder note
	// in the report rather than failing report generation outright.
	//
	// orgService is also threaded in (new) so generated reports can carry a
	// proper letterhead — organisation name/industry and the generating
	// user's display name — see render.go's reportMeta.
	reportService := reportsvc.New(db, planService, milestoneService, orgService,
		func(ctx context.Context, orgID, planID uuid.UUID) (string, error) {
			resp, err := aiService.Summary(ctx, orgID, aisvc.SummaryRequest{PlanID: planID})
			if err != nil {
				return "", err
			}
			return resp.Summary, nil
		},
	)
	ssoConfigService := ssosvc.New(db)
	ssoAuthService := ssosvc.NewAuth(db, cfg, ssoConfigService) // Sprint A SSO flows

	// ── Handler construction ──────────────────────────────────────────
	authH := NewAuth(authService)
	orgH := NewOrg(orgService)
	adminH := NewAdmin(adminService)
	planH := NewPlan(planService)
	milestoneH := NewMilestone(milestoneService)
	aiH := NewAI(aiService)
	reportsH := NewReports(reportService)
	ssoH := NewSSO(ssoConfigService)
	ssoAuthH := NewSSOAuth(ssoAuthService, cfg.FrontendURL, cfg.JWTSecret) // Sprint A SSO flows

	// ── Public routes ─────────────────────────────────────────────────
	r.Get("/health", Health)

	r.Route("/auth", func(r chi.Router) {
		r.With(middleware.RateLimit).Post("/login", authH.Login)
		r.Post("/refresh", authH.Refresh)
		r.Post("/logout", authH.Logout)
		r.Post("/password-reset/request", authH.RequestPasswordReset)
		r.Post("/password-reset/confirm", authH.ConfirmPasswordReset)

		// ── SAML SSO flows ─────────────────────────────────────────
		// GET: serves SP metadata XML to the org admin for IdP configuration.
		// POST: receives the IdP assertion post-back (ACS endpoint).
		r.Get("/saml/{orgSlug}/metadata", ssoAuthH.SAMLMetadata)
		r.Post("/saml/{orgSlug}/acs", ssoAuthH.SAMLAssertionConsumer)

		// ── OIDC SSO flows ─────────────────────────────────────────
		// GET login: redirects browser to the IdP with a PKCE challenge.
		// GET callback: receives the authorization code; exchanges + verifies.
		r.Get("/oidc/{orgSlug}/login", ssoAuthH.OIDCLogin)
		r.Get("/oidc/{orgSlug}/callback", ssoAuthH.OIDCCallback)
	})

	// Namespaced under /api/v1 (rather than bare /invitations/accept) so this
	// never collides with the SPA's own /invitations/accept page route. Public
	// endpoint — no auth middleware — the invitee doesn't have a token yet.
	r.Route("/api/v1/invitations", func(r chi.Router) {
		r.Post("/accept", authH.AcceptInvitation)
	})

	// ── Authenticated routes ──────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(middleware.Authenticate(cfg.JWTSecret))
		r.Use(middleware.WithRLS(db))

		// ── Org ────────────────────────────────────────────────────
		r.Route("/api/v1/org", func(r chi.Router) {
			// No role gate — every authenticated org user (including
			// viewers) can read their own profile and their own org's
			// public details. Required by LoginPage.tsx (real mode).
			r.Get("/me", orgH.GetMe)
			r.Get("/", orgH.GetOrg)

			// Org admin only.
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRole(models.RoleOrgAdmin))
				r.Patch("/", orgH.UpdateOrgProfile)
				r.Get("/users", orgH.ListUsers)
				r.Patch("/users/{userID}", orgH.UpdateUser)
				r.Get("/invitations", orgH.ListInvitations)
				r.Post("/invitations", orgH.SendInvitation)
				r.Delete("/invitations/{invitationID}", orgH.CancelInvitation)
				r.Post("/invitations/{invitationID}/resend", orgH.ResendInvitation)
				r.Get("/sso", ssoH.GetConfig)
				r.Put("/sso", ssoH.UpsertConfig)
				r.Delete("/sso", ssoH.DeleteConfig)
				r.Get("/audit-log", orgH.ListAuditLog)
			})
		})

		// ── Platform admin ─────────────────────────────────────────
		r.Route("/api/v1/admin", func(r chi.Router) {
			r.Use(middleware.RequireRole(models.RoleSuperAdmin, models.RolePlatformSupport))
			r.Get("/stats", adminH.GetStats)
			r.Get("/orgs", adminH.ListOrgs)
			r.Get("/orgs/{orgID}", adminH.GetOrgDetail)
			r.Get("/audit-log", adminH.ListAuditLog)
			r.Get("/platform-users", adminH.ListPlatformUsers)
			r.Get("/platform-users/invitations", adminH.ListPlatformInvitations)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/orgs", adminH.CreateOrg)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Patch("/orgs/{orgID}", adminH.UpdateOrg)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Delete("/orgs/{orgID}", adminH.DeleteOrg)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/org-invitations", adminH.SendOrgInvitation)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/platform-users/invitations", adminH.InvitePlatformUser)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Delete("/platform-users/invitations/{invitationID}", adminH.CancelPlatformInvitation)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/platform-users/invitations/{invitationID}/resend", adminH.ResendPlatformInvitation)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Patch("/platform-users/{userID}", adminH.UpdatePlatformUser)
		})

		// ── Plans ──────────────────────────────────────────────────
		r.Route("/api/v1/plans", func(r chi.Router) {
			r.Get("/", planH.ListPlans)
			r.Get("/{planID}", planH.GetPlan)
			r.Get("/{planID}/progress", planH.GetProgress)
			r.Get("/{planID}/activities", planH.ListActivities)
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
			)).Post("/{planID}/duplicate", planH.DuplicatePlan)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/activities", planH.CreateActivity)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin,
			)).Post("/{planID}/viewers", planH.GrantPlanViewer)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin,
			)).Delete("/{planID}/viewers/{userID}", planH.RevokePlanViewer)
			// ── Strategic pillars / objectives (local plans) ────────
			r.Get("/{planID}/pillars", planH.ListPillars)
			r.Get("/{planID}/objectives", planH.ListObjectives)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/pillars", planH.CreatePillar)

			r.Get("/{planID}/milestones", milestoneH.ListMilestones)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/milestones", milestoneH.CreateMilestone)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/reports", reportsH.Generate)
			r.Get("/{planID}/reports", reportsH.History)

			// ── Local-plan chapter 2: Strategic Focus
			r.Get("/{planID}/core-values", planH.ListCoreValues)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/{planID}/strategic-focus", planH.UpdateStrategicFocus)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/core-values", planH.CreateCoreValue)

			// ── Local-plan chapter 3: Situational Analysis ──────────────
			r.Get("/{planID}/stakeholders", planH.ListStakeholders)
			r.Get("/{planID}/swot-items", planH.ListSWOTItems)
			r.Get("/{planID}/pestel-items", planH.ListPESTELItems)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/stakeholders", planH.CreateStakeholder)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/swot-items", planH.CreateSWOTItem)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/pestel-items", planH.CreatePESTELItem)

			// ── Local-plan chapter 6: Organisational Structure ──────────
			r.Get("/{planID}/org-structure-roles", planH.ListOrgStructureRoles)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/org-structure-roles", planH.CreateOrgStructureRole)

			// ── Local-plan chapter 7: Monitoring & Evaluation ───────────
			r.Get("/{planID}/me-items", planH.ListMEItems)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/{planID}/me-items", planH.CreateMEItem)

		})

		// ── Activities ─────────────────────────────────────────────
		r.Route("/api/v1/activities/{activityID}", func(r chi.Router) {
			r.Get("/", planH.GetActivity)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner, models.RoleContributor,
			)).Put("/", planH.UpdateActivity)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeleteActivity)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/links", planH.CreateActivityLink)
			r.Get("/links", planH.ListActivityLinks)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/links/{linkID}", planH.DeleteActivityLink)
		})

		// ── Strategic pillars / objectives (local plans) ────────────
		r.Route("/api/v1/pillars/{pillarID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdatePillar)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeletePillar)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/objectives", planH.CreateObjective)
		})
		r.Route("/api/v1/objectives/{objectiveID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdateObjective)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeleteObjective)
		})

		r.Route("/api/v1/core-values/{coreValueID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdateCoreValue)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeleteCoreValue)
		})
		r.Route("/api/v1/stakeholders/{stakeholderID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdateStakeholder)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeleteStakeholder)
		})
		r.Route("/api/v1/swot-items/{swotItemID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdateSWOTItem)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeleteSWOTItem)
		})
		r.Route("/api/v1/pestel-items/{pestelItemID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdatePESTELItem)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeletePESTELItem)
		})
		r.Route("/api/v1/org-structure-roles/{roleID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdateOrgStructureRole)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeleteOrgStructureRole)
		})
		r.Route("/api/v1/me-items/{meItemID}", func(r chi.Router) {
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Put("/", planH.UpdateMEItem)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Delete("/", planH.DeleteMEItem)
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
			)).Post("/draft", aiH.Draft)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/summary", aiH.Summary)
			r.With(middleware.RequireRole(
				models.RoleOrgAdmin, models.RolePlanner,
			)).Post("/suggest-links", aiH.SuggestLinks)
		})

		// ── Reports (Sprint D) ─────────────────────────────────────
		r.Get("/api/v1/reports/{jobID}", reportsH.Poll)
		r.Get("/api/v1/reports/{jobID}/download", reportsH.Download)
	})

	return r, nil
}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	response.ErrorJSON(w, "not yet implemented", http.StatusNotImplemented)
}
