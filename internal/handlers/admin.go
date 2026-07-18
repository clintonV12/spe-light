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
	"spe-light/internal/models"
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
// Body may optionally include admin_email to invite that org's first admin
// in the same call (see adminsvc.CreateOrg).
func (h *Admin) CreateOrg(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	var req adminsvc.CreateOrgRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	req.InviterID = claims.UserID
	req.InviterName = claims.Email
	org, err := h.svc.CreateOrg(r.Context(), req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, org)
}

// PATCH /api/v1/admin/orgs/{orgID}
func (h *Admin) UpdateOrg(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	orgID, err := uuid.Parse(chi.URLParam(r, "orgID"))
	if err != nil {
		response.ErrorJSON(w, "invalid org id", http.StatusBadRequest)
		return
	}
	var req adminsvc.UpdateOrgRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	org, err := h.svc.UpdateOrg(r.Context(), orgID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, org)
}

// POST /api/v1/admin/org-invitations
// Invites an org_admin for an organisation that already exists — org_id
// must reference a real org (create one first via POST /api/v1/admin/orgs).
func (h *Admin) SendOrgInvitation(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())

	var body struct {
		Email string    `json:"email"`
		OrgID uuid.UUID `json:"org_id"`
	}
	if !response.DecodeJSON(w, r, &body) {
		return
	}
	if body.Email == "" || body.OrgID == uuid.Nil {
		response.ErrorJSON(w, "email and org_id are required", http.StatusBadRequest)
		return
	}

	inv, err := h.svc.InviteOrgAdmin(r.Context(), adminsvc.InviteOrgAdminRequest{
		OrgID:       body.OrgID,
		Email:       body.Email,
		InviterID:   claims.UserID,
		InviterName: claims.Email, // best effort; name lookup not critical here
	})
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, inv)
}

// GET /api/v1/admin/audit-log — super_admin or platform_support.
// Optional org_id query param scopes to one org; omitted = all orgs.
func (h *Admin) ListAuditLog(w http.ResponseWriter, r *http.Request) {
	var orgID *uuid.UUID
	if s := r.URL.Query().Get("org_id"); s != "" {
		if id, err := uuid.Parse(s); err == nil {
			orgID = &id
		}
	}
	params := adminsvc.AuditLogParams{
		OrgID:     orgID,
		UserID:    r.URL.Query().Get("user_id"),
		Action:    r.URL.Query().Get("action"),
		TableName: r.URL.Query().Get("table_name"),
		From:      r.URL.Query().Get("from"),
		To:        r.URL.Query().Get("to"),
		Limit:     parseIntQuery(r, "limit", 50),
		Offset:    parseIntQuery(r, "offset", 0),
	}
	if params.Limit > 200 {
		params.Limit = 200
	}
	result, err := h.svc.ListAuditLog(r.Context(), params)
	if err != nil {
		response.ErrorJSON(w, "failed to fetch audit log", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, result)
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

// POST /api/v1/admin/platform-users/invitations — super_admin only.
func (h *Admin) InvitePlatformUser(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	var body struct {
		Email string      `json:"email"`
		Role  models.Role `json:"role"`
	}
	if !response.DecodeJSON(w, r, &body) {
		return
	}
	inv, err := h.svc.InvitePlatformUser(r.Context(), adminsvc.InvitePlatformUserRequest{
		Email:       body.Email,
		Role:        body.Role,
		InviterID:   claims.UserID,
		InviterName: claims.Email,
	})
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, inv)
}

// GET /api/v1/admin/platform-users — super_admin or platform_support.
func (h *Admin) ListPlatformUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.svc.ListPlatformUsers(r.Context())
	if err != nil {
		response.ErrorJSON(w, "failed to list platform users", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, users)
}

// GET /api/v1/admin/platform-users/invitations — super_admin or platform_support.
func (h *Admin) ListPlatformInvitations(w http.ResponseWriter, r *http.Request) {
	invs, err := h.svc.ListPlatformInvitations(r.Context())
	if err != nil {
		response.ErrorJSON(w, "failed to list platform invitations", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, invs)
}

// DELETE /api/v1/admin/platform-users/invitations/{invitationID} — super_admin only.
func (h *Admin) CancelPlatformInvitation(w http.ResponseWriter, r *http.Request) {
	invID, err := uuid.Parse(chi.URLParam(r, "invitationID"))
	if err != nil {
		response.ErrorJSON(w, "invalid invitation id", http.StatusBadRequest)
		return
	}
	if err := h.svc.CancelPlatformInvitation(r.Context(), invID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "invitation cancelled"})
}

// POST /api/v1/admin/platform-users/invitations/{invitationID}/resend — super_admin only.
func (h *Admin) ResendPlatformInvitation(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	invID, err := uuid.Parse(chi.URLParam(r, "invitationID"))
	if err != nil {
		response.ErrorJSON(w, "invalid invitation id", http.StatusBadRequest)
		return
	}
	if err := h.svc.ResendPlatformInvitation(r.Context(), invID, claims.Email); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "invitation resent"})
}

// PATCH /api/v1/admin/platform-users/{userID} — super_admin only.
func (h *Admin) UpdatePlatformUser(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		response.ErrorJSON(w, "invalid user id", http.StatusBadRequest)
		return
	}
	var req adminsvc.UpdatePlatformUserRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	user, err := h.svc.UpdatePlatformUser(r.Context(), userID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, user)
}
