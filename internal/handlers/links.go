// links.go — activity link listing handlers.
//
// Routes:
//
//	GET /api/v1/plans/{planID}/links            — all links for a plan
//	GET /api/v1/activities/{activityID}/links   — links for one activity (source or target)
//	GET /api/v1/plans/{planID}/auto-links       — suggested (not yet created) candidate links
//
// These are methods on the existing Plan handler struct so mustOrgClaims and
// parsePlanID are available without duplication.
package handlers

import (
	"net/http"

	"spe-light/internal/response"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// GET /api/v1/plans/{planID}/links
// Returns all activity links for a plan, ordered by creation time.
func (h *Plan) ListPlanLinks(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	links, err := h.svc.ListLinks(r.Context(), planID, *claims.OrgID, nil)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, links)
}

// GET /api/v1/activities/{activityID}/links
// Returns all links where the given activity is either source or target.
func (h *Plan) ListActivityLinks(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	activityID, err := uuid.Parse(chi.URLParam(r, "activityID"))
	if err != nil {
		response.ErrorJSON(w, "invalid activity id", http.StatusBadRequest)
		return
	}

	// Derive planID from the activity so we can call ListLinks with the right plan context.
	planID, orgID, err := h.svc.GetActivityPlanID(r.Context(), activityID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}

	links, err := h.svc.ListLinks(r.Context(), planID, orgID, &activityID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, links)
}

// GET /api/v1/plans/{planID}/auto-links
// Returns candidate links that the auto-detection engine suggests but which
// don't yet exist. Read-only — nothing is written until the caller POSTs to
// /api/v1/activities/{id}/links with link_type = "auto".
func (h *Plan) ListAutoLinks(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	candidates, err := h.svc.AutoDetectLinks(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, candidates)
}
