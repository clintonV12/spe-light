// ai.go — AI draft/summary HTTP handlers (Sprint C), backed by Ollama.
//
// Routes wired in router.go (planner/org_admin only):
//
//	POST /api/v1/ai/draft
//	POST /api/v1/ai/summary
package handlers

import (
	"errors"
	"net/http"
	"strings"

	"spe-light/internal/response"
	aisvc "spe-light/internal/services/ai"

	"github.com/google/uuid"
)

// AI groups the AI draft/summary HTTP handlers.
type AI struct {
	svc *aisvc.Service
}

// NewAI creates an AI handler group.
func NewAI(svc *aisvc.Service) *AI {
	return &AI{svc: svc}
}

// POST /api/v1/ai/draft
func (h *AI) Draft(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	var req aisvc.DraftRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	if req.PlanID == uuid.Nil || req.ActivityType == "" {
		response.ErrorJSON(w, "plan_id and activity_type are required", http.StatusBadRequest)
		return
	}

	draft, err := h.svc.Draft(r.Context(), *claims.OrgID, req)
	if err != nil {
		writeAIError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, draft)
}

// POST /api/v1/ai/summary
func (h *AI) Summary(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	var req aisvc.SummaryRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	if req.PlanID == uuid.Nil {
		response.ErrorJSON(w, "plan_id is required", http.StatusBadRequest)
		return
	}

	summary, err := h.svc.Summary(r.Context(), *claims.OrgID, req)
	if err != nil {
		writeAIError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, summary)
}

// POST /api/v1/ai/suggest-links
//
// Read-only — returns candidate links for the caller to review and
// individually accept/reject. Accepting one is a normal
// POST /api/v1/activities/{id}/links call (link_type: "ai_suggested"); this
// endpoint never writes to activity_links itself.
func (h *AI) SuggestLinks(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	var req aisvc.SuggestLinksRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	if req.PlanID == uuid.Nil {
		response.ErrorJSON(w, "plan_id is required", http.StatusBadRequest)
		return
	}

	suggestions, err := h.svc.SuggestLinks(r.Context(), *claims.OrgID, req)
	if err != nil {
		writeAIError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, suggestions)
}

// writeAIError maps Ollama connectivity failures to 503 (so the frontend can
// distinguish "AI is down, try later" from a genuine 400 bad request) and
// everything else to 400.
func writeAIError(w http.ResponseWriter, err error) {
	if strings.Contains(err.Error(), "unreachable") || errors.Is(err, http.ErrHandlerTimeout) {
		response.ErrorJSON(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
}