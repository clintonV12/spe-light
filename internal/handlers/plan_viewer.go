// plan_viewer.go — plan-scoped viewer HTTP handlers (gap 2.3, part B).
//
// These are additional methods on the existing Plan handler struct so they
// can reuse mustOrgClaims and parsePlanID without duplication. The plan
// service methods they call (GrantPlanViewer, RevokePlanViewer) are defined
// in internal/services/plan/plan_viewer.go.
//
// Routes wired in router.go (org_admin only):
//
//	POST   /api/v1/plans/{planID}/viewers            — grant viewer access to a user
//	DELETE /api/v1/plans/{planID}/viewers/{userID}   — revoke viewer access
package handlers

import (
	"net/http"

	"spe-light/internal/response"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// POST /api/v1/plans/{planID}/viewers
// Body: { "user_id": "<uuid>" }
//
// Grants plan-scoped viewer access to an existing org user. The user must
// already exist in this org — use the invite flow for new users. The
// operation is idempotent; granting access to a user who already has it
// does nothing and returns 201.
func (h *Plan) GrantPlanViewer(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var body struct {
		UserID uuid.UUID `json:"user_id"`
	}
	if !response.DecodeJSON(w, r, &body) {
		return
	}
	if body.UserID == uuid.Nil {
		response.ErrorJSON(w, "user_id is required", http.StatusBadRequest)
		return
	}
	if err := h.svc.GrantPlanViewer(r.Context(), planID, body.UserID, claims.UserID, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, map[string]string{"message": "viewer access granted"})
}

// DELETE /api/v1/plans/{planID}/viewers/{userID}
//
// Revokes plan-scoped viewer access for a specific user. Returns 400 if
// the user does not currently have viewer access on this plan.
func (h *Plan) RevokePlanViewer(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		response.ErrorJSON(w, "invalid user id", http.StatusBadRequest)
		return
	}
	if err := h.svc.RevokePlanViewer(r.Context(), planID, userID, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "viewer access revoked"})
}
