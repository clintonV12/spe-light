// profile.go — self-service account management (User Profile & Account
// Management module).
//
// Everything here operates on the CALLER's own account only — userID always
// comes from JWT claims in the handler, never from a path param — so there
// is no cross-user access risk and (deliberately) no role gate: every
// authenticated user, platform-tier or org-tier, manages their own account
// through these methods.
//
// Distinct from the admin-facing UpdateUser (role / is_active — org_admin
// only) already in org_service.go: nothing here can change a user's role,
// org, or active status. That keeps "manage my own account" and "manage
// other people's accounts" as two clearly separate privilege surfaces.
package orgsvc

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"spe-light/internal/auditlog"
	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// ── Update profile ───────────────────────────────────────────────────────

// UpdateProfileRequest carries the fields a user can edit about themselves.
// Every field is optional — supply only what needs changing. Email and role
// are deliberately absent: email changes require re-verification (not yet
// implemented — see the package doc on future enhancements) and role is
// admin-managed only.
type UpdateProfileRequest struct {
	Name      *string `json:"name,omitempty"`
	Phone     *string `json:"phone,omitempty"`
	AvatarURL *string `json:"avatar_url,omitempty"`
	Locale    *string `json:"locale,omitempty"`
}

// UpdateProfile applies a partial self-service update to the caller's own
// user record. actorID and userID are always the same value here (enforced
// by the handler deriving both from JWT claims) — passed separately only so
// the audit log call reads the same way as every other auditlog.Record call
// in this package.
func (s *Service) UpdateProfile(ctx context.Context, userID uuid.UUID, req UpdateProfileRequest) (*models.User, error) {
	if req.Name == nil && req.Phone == nil && req.AvatarURL == nil && req.Locale == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		return nil, fmt.Errorf("name cannot be empty")
	}

	var orgID *uuid.UUID
	err := s.db.QueryRow(ctx,
		`SELECT org_id FROM users WHERE id = $1 AND deleted_at IS NULL`, userID,
	).Scan(&orgID)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("fetch user: %w", err)
	}

	_, err = s.db.Exec(ctx,
		`UPDATE users SET
		    name       = COALESCE($1, name),
		    phone      = COALESCE($2, phone),
		    avatar_url = COALESCE($3, avatar_url),
		    locale     = COALESCE($4, locale),
		    updated_at = NOW()
		 WHERE id = $5`,
		req.Name, req.Phone, req.AvatarURL, req.Locale, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("update profile: %w", err)
	}

	// org_id is nil for platform-tier users — audit entries always need an
	// org_id column value, so fall back to uuid.Nil rather than skipping the
	// audit record entirely; every other cross-tier action in this codebase
	// (e.g. UpdatePlatformUser) has the same "platform users have no org to
	// scope the log to" gap, so this matches existing behaviour.
	auditOrgID := uuid.Nil
	if orgID != nil {
		auditOrgID = *orgID
	}
	auditlog.Record(ctx, s.db, auditlog.Entry{
		OrgID: auditOrgID, UserID: userID, Action: "user.profile_updated",
		TableName: "users", RecordID: userID,
	})

	return s.GetUserByID(ctx, userID)
}

// ── Change password ──────────────────────────────────────────────────────

// PasswordPolicyError is returned when a candidate password fails policy so
// handlers can surface a precise, user-facing message rather than a generic
// 400.
type PasswordPolicyError struct{ Reason string }

func (e *PasswordPolicyError) Error() string { return e.Reason }

// validatePasswordPolicy enforces the same minimum bar as invitation
// acceptance (see AcceptInvitePage.tsx's client-side heuristic) — 8+
// characters is the hard floor checked server-side; the frontend's
// weak/fair/strong meter is advisory UX on top of this.
func validatePasswordPolicy(pw string) error {
	if len(pw) < 8 {
		return &PasswordPolicyError{Reason: "password must be at least 8 characters"}
	}
	return nil
}

// ChangePasswordRequest carries the three fields the change-password form
// collects. Confirmation matching is checked here as well as client-side —
// never trust the client to have enforced it.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
	ConfirmPassword string `json:"confirm_password"`
}

// ChangePassword verifies the caller's current password, enforces password
// policy, and rejects a no-op change (new == current) before hashing and
// persisting the new password. On success, every refresh token for this
// user is revoked (REQ: "automatic invalidation of existing sessions after
// a password change") — the caller's own client is expected to treat this
// like any other forced-logout and send them back to /login, exactly as
// UpdateUser's deactivation path already does for admin-initiated
// deactivation.
//
// SSO-only accounts (sso_subject set, password_hash NULL) cannot use this
// flow — they have no local password to change.
func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, req ChangePasswordRequest) error {
	if req.NewPassword != req.ConfirmPassword {
		return fmt.Errorf("new password and confirmation do not match")
	}
	if err := validatePasswordPolicy(req.NewPassword); err != nil {
		return err
	}
	if req.CurrentPassword == req.NewPassword {
		return fmt.Errorf("new password must be different from your current password")
	}

	var orgID *uuid.UUID
	var currentHash *string
	err := s.db.QueryRow(ctx,
		`SELECT org_id, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`, userID,
	).Scan(&orgID, &currentHash)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("user not found")
	}
	if err != nil {
		return fmt.Errorf("fetch user: %w", err)
	}
	if currentHash == nil {
		return fmt.Errorf("this account signs in via SSO and has no local password to change")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*currentHash), []byte(req.CurrentPassword)); err != nil {
		return fmt.Errorf("current password is incorrect")
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	if _, err := s.db.Exec(ctx,
		`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
		string(newHash), userID,
	); err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	if _, err := s.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
		userID,
	); err != nil {
		// Non-fatal — the password itself already changed successfully; a
		// failure here just means old sessions outlive the change until
		// their JWTs naturally expire. Logged, not surfaced as an error.
		slog.Error("revoke sessions after password change", "user_id", userID, "err", err)
	}

	auditOrgID := uuid.Nil
	if orgID != nil {
		auditOrgID = *orgID
	}
	auditlog.Record(ctx, s.db, auditlog.Entry{
		OrgID: auditOrgID, UserID: userID, Action: "user.password_changed",
		TableName: "users", RecordID: userID,
	})
	slog.Info("user changed their own password", "user_id", userID)
	return nil
}

// ── Sessions ──────────────────────────────────────────────────────────────

// SessionInfo is a read-only view of one of the caller's active sessions
// (one row per issued, non-revoked refresh token). There is currently no
// device/IP/user-agent capture on login, so sessions are distinguished only
// by when they were created and when they expire — enough for "how many
// places am I signed in" and "sign out everywhere" without a schema change
// to the login path. Device/location metadata is a natural follow-up (see
// package doc on future enhancements).
type SessionInfo struct {
	ID        uuid.UUID `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ListSessions returns the caller's currently active (non-revoked,
// non-expired) sessions, newest first.
func (s *Service) ListSessions(ctx context.Context, userID uuid.UUID) ([]SessionInfo, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, created_at, expires_at
		 FROM refresh_tokens
		 WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	sessions := []SessionInfo{}
	for rows.Next() {
		var sess SessionInfo
		if err := rows.Scan(&sess.ID, &sess.CreatedAt, &sess.ExpiresAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, sess)
	}
	return sessions, rows.Err()
}

// RevokeAllSessions signs the caller out of every session (REQ: "log out
// from all active sessions"). Like ChangePassword, this revokes the
// caller's own current refresh token too — the frontend is expected to
// treat the response as a forced logout and redirect to /login.
func (s *Service) RevokeAllSessions(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
		userID,
	); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	slog.Info("user revoked all sessions", "user_id", userID)
	return nil
}
