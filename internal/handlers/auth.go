package handlers

import (
	"net/http"

	"spe-light/internal/response"
	authsvc "spe-light/internal/services/auth"
)

// Auth groups all authentication HTTP handlers.
type Auth struct {
	svc *authsvc.Service
}

func NewAuth(svc *authsvc.Service) *Auth {
	return &Auth{svc: svc}
}

// POST /auth/login
func (h *Auth) Login(w http.ResponseWriter, r *http.Request) {
	var req authsvc.LoginRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.Login(r.Context(), req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusUnauthorized)
		return
	}
	response.JSON(w, http.StatusOK, resp)
}

// POST /auth/refresh
func (h *Auth) Refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !response.DecodeJSON(w, r, &body) {
		return
	}
	if body.RefreshToken == "" {
		response.ErrorJSON(w, "refresh_token is required", http.StatusBadRequest)
		return
	}
	resp, err := h.svc.RefreshToken(r.Context(), body.RefreshToken)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusUnauthorized)
		return
	}
	response.JSON(w, http.StatusOK, resp)
}

// POST /auth/logout
func (h *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !response.DecodeJSON(w, r, &body) {
		return
	}
	if body.RefreshToken == "" {
		response.ErrorJSON(w, "refresh_token is required", http.StatusBadRequest)
		return
	}
	if err := h.svc.Logout(r.Context(), body.RefreshToken); err != nil {
		response.ErrorJSON(w, "logout failed", http.StatusInternalServerError)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "logged out"})
}

// POST /auth/password-reset/request
func (h *Auth) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req authsvc.RequestPasswordResetRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	// Always return 200 — don't reveal whether email exists
	_ = h.svc.RequestPasswordReset(r.Context(), req.Email)
	response.JSON(w, http.StatusOK, map[string]string{
		"message": "if that email exists, a reset link has been sent",
	})
}

// POST /auth/password-reset/confirm
func (h *Auth) ConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req authsvc.ConfirmPasswordResetRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	if err := h.svc.ConfirmPasswordReset(r.Context(), req); err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "password updated"})
}

// POST /invitations/accept
func (h *Auth) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
	var req authsvc.AcceptInviteRequest
	if !response.DecodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.AcceptInvite(r.Context(), req)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	response.JSON(w, http.StatusCreated, resp)
}
