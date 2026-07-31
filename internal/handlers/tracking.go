// tracking.go — HTTP handlers for the Tracking Module (migration
// 010_kpi_tracking). Methods on the existing Plan handler struct, matching
// the pattern set by local_plan_sections.go. Works for both plan types —
// see plansvc/tracking.go's package comment.
//
// Routes wired in router.go:
//
//	GET    /api/v1/plans/{planID}/kpis
//	POST   /api/v1/plans/{planID}/kpis
//	PUT    /api/v1/kpis/{kpiID}
//	DELETE /api/v1/kpis/{kpiID}
//	PUT    /api/v1/kpis/{kpiID}/measurements/{period}
package handlers

import (
	"net/http"

	"spe-light/internal/models"
	"spe-light/internal/response"
	plansvc "spe-light/internal/services/plan"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// GET /api/v1/plans/{planID}/kpis
func (h *Plan) ListKPIs(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	kpis, err := h.svc.ListKPIs(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, kpis)
}

// POST /api/v1/plans/{planID}/kpis
func (h *Plan) CreateKPI(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreateKPIRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	kpi, err := h.svc.CreateKPI(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, kpi)
}

// PUT /api/v1/kpis/{kpiID}
func (h *Plan) UpdateKPI(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "kpiID"))
	if err != nil {
		response.ErrorJSON(w, "invalid kpi id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdateKPIRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	kpi, err := h.svc.UpdateKPI(r.Context(), id, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, kpi)
}

// DELETE /api/v1/kpis/{kpiID}
func (h *Plan) DeleteKPI(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "kpiID"))
	if err != nil {
		response.ErrorJSON(w, "invalid kpi id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteKPI(r.Context(), id, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "kpi deleted"})
}

// PUT /api/v1/kpis/{kpiID}/measurements/{period}
// period must be "monthly", "quarterly", or "annual" (models.ValidKPIPeriods).
func (h *Plan) UpsertKPIMeasurement(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "kpiID"))
	if err != nil {
		response.ErrorJSON(w, "invalid kpi id", http.StatusBadRequest)
		return
	}
	period := models.KPIPeriod(chi.URLParam(r, "period"))
	var req plansvc.UpsertMeasurementRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	measurement, err := h.svc.UpsertMeasurement(r.Context(), id, *claims.OrgID, period, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, measurement)
}
