// local_plan_sections.go — HTTP handlers for local-plan chapters 2, 3, 6, 7
// (Strategic Focus, Situational Analysis, Organisational Structure,
// Monitoring & Evaluation). Methods on the existing Plan handler struct,
// matching the pattern set by strategic_pillars.go and plan_viewer.go.
//
// Routes wired in router.go — see the per-section comment blocks in each
// corresponding plansvc file (vision_mission.go, situational_analysis.go,
// org_structure.go, monitoring_evaluation.go) for the exact route table.
package handlers

import (
	"net/http"

	"spe-light/internal/models"
	"spe-light/internal/response"
	plansvc "spe-light/internal/services/plan"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ── Chapter 2: Strategic Focus ──────────────────────────────────────────────

// PUT /api/v1/plans/{planID}/strategic-focus
func (h *Plan) UpdateStrategicFocus(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.UpdateStrategicFocusRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	plan, err := h.svc.UpdateStrategicFocus(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, plan)
}

// GET /api/v1/plans/{planID}/core-values
func (h *Plan) ListCoreValues(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	values, err := h.svc.ListCoreValues(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, values)
}

// POST /api/v1/plans/{planID}/core-values
func (h *Plan) CreateCoreValue(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreateCoreValueRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	cv, err := h.svc.CreateCoreValue(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, cv)
}

// PUT /api/v1/core-values/{coreValueID}
func (h *Plan) UpdateCoreValue(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "coreValueID"))
	if err != nil {
		response.ErrorJSON(w, "invalid core value id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdateCoreValueRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	cv, err := h.svc.UpdateCoreValue(r.Context(), id, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, cv)
}

// DELETE /api/v1/core-values/{coreValueID}
func (h *Plan) DeleteCoreValue(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "coreValueID"))
	if err != nil {
		response.ErrorJSON(w, "invalid core value id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteCoreValue(r.Context(), id, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "core value deleted"})
}

// ── Chapter 3: Situational Analysis ─────────────────────────────────────────

// GET /api/v1/plans/{planID}/stakeholders
func (h *Plan) ListStakeholders(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	items, err := h.svc.ListStakeholders(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, items)
}

// POST /api/v1/plans/{planID}/stakeholders
func (h *Plan) CreateStakeholder(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreateStakeholderRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.CreateStakeholder(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, item)
}

// PUT /api/v1/stakeholders/{stakeholderID}
func (h *Plan) UpdateStakeholder(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "stakeholderID"))
	if err != nil {
		response.ErrorJSON(w, "invalid stakeholder id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdateStakeholderRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.UpdateStakeholder(r.Context(), id, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, item)
}

// DELETE /api/v1/stakeholders/{stakeholderID}
func (h *Plan) DeleteStakeholder(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "stakeholderID"))
	if err != nil {
		response.ErrorJSON(w, "invalid stakeholder id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteStakeholder(r.Context(), id, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "stakeholder deleted"})
}

// GET /api/v1/plans/{planID}/swot-items
func (h *Plan) ListSWOTItems(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	items, err := h.svc.ListSWOTItems(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, items)
}

// POST /api/v1/plans/{planID}/swot-items
func (h *Plan) CreateSWOTItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreateSWOTItemRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.CreateSWOTItem(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, item)
}

// PUT /api/v1/swot-items/{swotItemID}
func (h *Plan) UpdateSWOTItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "swotItemID"))
	if err != nil {
		response.ErrorJSON(w, "invalid swot item id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdateSWOTItemRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.UpdateSWOTItem(r.Context(), id, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, item)
}

// DELETE /api/v1/swot-items/{swotItemID}
func (h *Plan) DeleteSWOTItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "swotItemID"))
	if err != nil {
		response.ErrorJSON(w, "invalid swot item id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteSWOTItem(r.Context(), id, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "swot item deleted"})
}

// GET /api/v1/plans/{planID}/pestel-items
func (h *Plan) ListPESTELItems(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	items, err := h.svc.ListPESTELItems(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, items)
}

// POST /api/v1/plans/{planID}/pestel-items
func (h *Plan) CreatePESTELItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreatePESTELItemRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.CreatePESTELItem(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, item)
}

// PUT /api/v1/pestel-items/{pestelItemID}
func (h *Plan) UpdatePESTELItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "pestelItemID"))
	if err != nil {
		response.ErrorJSON(w, "invalid pestel item id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdatePESTELItemRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.UpdatePESTELItem(r.Context(), id, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, item)
}

// DELETE /api/v1/pestel-items/{pestelItemID}
func (h *Plan) DeletePESTELItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "pestelItemID"))
	if err != nil {
		response.ErrorJSON(w, "invalid pestel item id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeletePESTELItem(r.Context(), id, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "pestel item deleted"})
}

// ── Chapter 6: Organisational Structure ─────────────────────────────────────

// GET /api/v1/plans/{planID}/org-structure-roles
func (h *Plan) ListOrgStructureRoles(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	roles, err := h.svc.ListOrgStructureRoles(r.Context(), planID, *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, roles)
}

// POST /api/v1/plans/{planID}/org-structure-roles
func (h *Plan) CreateOrgStructureRole(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreateOrgStructureRoleRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	role, err := h.svc.CreateOrgStructureRole(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, role)
}

// PUT /api/v1/org-structure-roles/{roleID}
func (h *Plan) UpdateOrgStructureRole(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "roleID"))
	if err != nil {
		response.ErrorJSON(w, "invalid role id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdateOrgStructureRoleRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	role, err := h.svc.UpdateOrgStructureRole(r.Context(), id, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, role)
}

// DELETE /api/v1/org-structure-roles/{roleID}
func (h *Plan) DeleteOrgStructureRole(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "roleID"))
	if err != nil {
		response.ErrorJSON(w, "invalid role id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteOrgStructureRole(r.Context(), id, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "role deleted"})
}

// ── Chapter 7: Monitoring & Evaluation ──────────────────────────────────────

// GET /api/v1/plans/{planID}/me-items?category=objective
func (h *Plan) ListMEItems(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var category *models.MECategory
	if c := r.URL.Query().Get("category"); c != "" {
		mc := models.MECategory(c)
		category = &mc
	}
	items, err := h.svc.ListMEItems(r.Context(), planID, *claims.OrgID, category)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, items)
}

// POST /api/v1/plans/{planID}/me-items
func (h *Plan) CreateMEItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	var req plansvc.CreateMEItemRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.CreateMEItem(r.Context(), planID, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, item)
}

// PUT /api/v1/me-items/{meItemID}
func (h *Plan) UpdateMEItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "meItemID"))
	if err != nil {
		response.ErrorJSON(w, "invalid me item id", http.StatusBadRequest)
		return
	}
	var req plansvc.UpdateMEItemRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	item, err := h.svc.UpdateMEItem(r.Context(), id, *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, item)
}

// DELETE /api/v1/me-items/{meItemID}
func (h *Plan) DeleteMEItem(w http.ResponseWriter, r *http.Request) {
	claims := mustOrgClaims(w, r)
	if claims == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "meItemID"))
	if err != nil {
		response.ErrorJSON(w, "invalid me item id", http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteMEItem(r.Context(), id, *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "me item deleted"})
}
