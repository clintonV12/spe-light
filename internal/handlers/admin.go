// Package handlers contains all HTTP handler types for StratPlan.
// This file implements the platform admin console handlers (Sprint 1).
//
// Routes (all require super_admin or platform_support, mutations super_admin only):
//
//	GET  /api/v1/admin/orgs               — list all organisations
//	POST /api/v1/admin/orgs               — create an organisation directly (super_admin)
//	PATCH /api/v1/admin/orgs/{orgID}      — update an organisation (super_admin)
//	POST /api/v1/admin/org-invitations    — invite a new org admin (super_admin)
package handlers

import (
	"net/http"
	"strconv"

	"spe-light/internal/middleware"
	"spe-light/internal/response"
	adminsvc "spe-light/internal/services/admin"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Admin groups all platform-admin HTTP handlers.
type Admin struct {
	svc *adminsvc.Service
}

// NewAdmin creates an Admin handler group.
func NewAdmin(svc *adminsvc.Service) *Admin {
	return &Admin{svc: svc}
}

// GET /api/v1/admin/orgs
// Query params: active_only=true, limit=50, offset=0
func (h *Admin) ListOrgs(w http.ResponseWriter, r *http.Request) {
	req := adminsvc.ListOrgsRequest{
		ActiveOnly: r.URL.Query().Get("active_only") == "true",
		Limit:      parseIntQuery(r, "limit", 50),
		Offset:     parseIntQuery(r, "offset", 0),
	}
	orgs, err := h.svc.ListOrgs(r.Context(), req)
	if err != nil {
		response.ErrorJSON(w, "failed to list organisations", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, orgs)
}

// POST /api/v1/admin/orgs
func (h *Admin) CreateOrg(w http.ResponseWriter, r *http.Request) {
	var req adminsvc.CreateOrgRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	org, err := h.svc.CreateOrg(r.Context(), req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, org)
}

// PATCH /api/v1/admin/orgs/{orgID}
func (h *Admin) UpdateOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgID"))
	if err != nil {
		response.ErrorJSON(w, "invalid org id", http.StatusBadRequest)
		return
	}
	var req adminsvc.UpdateOrgRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	org, err := h.svc.UpdateOrg(r.Context(), orgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, org)
}

// POST /api/v1/admin/org-invitations
func (h *Admin) SendOrgInvitation(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())

	var body struct {
		Email   string `json:"email"`
		OrgName string `json:"org_name"`
	}
	if !response.DecodeJSON(w, r, &body) {
		return
	}
	if body.Email == "" || body.OrgName == "" {
		response.ErrorJSON(w, "email and org_name are required", http.StatusBadRequest)
		return
	}

	inv, err := h.svc.SendOrgInvite(r.Context(), adminsvc.SendOrgInviteRequest{
		Email:       body.Email,
		OrgName:     body.OrgName,
		InviterID:   claims.UserID,
		InviterName: claims.Email, // best effort; name lookup not critical here
	})
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, inv)
}

// parseIntQuery reads an integer query parameter with a fallback default.
func parseIntQuery(r *http.Request, key string, defaultVal int) int {
	s := r.URL.Query().Get(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return defaultVal
	}
	return v
}
