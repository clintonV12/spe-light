// milestone.go — milestone HTTP handlers (gap 2.4).
//
// These handlers are methods on a dedicated Milestone struct (parallel to the
// existing Plan, Org, Admin structs) and use the same mustOrgClaims /
// parsePlanID helpers defined in plan.go since they live in the same package.
//
// Routes wired in router.go:
//
//	GET    /api/v1/plans/{planID}/milestones            — all org roles
//	POST   /api/v1/plans/{planID}/milestones            — planner+
//	PUT    /api/v1/milestones/{milestoneID}             — planner+
//	DELETE /api/v1/milestones/{milestoneID}             — org_admin only
package handlers

import (
	"net/http"

	"spe-light/internal/models"
	"spe-light/internal/response"
	milestonesvc "spe-light/internal/services/milestone"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Milestone groups all milestone HTTP handlers.
type Milestone struct {
	svc *milestonesvc.Service
}

// NewMilestone creates a Milestone handler group.
func NewMilestone(svc *milestonesvc.Service) *Milestone {
	return &Milestone{svc: svc}
}

// GET /api/v1/plans/{planID}/milestones
func (h *Milestone) ListMilestones(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	milestones, err := h.svc.ListMilestones(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	if milestones == nil {
		milestones = []models.Milestone{}
	}
	response.JSON(w, http.StatusOK, milestones)
}

// POST /api/v1/plans/{planID}/milestones
func (h *Milestone) CreateMilestone(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req milestonesvc.CreateMilestoneRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	m, err := h.svc.CreateMilestone(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, m)
}

// PUT /api/v1/milestones/{milestoneID}
func (h *Milestone) UpdateMilestone(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	milestoneID, err := uuid.Parse(chi.URLParam(r, "milestoneID"))
	if err != nil {
		response.ErrorJSON(w, "invalid milestone id", http.StatusBadRequest)
		return
	}
	var req milestonesvc.UpdateMilestoneRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	m, err := h.svc.UpdateMilestone(r.Context(), milestoneID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, m)
}

// DELETE /api/v1/milestones/{milestoneID}
func (h *Milestone) DeleteMilestone(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	milestoneID, err := uuid.Parse(chi.URLParam(r, "milestoneID"))
	if err != nil {
		response.ErrorJSON(w, "invalid milestone id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteMilestone(r.Context(), milestoneID, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "milestone deleted"})
}
