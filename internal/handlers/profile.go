// profile.go — HTTP handlers for the self-service account management
// surface (GET/PATCH /api/v1/me, password change, session listing/revoke).
//
// Every handler here derives the target user strictly from JWT claims
// (middleware.ClaimsFrom) — never from a path param — so there is no
// route to act on someone else's account through this surface, and no
// role gate is applied: every authenticated user (platform-tier or
// org-tier, any role) manages their own account.
//
// Methods are added to the existing Org handler group (see org.go) since
// GetMe/GetOrg already established that group as the home for
// "authenticated caller reads/writes their own stuff" — no new handler
// type or constructor needed.
package handlers

import (
	"net/http"

	"spe-light/internal/middleware"
	"spe-light/internal/response"
	orgsvc "spe-light/internal/services/org"
)

// GET /api/v1/me
// Returns the caller's own profile. Functionally the same data as
// GET /api/v1/org/me (also unrestricted, also derived from JWT claims) —
// kept as a distinct route under /api/v1/me so the profile page has a
// single, tier-agnostic endpoint to call that doesn't share a name with
// the org-scoped surface conceptually, and so future profile-only fields
// don't need to be threaded through GetOrg's response shape.
func (h *Org) GetProfile(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil {
		response.ErrorJSON(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	user, err := h.svc.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		response.ErrorJSON(w, "user not found", http.StatusNotFound)
		return
	}
	response.JSON(w, http.StatusOK, user)
}

// PATCH /api/v1/me
// Self-service edit of name/phone/avatar/locale. Cannot touch email, role,
// org, or active status — see orgsvc.UpdateProfileRequest's doc comment.
func (h *Org) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil {
		response.ErrorJSON(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	var req orgsvc.UpdateProfileRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	user, err := h.svc.UpdateProfile(r.Context(), claims.UserID, req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, user)
}

// POST /api/v1/me/change-password
// Requires current_password, new_password, confirm_password in the body.
// On success, all of the caller's sessions (including this one's refresh
// token) are revoked — the frontend should treat 200 here as a forced
// logout and route to /login with a "password changed, please sign back
// in" message rather than continuing to use the now-stale access token.
func (h *Org) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil {
		response.ErrorJSON(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	var req orgsvc.ChangePasswordRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	if err := h.svc.ChangePassword(r.Context(), claims.UserID, req); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "password updated, please sign in again"})
}

// GET /api/v1/me/sessions
// Lists the caller's currently active sessions.
func (h *Org) ListSessions(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil {
		response.ErrorJSON(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	sessions, err := h.svc.ListSessions(r.Context(), claims.UserID)
	if err != nil {
		response.ErrorJSON(w, "failed to list sessions", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, sessions)
}

// POST /api/v1/me/sessions/revoke-all
// Signs the caller out everywhere, including this session — same forced-
// logout contract as ChangePassword above.
func (h *Org) RevokeAllSessions(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFrom(r.Context())
	if claims == nil {
		response.ErrorJSON(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	if err := h.svc.RevokeAllSessions(r.Context(), claims.UserID); err != nil {
		response.ErrorJSON(w, "failed to revoke sessions", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "signed out of all sessions"})
}
