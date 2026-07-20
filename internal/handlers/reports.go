// reports.go — report generation HTTP handlers (Sprint D).
//
// Routes wired in router.go:
//
//	POST /api/v1/plans/{planID}/reports          — generate (planner/org_admin)
//	GET  /api/v1/plans/{planID}/reports          — history (all org roles)
//	GET  /api/v1/reports/{jobID}                 — poll
//	GET  /api/v1/reports/{jobID}/download        — download the finished file
package handlers

import (
	"net/http"

	"spe-light/internal/models"
	"spe-light/internal/response"
	reportsvc "spe-light/internal/services/report"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Reports groups all report HTTP handlers.
type Reports struct {
	svc *reportsvc.Service
}

// NewReports creates a Reports handler group.
func NewReports(svc *reportsvc.Service) *Reports {
	return &Reports{svc: svc}
}

// POST /api/v1/plans/{planID}/reports
// Generates a report synchronously and returns its ID as job_id, matching
// the async-job shape the frontend polls on (see reportsvc's package doc for
// why generation is currently synchronous).
func (h *Reports) Generate(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req reportsvc.GenerateRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	report, err := h.svc.Generate(r.Context(), planID, *claims.OrgID, claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, map[string]string{"job_id": report.ID.String()})
}

// GET /api/v1/reports/{jobID}
func (h *Reports) Poll(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	jobID, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		response.ErrorJSON(w, "invalid job id", http.StatusBadRequest)
		return
	}
	status, err := h.svc.Poll(r.Context(), jobID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusNotFound)
		return
	}
	response.JSON(w, http.StatusOK, status)
}

// GET /api/v1/plans/{planID}/reports
func (h *Reports) History(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	reports, err := h.svc.History(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	if reports == nil {
		reports = []models.Report{}
	}
	response.JSON(w, http.StatusOK, reports)
}

// GET /api/v1/reports/{jobID}/download
// Streams the generated file straight from disk.
func (h *Reports) Download(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	jobID, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		response.ErrorJSON(w, "invalid job id", http.StatusBadRequest)
		return
	}
	path, filename, contentType, err := h.svc.FileForDownload(r.Context(), jobID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	http.ServeFile(w, r, path)
}
