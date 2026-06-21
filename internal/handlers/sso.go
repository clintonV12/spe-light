// sso.go — SSO configuration HTTP handlers.
//
// Routes (all require org_admin role):
//
//	GET    /api/v1/org/sso   — get current SSO config for caller's org
//	PUT    /api/v1/org/sso   — create or replace SSO config (upsert)
//	DELETE /api/v1/org/sso   — remove SSO config (re-enables local login)
//
// The SAML/OIDC authentication flow handlers (ACS, OIDC callback, metadata
// endpoint) are stub-wired in router.go but implemented separately once the
// crewjam/saml and coreos/go-oidc libraries are vendored in Sprint A.
package handlers

import (
	"net/http"

	"spe-light/internal/middleware"
	"spe-light/internal/response"
	ssosvc "spe-light/internal/services/sso"
)

// SSO groups all SSO configuration HTTP handlers.
type SSO struct {
	svc *ssosvc.Service
}

// NewSSO creates an SSO handler group.
func NewSSO(svc *ssosvc.Service) *SSO {
	return &SSO{svc: svc}
}

// GET /api/v1/org/sso
// Returns the current SSO configuration for the caller's org, or 404 if
// none is configured. client_secret and certificate are never returned
// (write-only fields, tagged json:"-" on the model).
func (h *SSO) GetConfig(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil || claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	cfg, err := h.svc.GetConfig(r.Context(), *claims.OrgID)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if cfg == nil {
		response.ErrorJSON(w, "no SSO configuration found for this organisation", http.StatusNotFound)
		return
	}
	response.JSON(w, http.StatusOK, cfg)
}

// PUT /api/v1/org/sso
// Creates or replaces the SSO configuration. This is an upsert — calling
// it a second time fully replaces the previous config (the org can only
// have one active SSO config at a time, one protocol at a time).
func (h *SSO) UpsertConfig(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil || claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	var req ssosvc.UpsertSSORequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	cfg, err := h.svc.UpsertConfig(r.Context(), *claims.OrgID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, cfg)
}

// DELETE /api/v1/org/sso
// Removes the SSO configuration. Once deleted, local email+password login
// is unconditionally re-enabled regardless of what local_login_disabled
// was set to before. Returns 400 if no config exists to delete.
func (h *SSO) DeleteConfig(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil || claims.OrgID == nil {
		response.ErrorJSON(w, "no organisation context", http.StatusForbidden)
		return
	}
	if err := h.svc.DeleteConfig(r.Context(), *claims.OrgID); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "SSO configuration removed"})
}
