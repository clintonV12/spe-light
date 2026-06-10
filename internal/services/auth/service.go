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

func New(db *pgxpool.Pool, cfg *config.Config, emailSvc *email.Service) *Service {
	return &Service{db: db, cfg: cfg, email: emailSvc}
}

// ── Request / Response types ──────────────────────────────────────────────

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type TokenResponse struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	User         UserDTO   `json:"user"`
}

type UserDTO struct {
	ID    uuid.UUID   `json:"id"`
	Name  string      `json:"name"`
	Email string      `json:"email"`
	Role  models.Role `json:"role"`
	OrgID *uuid.UUID  `json:"org_id,omitempty"`
}

type AcceptInviteRequest struct {
	Token    string `json:"token"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type RequestPasswordResetRequest struct {
	Email string `json:"email"`
}

type ConfirmPasswordResetRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

// ── Login ─────────────────────────────────────────────────────────────────

func (s *Service) Login(ctx context.Context, req LoginRequest) (*TokenResponse, error) {
	if req.Email == "" || req.Password == "" {
		return nil, fmt.Errorf("email and password are required")
	}

	// Fetch user by email
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
		return nil, fmt.Errorf("this account uses SSO — please sign in via your identity provider")
	}
	if err := auth.CheckPassword(req.Password, *user.PasswordHash); err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}

	// Update last_login_at
	_, _ = s.db.Exec(ctx,
		`UPDATE users SET last_login_at = NOW() WHERE id = $1`, user.ID)

	return s.issueTokenPair(ctx, &user)
}

// ── Refresh ───────────────────────────────────────────────────────────────

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
		return nil, fmt.Errorf("refresh token has been revoked")
	}
	if time.Now().After(rt.ExpiresAt) {
		return nil, fmt.Errorf("refresh token has expired")
	}

	// Revoke the used token (rotation)
	_, err = s.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, rt.ID)
	if err != nil {
		return nil, fmt.Errorf("revoke token: %w", err)
	}

	// Load user
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

func (s *Service) Logout(ctx context.Context, plaintextToken string) error {
	hash := auth.HashToken(plaintextToken)
	_, err := s.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		 WHERE token_hash = $1 AND revoked_at IS NULL`,
		hash)
	return err
}

// ── Password reset ────────────────────────────────────────────────────────

func (s *Service) RequestPasswordReset(ctx context.Context, email string) error {
	var userID uuid.UUID
	var name string
	err := s.db.QueryRow(ctx,
		`SELECT id, name FROM users WHERE email = $1 AND deleted_at IS NULL AND is_active = true`,
		email,
	).Scan(&userID, &name)
	if err == pgx.ErrNoRows {
		// Don't reveal whether the email exists
		return nil
	}
	if err != nil {
		return fmt.Errorf("query user: %w", err)
	}

	plaintext, hash, err := auth.GenerateInviteToken()
	if err != nil {
		return err
	}

	expiresAt := time.Now().Add(time.Hour)
	_, err = s.db.Exec(ctx,
		`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4)`,
		uuid.New(), userID, hash, expiresAt,
	)
	if err != nil {
		return fmt.Errorf("store reset token: %w", err)
	}

	resetLink := fmt.Sprintf("%s/auth/reset-password?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendPasswordReset(email, resetLink)
	return nil
}

func (s *Service) ConfirmPasswordReset(ctx context.Context, req ConfirmPasswordResetRequest) error {
	hash := auth.HashToken(req.Token)

	var userID uuid.UUID
	var expiresAt time.Time
	var usedAt *time.Time
	err := s.db.QueryRow(ctx,
		`SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
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
		newHash, userID,
	); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if _, err = tx.Exec(ctx,
		`UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1`,
		hash,
	); err != nil {
		return fmt.Errorf("mark token used: %w", err)
	}
	// Revoke all existing refresh tokens for security
	if _, err = tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		 WHERE user_id = $1 AND revoked_at IS NULL`,
		userID,
	); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}

	return tx.Commit(ctx)
}

// ── Invite acceptance ─────────────────────────────────────────────────────

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

	var user models.User
	user.ID = uuid.New()
	user.Email = inv.Email
	user.Name = req.Name
	user.Role = inv.Role
	user.IsActive = true
	user.Locale = "en"
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

	now := time.Now()
	_, err = tx.Exec(ctx,
		`UPDATE invitations SET status = 'accepted', accepted_at = $1 WHERE id = $2`,
		now, inv.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("update invitation: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}

	slog.Info("invitation accepted", "user_id", user.ID, "email", user.Email, "role", user.Role)
	return s.issueTokenPair(ctx, &user)
}

// ── Internal helpers ──────────────────────────────────────────────────────

func (s *Service) issueTokenPair(ctx context.Context, user *models.User) (*TokenResponse, error) {
	claims := models.TokenClaims{
		UserID: user.ID,
		Role:   user.Role,
		Email:  user.Email,
	}
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
	_, err = s.db.Exec(ctx,
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4)`,
		uuid.New(), user.ID, hash, expiresAt,
	)
	if err != nil {
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
