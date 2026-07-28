// strategic_pillars.go — HTTP handlers for Strategic Pillars and Strategic
// Objectives (KPAs), the local-plan (Eswatini standard) equivalent of
// phases. These are methods on the existing Plan handler struct, matching
// the pattern set by links.go and plan_viewer.go.
//
// Routes wired in router.go:
//
//	GET    /api/v1/plans/{planID}/pillars                — list pillars for a plan
//	POST   /api/v1/plans/{planID}/pillars                — create a pillar
//	PUT    /api/v1/pillars/{pillarID}                     — rename/reorder a pillar
//	DELETE /api/v1/pillars/{pillarID}                     — delete a pillar (must be empty)
//
//	GET    /api/v1/plans/{planID}/objectives              — list all objectives for a plan
//	POST   /api/v1/pillars/{pillarID}/objectives          — create an objective under a pillar
//	PUT    /api/v1/objectives/{objectiveID}                — rename/reorder an objective
//	DELETE /api/v1/objectives/{objectiveID}                — delete an objective (must be empty)
package handlers

import (
	"net/http"

	"spe-light/internal/response"
	plansvc "spe-light/internal/services/plan"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ── Pillars ───────────────────────────────────────────────────────────────

// GET /api/v1/plans/{planID}/pillars
func (h *Plan) ListPillars(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	pillars, err := h.svc.ListPillars(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, pillars)
}

// POST /api/v1/plans/{planID}/pillars
func (h *Plan) CreatePillar(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreatePillarRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	pillar, err := h.svc.CreatePillar(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, pillar)
}

// PUT /api/v1/pillars/{pillarID}
func (h *Plan) UpdatePillar(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	pillarID, err := uuid.Parse(chi.URLParam(r, "pillarID"))
	if err != nil {
		response.ErrorJSON(w, "invalid pillar id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdatePillarRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	pillar, err := h.svc.UpdatePillar(r.Context(), pillarID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, pillar)
}

// DELETE /api/v1/pillars/{pillarID}
func (h *Plan) DeletePillar(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	pillarID, err := uuid.Parse(chi.URLParam(r, "pillarID"))
	if err != nil {
		response.ErrorJSON(w, "invalid pillar id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeletePillar(r.Context(), pillarID, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "pillar deleted"})
}

// ── Objectives ────────────────────────────────────────────────────────────

// GET /api/v1/plans/{planID}/objectives
func (h *Plan) ListObjectives(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	objectives, err := h.svc.ListObjectives(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, objectives)
}

// POST /api/v1/pillars/{pillarID}/objectives
func (h *Plan) CreateObjective(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	pillarID, err := uuid.Parse(chi.URLParam(r, "pillarID"))
	if err != nil {
		response.ErrorJSON(w, "invalid pillar id", http.StatusBadRequest)
		return
	}
	var req plansvc.CreateObjectiveRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	objective, err := h.svc.CreateObjective(r.Context(), pillarID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, objective)
}

// PUT /api/v1/objectives/{objectiveID}
func (h *Plan) UpdateObjective(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	objectiveID, err := uuid.Parse(chi.URLParam(r, "objectiveID"))
	if err != nil {
		response.ErrorJSON(w, "invalid objective id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdateObjectiveRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	objective, err := h.svc.UpdateObjective(r.Context(), objectiveID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, objective)
}

// DELETE /api/v1/objectives/{objectiveID}
func (h *Plan) DeleteObjective(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	objectiveID, err := uuid.Parse(chi.URLParam(r, "objectiveID"))
	if err != nil {
		response.ErrorJSON(w, "invalid objective id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteObjective(r.Context(), objectiveID, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "objective deleted"})
}
