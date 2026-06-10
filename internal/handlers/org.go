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
	user, err := h.svc.UpdateUser(r.Context(), userID, *claims.OrgID, req)
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

	// Fetch org name and inviter name for the email
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
