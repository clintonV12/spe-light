// This file implements HTTP handlers for plans and activities (Sprint 2).
//
// Routes:
//
//	GET    /api/v1/plans                            — list plans for caller's org
//	POST   /api/v1/plans                            — create a plan (planner+)
//	GET    /api/v1/plans/{planID}                   — get a single plan
//	PUT    /api/v1/plans/{planID}                   — update a plan (planner+)
//	DELETE /api/v1/plans/{planID}                   — soft-delete a plan (org_admin only)
//	GET    /api/v1/plans/{planID}/activities        — list activities, optional ?phase=P1|P2|P3
//	POST   /api/v1/plans/{planID}/activities        — create activity (planner+)
//	GET    /api/v1/plans/{planID}/progress          — progress metrics
//	PUT    /api/v1/activities/{activityID}          — update activity
//	POST   /api/v1/activities/{activityID}/links    — create activity link
package handlers

import (
	"net/http"

	"spe-light/internal/middleware"
	"spe-light/internal/models"
	"spe-light/internal/response"
	plansvc "spe-light/internal/services/plan"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Plan groups all plan and activity HTTP handlers.
type Plan struct {
	svc *plansvc.Service
}

// NewPlan creates a Plan handler group.
func NewPlan(svc *plansvc.Service) *Plan {
	return &Plan{svc: svc}
}

// ── Plan handlers ─────────────────────────────────────────────────────────

// GET /api/v1/plans
func (h *Plan) ListPlans(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	plans, err := h.svc.ListPlans(r.Context(), *claims.OrgID, claims.UserID, claims.Role)
	if err != nil {
		response.ErrorJSON(w, "failed to list plans", http.StatusInternalServerError)
		return
	}
	// Return empty array rather than null so the frontend doesn't need a nil check.
	if plans == nil {
		plans = []models.Plan{}
	}
	response.JSON(w, http.StatusOK, plans)
}

// POST /api/v1/plans
func (h *Plan) CreatePlan(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	var req plansvc.CreatePlanRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	plan, err := h.svc.CreatePlan(r.Context(), *claims.OrgID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, plan)
}

// GET /api/v1/plans/{planID}
func (h *Plan) GetPlan(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	plan, err := h.svc.GetPlan(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusNotFound)
		return
	}
	response.JSON(w, http.StatusOK, plan)
}

// PUT /api/v1/plans/{planID}
func (h *Plan) UpdatePlan(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.UpdatePlanRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	plan, err := h.svc.UpdatePlan(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, plan)
}

// DELETE /api/v1/plans/{planID}
func (h *Plan) DeletePlan(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeletePlan(r.Context(), planID, *claims.OrgID, claims.UserID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "plan deleted"})
}

// ── Activity handlers ─────────────────────────────────────────────────────

// GET /api/v1/plans/{planID}/activities?phase=P1
func (h *Plan) ListActivities(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}

	// Optional phase filter.
	var phase *models.Phase
	if p := r.URL.Query().Get("phase"); p != "" {
		ph := models.Phase(p)
		if ph != models.PhaseP1 && ph != models.PhaseP2 && ph != models.PhaseP3 {
			response.ErrorJSON(w, "phase must be P1, P2, or P3", http.StatusBadRequest)
			return
		}
		phase = &ph
	}

	activities, err := h.svc.ListActivities(r.Context(), planID, *claims.OrgID, phase)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	if activities == nil {
		activities = []models.Activity{}
	}
	response.JSON(w, http.StatusOK, activities)
}

// POST /api/v1/plans/{planID}/activities
func (h *Plan) CreateActivity(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreateActivityRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	activity, err := h.svc.CreateActivity(r.Context(), planID, *claims.OrgID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, activity)
}

// GET /api/v1/plans/{planID}/progress
func (h *Plan) GetProgress(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	progress, err := h.svc.GetProgress(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, progress)
}

// ── Activity mutation handlers ────────────────────────────────────────────

// PUT /api/v1/activities/{activityID}
// Contributors may only update activities assigned to them.
func (h *Plan) UpdateActivity(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	activityID, err := uuid.Parse(chi.URLParam(r, "activityID"))
	if err != nil {
		response.ErrorJSON(w, "invalid activity id", http.StatusBadRequest)
		return
	}

	var req plansvc.UpdateActivityRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}

	// For contributors, enforce that they are assigned to this activity.
	if claims.Role == models.RoleContributor {
		if !h.svc.IsAssigned(r.Context(), activityID, claims.UserID) {
			response.ErrorJSON(w, "you are not assigned to this activity", http.StatusForbidden)
			return
		}
	}

	activity, err := h.svc.UpdateActivity(r.Context(), activityID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, activity)
}

// POST /api/v1/activities/{activityID}/links
func (h *Plan) CreateActivityLink(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	activityID, err := uuid.Parse(chi.URLParam(r, "activityID"))
	if err != nil {
		response.ErrorJSON(w, "invalid activity id", http.StatusBadRequest)
		return
	}
	var req plansvc.CreateLinkRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	link, err := h.svc.CreateActivityLink(r.Context(), activityID, *claims.OrgID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, link)
}

// ── Shared helpers ────────────────────────────────────────────────────────

// mustOrgClaims extracts JWT claims and validates an org context exists.
// Writes a 403 and returns nil if no OrgID is present (platform-tier users).
func mustOrgClaims(w http.ResponseWriter, r *http.Request) *middleware.Claims {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil || claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return nil
	}
	return claims
}

// parsePlanID extracts and validates {planID} from the URL.
func parsePlanID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "planID"))
	if err != nil {
		response.ErrorJSON(w, "invalid plan id", http.StatusBadRequest)
		return uuid.UUID{}, false
	}
	return id, true
}
