package handlers

import (
	"net/http"

	"spe-light/internal/config"
	"spe-light/internal/middleware"
	"spe-light/internal/models"
	"spe-light/internal/response"
	authsvc "spe-light/internal/services/auth"
	orgsvc "spe-light/internal/services/org"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

	// ── Services ──────────────────────────────────────────────────────
	emailSvc, _ := newEmailService(cfg)
	authService := authsvc.New(db, cfg, emailSvc)
	orgService := orgsvc.New(db, cfg, emailSvc)

	// ── Handlers ──────────────────────────────────────────────────────
	authH := NewAuth(authService)
	orgH := NewOrg(orgService)

	// ── Public routes ─────────────────────────────────────────────────
	r.Get("/health", Health)

	r.Route("/auth", func(r chi.Router) {
		r.Post("/login", authH.Login)
		r.Post("/refresh", authH.Refresh)
		r.Post("/logout", authH.Logout)
		r.Post("/password-reset/request", authH.RequestPasswordReset)
		r.Post("/password-reset/confirm", authH.ConfirmPasswordReset)
	})

	r.Post("/invitations/accept", authH.AcceptInvitation)

	// ── Authenticated routes ──────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(middleware.Authenticate(cfg.JWTSecret))

		// Org admin — user and invitation management
		r.Route("/api/v1/org", func(r chi.Router) {
			r.Use(middleware.RequireRole(models.RoleOrgAdmin))
			r.Get("/users", orgH.ListUsers)
			r.Patch("/users/{userID}", orgH.UpdateUser)
			r.Get("/invitations", orgH.ListInvitations)
			r.Post("/invitations", orgH.SendInvitation)
			r.Delete("/invitations/{invitationID}", orgH.CancelInvitation)
			r.Post("/invitations/{invitationID}/resend", orgH.ResendInvitation)
		})

		// Super admin / Platform support — platform console
		r.Route("/api/v1/admin", func(r chi.Router) {
			r.Use(middleware.RequireRole(models.RoleSuperAdmin, models.RolePlatformSupport))
			r.Get("/orgs", listOrgsStub)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/orgs", createOrgStub)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Patch("/orgs/{orgID}", updateOrgStub)
			r.With(middleware.RequireRole(models.RoleSuperAdmin)).Post("/org-invitations", sendOrgInvitationStub)
		})

		// Plans, activities, AI, reports — Sprint 3+
		r.Route("/api/v1/plans", func(r chi.Router) {
			r.Get("/", notImplemented)
			r.Post("/", notImplemented)
			r.Get("/{planID}", notImplemented)
			r.Put("/{planID}", notImplemented)
			r.Get("/{planID}/activities", notImplemented)
			r.Post("/{planID}/activities", notImplemented)
			r.Get("/{planID}/progress", notImplemented)
			r.Post("/{planID}/reports", notImplemented)
		})
		r.Route("/api/v1/activities/{activityID}", func(r chi.Router) {
			r.Put("/", notImplemented)
			r.Post("/links", notImplemented)
		})
		r.Route("/api/v1/ai", func(r chi.Router) {
			r.Post("/draft", notImplemented)
			r.Post("/summary", notImplemented)
		})
		r.Get("/api/v1/reports/{jobID}", notImplemented)
	})

	return r
}

// ── Stubs ─────────────────────────────────────────────────────────────────

func notImplemented(w http.ResponseWriter, r *http.Request) {
	response.ErrorJSON(w, "not yet implemented", http.StatusNotImplemented)
}

func listOrgsStub(w http.ResponseWriter, r *http.Request)          { notImplemented(w, r) }
func createOrgStub(w http.ResponseWriter, r *http.Request)         { notImplemented(w, r) }
func updateOrgStub(w http.ResponseWriter, r *http.Request)         { notImplemented(w, r) }
func sendOrgInvitationStub(w http.ResponseWriter, r *http.Request) { notImplemented(w, r) }
