// Package authsvc implements all authentication business logic for StratPlan.
//
// Responsibilities:
//   - Email + password login with bcrypt verification
//   - JWT access token issuance (short-lived) and refresh token rotation (long-lived)
//   - Secure logout via server-side token revocation
//   - Password reset via emailed one-time token
//   - Invitation acceptance — creates the user account and issues tokens in one transaction
//
// Security notes:
//   - Tokens are stored as SHA-256 hashes; plaintext is only ever returned to the caller once.
//   - "Invalid credentials" is returned for both bad email and bad password to avoid enumeration.
//   - Password reset always returns 200 whether or not the email exists (same reason).
//   - On password change, all existing refresh tokens are revoked to log out all devices.
package authsvc

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"spe-light/internal/auth"
	"spe-light/internal/config"
	"spe-light/internal/email"
	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service handles all authentication business logic.
type Service struct {
	db    *pgxpool.Pool
	cfg   *config.Config
	email *email.Service
}

// New creates an auth Service. All three dependencies are required.
func New(db *pgxpool.Pool, cfg *config.Config, emailSvc *email.Service) *Service {
	return &Service{db: db, cfg: cfg, email: emailSvc}
}

// ── Request / Response DTOs ───────────────────────────────────────────────

// LoginRequest holds the credentials submitted by the client.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// TokenResponse is returned on successful login, refresh, and invite acceptance.
type TokenResponse struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	User         UserDTO   `json:"user"`
}

// UserDTO is the safe user payload embedded in TokenResponse (no password hash).
type UserDTO struct {
	ID    uuid.UUID   `json:"id"`
	Name  string      `json:"name"`
	Email string      `json:"email"`
	Role  models.Role `json:"role"`
	OrgID *uuid.UUID  `json:"org_id,omitempty"`
}

// AcceptInviteRequest is sent by a new user completing their invitation.
type AcceptInviteRequest struct {
	Token    string `json:"token"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

// RequestPasswordResetRequest holds the target email address.
type RequestPasswordResetRequest struct {
	Email string `json:"email"`
}

// ConfirmPasswordResetRequest holds the one-time token and the new password.
type ConfirmPasswordResetRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

// ── Login ─────────────────────────────────────────────────────────────────

// Login validates credentials and returns a token pair on success.
// Returns a deliberately vague error for both "user not found" and "wrong password"
// to prevent account enumeration (REQ-F-001).
func (s *Service) Login(ctx context.Context, req LoginRequest) (*TokenResponse, error) {
	if req.Email == "" || req.Password == "" {
		return nil, fmt.Errorf("email and password are required")
	}

	var user models.User
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, email, password_hash, name, role, locale, is_active
		 FROM users WHERE email = $1 AND deleted_at IS NULL`,
		req.Email,
	).Scan(&user.ID, &user.OrgID, &user.Email, &user.PasswordHash,
		&user.Name, &user.Role, &user.Locale, &user.IsActive)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("invalid credentials")
	}
	if err != nil {
		return nil, fmt.Errorf("query user: %w", err)
	}
	if !user.IsActive {
		return nil, fmt.Errorf("account is deactivated")
	}
	if user.PasswordHash == nil {
		// SSO-only account; password login is disabled for this user.
		return nil, fmt.Errorf("this account uses SSO — please sign in via your identity provider")
	}
	if err := auth.CheckPassword(req.Password, *user.PasswordHash); err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}

	// Best-effort last-login update; failure is non-fatal.
	_, _ = s.db.Exec(ctx,
		`UPDATE users SET last_login_at = NOW() WHERE id = $1`, user.ID)

	slog.Info("user logged in", "user_id", user.ID, "role", user.Role)
	return s.issueTokenPair(ctx, &user)
}

// ── Refresh ───────────────────────────────────────────────────────────────

// RefreshToken rotates the refresh token: revokes the presented token and
// issues a new token pair.  This limits the blast radius if a refresh token
// is stolen — re-use of a revoked token should trigger an alert (future work).
func (s *Service) RefreshToken(ctx context.Context, plaintextToken string) (*TokenResponse, error) {
	hash := auth.HashToken(plaintextToken)

	var rt models.RefreshToken
	err := s.db.QueryRow(ctx,
		`SELECT id, user_id, expires_at, revoked_at
		 FROM refresh_tokens WHERE token_hash = $1`,
		hash,
	).Scan(&rt.ID, &rt.UserID, &rt.ExpiresAt, &rt.RevokedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("invalid refresh token")
	}
	if err != nil {
		return nil, fmt.Errorf("query refresh token: %w", err)
	}
	if rt.RevokedAt != nil {
		// Token reuse detected — a stolen token may be in use.
		slog.Warn("refresh token reuse detected", "token_id", rt.ID, "user_id", rt.UserID)
		return nil, fmt.Errorf("refresh token has been revoked")
	}
	if time.Now().After(rt.ExpiresAt) {
		return nil, fmt.Errorf("refresh token has expired")
	}

	// Revoke before issuing — if the DB write below fails, the old token
	// is already dead and the user must log in again. This is intentional.
	if _, err = s.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, rt.ID); err != nil {
		return nil, fmt.Errorf("revoke token: %w", err)
	}

	var user models.User
	err = s.db.QueryRow(ctx,
		`SELECT id, org_id, email, name, role, is_active
		 FROM users WHERE id = $1 AND deleted_at IS NULL`,
		rt.UserID,
	).Scan(&user.ID, &user.OrgID, &user.Email, &user.Name, &user.Role, &user.IsActive)
	if err != nil {
		return nil, fmt.Errorf("load user: %w", err)
	}
	if !user.IsActive {
		return nil, fmt.Errorf("account is deactivated")
	}

	return s.issueTokenPair(ctx, &user)
}

// ── Logout ────────────────────────────────────────────────────────────────

// Logout revokes the presented refresh token. The access token will expire
// naturally (15 min TTL). Call this on the client-side too to clear storage.
func (s *Service) Logout(ctx context.Context, plaintextToken string) error {
	hash := auth.HashToken(plaintextToken)
	_, err := s.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		 WHERE token_hash = $1 AND revoked_at IS NULL`,
		hash)
	return err
}

// ── Password reset ────────────────────────────────────────────────────────

// RequestPasswordReset sends a one-time reset link to the email address if an
// active account exists. Always returns nil to prevent enumeration (REQ-F-007).
func (s *Service) RequestPasswordReset(ctx context.Context, emailAddr string) error {
	var userID uuid.UUID
	err := s.db.QueryRow(ctx,
		`SELECT id FROM users
		 WHERE email = $1 AND deleted_at IS NULL AND is_active = true`,
		emailAddr,
	).Scan(&userID)
	if err == pgx.ErrNoRows {
		return nil // silent — don't reveal whether the email exists
	}
	if err != nil {
		return fmt.Errorf("query user: %w", err)
	}

	plaintext, hash, err := auth.GenerateInviteToken()
	if err != nil {
		return err
	}

	_, err = s.db.Exec(ctx,
		`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4)`,
		uuid.New(), userID, hash, time.Now().Add(time.Hour),
	)
	if err != nil {
		return fmt.Errorf("store reset token: %w", err)
	}

	resetLink := fmt.Sprintf("%s/auth/reset-password?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendPasswordReset(emailAddr, resetLink)
	return nil
}

// ConfirmPasswordReset validates the one-time token and updates the password.
// All existing refresh tokens are revoked so the user is logged out everywhere.
func (s *Service) ConfirmPasswordReset(ctx context.Context, req ConfirmPasswordResetRequest) error {
	hash := auth.HashToken(req.Token)

	var userID uuid.UUID
	var expiresAt time.Time
	var usedAt *time.Time
	err := s.db.QueryRow(ctx,
		`SELECT user_id, expires_at, used_at
		 FROM password_reset_tokens WHERE token_hash = $1`,
		hash,
	).Scan(&userID, &expiresAt, &usedAt)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("invalid or expired reset token")
	}
	if err != nil {
		return fmt.Errorf("query token: %w", err)
	}
	if usedAt != nil {
		return fmt.Errorf("reset token has already been used")
	}
	if time.Now().After(expiresAt) {
		return fmt.Errorf("reset token has expired")
	}

	newHash, err := auth.HashPassword(req.Password)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err = tx.Exec(ctx,
		`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
		newHash, userID); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if _, err = tx.Exec(ctx,
		`UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1`,
		hash); err != nil {
		return fmt.Errorf("mark token used: %w", err)
	}
	// Revoke all sessions — if the reset was triggered by a compromise,
	// this ejects the attacker from any active sessions immediately.
	if _, err = tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		 WHERE user_id = $1 AND revoked_at IS NULL`,
		userID); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}

	return tx.Commit(ctx)
}

// ── Invite acceptance ─────────────────────────────────────────────────────

// AcceptInvite consumes a one-time invitation token, creates the user account,
// and returns a token pair so the user is logged in immediately.
func (s *Service) AcceptInvite(ctx context.Context, req AcceptInviteRequest) (*TokenResponse, error) {
	if req.Name == "" || req.Password == "" || req.Token == "" {
		return nil, fmt.Errorf("token, name and password are required")
	}

	hash := auth.HashToken(req.Token)

	var inv models.Invitation
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, email, role, expires_at, status
		 FROM invitations WHERE token_hash = $1`,
		hash,
	).Scan(&inv.ID, &inv.OrgID, &inv.Email, &inv.Role, &inv.ExpiresAt, &inv.Status)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("invalid invitation token")
	}
	if err != nil {
		return nil, fmt.Errorf("query invitation: %w", err)
	}
	if inv.Status != models.InvitePending {
		return nil, fmt.Errorf("invitation is no longer valid (status: %s)", inv.Status)
	}
	if time.Now().After(inv.ExpiresAt) {
		// Mark expired so the listing reflects reality.
		_, _ = s.db.Exec(ctx,
			`UPDATE invitations SET status = 'expired' WHERE id = $1`, inv.ID)
		return nil, fmt.Errorf("invitation has expired")
	}

	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	user := models.User{
		ID:       uuid.New(),
		Email:    inv.Email,
		Name:     req.Name,
		Role:     inv.Role,
		IsActive: true,
		Locale:   "en",
	}
	if inv.OrgID != nil {
		user.OrgID = *inv.OrgID
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO users (id, org_id, email, password_hash, name, role, locale, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		user.ID, user.OrgID, user.Email, passwordHash,
		user.Name, user.Role, user.Locale, user.IsActive,
	)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	if _, err = tx.Exec(ctx,
		`UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
		inv.ID); err != nil {
		return nil, fmt.Errorf("update invitation: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}

	slog.Info("invitation accepted", "user_id", user.ID, "email", user.Email, "role", user.Role)
	return s.issueTokenPair(ctx, &user)
}

// ── Internal helpers ──────────────────────────────────────────────────────

// issueTokenPair mints a new access + refresh token pair for the given user
// and persists the refresh token hash in the database.
func (s *Service) issueTokenPair(ctx context.Context, user *models.User) (*TokenResponse, error) {
	claims := models.TokenClaims{
		UserID: user.ID,
		Role:   user.Role,
		Email:  user.Email,
	}
	// Platform-tier users (super_admin, platform_support) have no OrgID in the token.
	if user.OrgID != (uuid.UUID{}) {
		orgID := user.OrgID
		claims.OrgID = &orgID
	}

	accessToken, err := auth.IssueAccessToken(s.cfg.JWTSecret, s.cfg.JWTAccessExpiry(), claims)
	if err != nil {
		return nil, fmt.Errorf("issue access token: %w", err)
	}

	plaintext, hash, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(s.cfg.JWTRefreshExpiry())
	if _, err = s.db.Exec(ctx,
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4)`,
		uuid.New(), user.ID, hash, expiresAt); err != nil {
		return nil, fmt.Errorf("store refresh token: %w", err)
	}

	return &TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: plaintext,
		ExpiresAt:    expiresAt,
		User: UserDTO{
			ID:    user.ID,
			Name:  user.Name,
			Email: user.Email,
			Role:  user.Role,
			OrgID: claims.OrgID,
		},
	}, nil
}