// plan.go — HTTP handlers for plans and activities.
//
// All existing handlers are unchanged. Added in this revision:
//
//	GET    /api/v1/activities/{activityID}              — GetActivity (gap 1)
//	DELETE /api/v1/activities/{activityID}              — DeleteActivity (gap 2)
//	DELETE /api/v1/activities/{activityID}/links/{linkID} — DeleteActivityLink (gap 3)
//	POST   /api/v1/plans/{planID}/duplicate             — DuplicatePlan (gap 4)
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

// POST /api/v1/plans/{planID}/duplicate
// Creates a full copy of a plan (including all activities) with status reset
// to "draft". The duplicate is owned by the requesting user.
// Requires planner or org_admin.
func (h *Plan) DuplicatePlan(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	plan, err := h.svc.DuplicatePlan(r.Context(), planID, *claims.OrgID, claims.UserID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, plan)
}

// ── Activity handlers ─────────────────────────────────────────────────────

// GET /api/v1/plans/{planID}/activities?phase=P1&status=in_progress
func (h *Plan) ListActivities(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}

	var phase *models.Phase
	if p := r.URL.Query().Get("phase"); p != "" {
		ph := models.Phase(p)
		if ph != models.PhaseP1 && ph != models.PhaseP2 && ph != models.PhaseP3 {
			response.ErrorJSON(w, "phase must be P1, P2, or P3", http.StatusBadRequest)
			return
		}
		phase = &ph
	}

	// Optional status filter — new in this revision, passed through to the service.
	var status *models.ActivityStatus
	if s := r.URL.Query().Get("status"); s != "" {
		as := models.ActivityStatus(s)
		switch as {
		case models.ActivityNotStarted, models.ActivityInProgress,
			models.ActivityReview, models.ActivityComplete:
			status = &as
		default:
			response.ErrorJSON(w, "invalid status value", http.StatusBadRequest)
			return
		}
	}

	activities, err := h.svc.ListActivities(r.Context(), planID, *claims.OrgID, phase, status)
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

// GET /api/v1/activities/{activityID}
// Fetches a single activity by ID, verifying the caller's org owns it.
// Eliminates the client-side list-and-filter workaround in realEndpoints.ts.
func (h *Plan) GetActivity(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	activityID, err := uuid.Parse(chi.URLParam(r, "activityID"))
	if err != nil {
		response.ErrorJSON(w, "invalid activity id", http.StatusBadRequest)
		return
	}
	activity, err := h.svc.GetActivity(r.Context(), activityID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusNotFound)
		return
	}
	response.JSON(w, http.StatusOK, activity)
}

// PUT /api/v1/activities/{activityID}
// Contributors may only update activities assigned to them (enforced here and
// by Postgres RLS).
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

// DELETE /api/v1/activities/{activityID}
// Soft-deletes an activity. Requires planner or org_admin.
// Also removes any links that reference this activity as source or target
// (the service layer handles cascading).
func (h *Plan) DeleteActivity(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	activityID, err := uuid.Parse(chi.URLParam(r, "activityID"))
	if err != nil {
		response.ErrorJSON(w, "invalid activity id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteActivity(r.Context(), activityID, *claims.OrgID, claims.UserID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "activity deleted"})
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

// DELETE /api/v1/activities/{activityID}/links/{linkID}
// Removes a specific activity link. Requires planner or org_admin.
func (h *Plan) DeleteActivityLink(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	activityID, err := uuid.Parse(chi.URLParam(r, "activityID"))
	if err != nil {
		response.ErrorJSON(w, "invalid activity id", http.StatusBadRequest)
		return
	}
	linkID, err := uuid.Parse(chi.URLParam(r, "linkID"))
	if err != nil {
		response.ErrorJSON(w, "invalid link id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteActivityLink(r.Context(), activityID, linkID, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "link deleted"})
}

// ── Shared helpers ────────────────────────────────────────────────────────

// mustOrgClaims extracts JWT claims and validates an org context exists.
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
