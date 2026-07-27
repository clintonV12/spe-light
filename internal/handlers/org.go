package handlers

import (
	"net/http"

	"spe-light/internal/middleware"
	"spe-light/internal/models"
	"spe-light/internal/response"
	orgsvc "spe-light/internal/services/org"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Org struct {
	svc *orgsvc.Service
}

func NewOrg(svc *orgsvc.Service) *Org {
	return &Org{svc: svc}
}

// GET /api/v1/org/me
// Returns the currently authenticated user's profile.
// Available to every authenticated org user — no role gate.
// Required by LoginPage.tsx (real mode) after exchanging tokens.
func (h *Org) GetMe(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil {
		response.ErrorJSON(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	user, err := h.svc.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		response.ErrorJSON(w, "user not found", http.StatusNotFound)
		return
	}
	response.JSON(w, http.StatusOK, user)
}

// GET /api/v1/org
// Returns the organisation the caller belongs to.
// Available to every authenticated org user — no role gate.
// Required by LoginPage.tsx (real mode) after exchanging tokens.
func (h *Org) GetOrg(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil || claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	org, err := h.svc.GetOrgByID(r.Context(), *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, "organisation not found", http.StatusNotFound)
		return
	}
	response.JSON(w, http.StatusOK, org)
}

// PATCH /api/v1/org
// Lets an org_admin fill in / edit descriptive profile info about their own
// organisation (address, country, contact info, industry, org structure,
// total member count). This is distinct from PATCH /api/v1/admin/orgs/{id},
// which is platform-admin-only and covers name/is_active. The profile info
// captured here is folded into AI draft/summary/suggest-links prompts (see
// aisvc's use of orgsvc-backed context in context.go) so results are grounded
// in what the organisation actually is, not just the plan text.
// Requires org_admin.
func (h *Org) UpdateOrgProfile(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil || claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	var req orgsvc.UpdateOrgProfileRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	org, err := h.svc.UpdateOrgProfile(r.Context(), *claims.OrgID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, org)
}

// GET /api/v1/org/audit-log
// Returns a paginated list of audit log entries for the caller's org.
// Requires org_admin.
//
// Query params:
//
//	user_id    — filter by actor
//	action     — filter by action string (e.g. "plan.created")
//	table_name — filter by affected table
//	from       — ISO-8601 timestamp lower bound
//	to         — ISO-8601 timestamp upper bound
//	limit      — default 50, max 200
//	offset     — default 0
func (h *Org) ListAuditLog(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil || claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}

	params := orgsvc.AuditLogParams{
		OrgID:     *claims.OrgID,
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

// GET /api/v1/org/users
func (h *Org) ListUsers(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	users, err := h.svc.ListUsers(r.Context(), *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, "failed to list users", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, users)
}

// PATCH /api/v1/org/users/{userID}
func (h *Org) UpdateUser(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		response.ErrorJSON(w, "invalid user id", http.StatusBadRequest)
		return
	}
	var req orgsvc.UpdateUserRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	user, err := h.svc.UpdateUser(r.Context(), userID, *claims.OrgID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, user)
}

// GET /api/v1/org/invitations
func (h *Org) ListInvitations(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	invites, err := h.svc.ListInvitations(r.Context(), *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, "failed to list invitations", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, invites)
}

// POST /api/v1/org/invitations
func (h *Org) SendInvitation(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}

	var body struct {
		Email   string      `json:"email"`
		Role    models.Role `json:"role"`
		PlanIDs []uuid.UUID `json:"plan_ids,omitempty"`
	}
	if !response.DecodeJSON(w, r, &body) {
		return
	}
	if body.Email == "" {
		response.ErrorJSON(w, "email is required", http.StatusBadRequest)
		return
	}
	if body.Role == "" {
		response.ErrorJSON(w, "role is required", http.StatusBadRequest)
		return
	}

	orgName, inviterName := h.svc.GetOrgAndUserNames(r.Context(), *claims.OrgID, claims.UserID)

	inv, err := h.svc.SendUserInvite(r.Context(), orgsvc.SendInviteRequest{
		Email:       body.Email,
		Role:        body.Role,
		PlanIDs:     body.PlanIDs,
		InviterID:   claims.UserID,
		OrgID:       *claims.OrgID,
		OrgName:     orgName,
		InviterName: inviterName,
	})
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, inv)
}

// DELETE /api/v1/org/invitations/{invitationID}
func (h *Org) CancelInvitation(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	invID, err := uuid.Parse(chi.URLParam(r, "invitationID"))
	if err != nil {
		response.ErrorJSON(w, "invalid invitation id", http.StatusBadRequest)
		return
	}
	if err := h.svc.CancelInvitation(r.Context(), invID, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "invitation cancelled"})
}

// POST /api/v1/org/invitations/{invitationID}/resend
func (h *Org) ResendInvitation(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	invID, err := uuid.Parse(chi.URLParam(r, "invitationID"))
	if err != nil {
		response.ErrorJSON(w, "invalid invitation id", http.StatusBadRequest)
		return
	}
	orgName, inviterName := h.svc.GetOrgAndUserNames(r.Context(), *claims.OrgID, claims.UserID)
	if err := h.svc.ResendInvitation(r.Context(), invID, *claims.OrgID, orgName, inviterName); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "invitation resent"})
}
