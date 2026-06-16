// Package orgsvc implements org-scoped user and invitation management.
//
// All operations in this package are scoped to a single organisation. The
// caller (an org admin) can only affect users and invitations within their
// own org — this is enforced both at the handler (JWT claims check) and here
// by always filtering queries by org_id.
//
// Operations:
//   - Send / resend / cancel user invitations (REQ-F-004)
//   - List invitations for an org
//   - Update a user's role or active status (REQ-F-008, REQ-F-009)
//   - List users in an org
package orgsvc

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

// Service handles org-scoped business logic.
type Service struct {
	db    *pgxpool.Pool
	cfg   *config.Config
	email *email.Service
}

// New creates an org Service.
func New(db *pgxpool.Pool, cfg *config.Config, emailSvc *email.Service) *Service {
	return &Service{db: db, cfg: cfg, email: emailSvc}
}

// ── Invite user to org ────────────────────────────────────────────────────

// SendInviteRequest carries the fields required to create a user invitation.
type SendInviteRequest struct {
	Email       string      `json:"email"`
	Role        models.Role `json:"role"`
	PlanIDs     []uuid.UUID `json:"plan_ids,omitempty"` // non-empty = viewer scoped to specific plans
	InviterID   uuid.UUID
	OrgID       uuid.UUID
	OrgName     string
	InviterName string
}

// SendUserInvite creates an invitation record and emails the invite link.
// Org admins cannot create platform-level roles (super_admin / platform_support)
// via this flow — those are managed by the admin service.
func (s *Service) SendUserInvite(ctx context.Context, req SendInviteRequest) (*models.Invitation, error) {
	// Only org-tier roles can be assigned via this flow (REQ-F-008).
	switch req.Role {
	case models.RoleOrgAdmin, models.RolePlanner, models.RoleContributor, models.RoleViewer:
		// allowed
	default:
		return nil, fmt.Errorf("invalid role for org invite: %s", req.Role)
	}

	// Prevent duplicate pending invites for the same email+org.
	var existingID uuid.UUID
	err := s.db.QueryRow(ctx,
		`SELECT id FROM invitations
		 WHERE org_id = $1 AND email = $2 AND status = 'pending' AND expires_at > NOW()`,
		req.OrgID, req.Email,
	).Scan(&existingID)
	if err == nil {
		return nil, fmt.Errorf("a pending invitation already exists for %s — resend or cancel it first", req.Email)
	}
	if err != pgx.ErrNoRows {
		return nil, fmt.Errorf("check existing invite: %w", err)
	}

	plaintext, hash, err := auth.GenerateInviteToken()
	if err != nil {
		return nil, err
	}

	inv := &models.Invitation{
		ID:        uuid.New(),
		OrgID:     &req.OrgID,
		Email:     req.Email,
		Role:      req.Role,
		TokenHash: hash,
		InvitedBy: req.InviterID,
		ExpiresAt: time.Now().Add(72 * time.Hour),
		Status:    models.InvitePending,
		PlanIDs:   req.PlanIDs,
	}

	_, err = s.db.Exec(ctx,
		`INSERT INTO invitations (id, org_id, email, role, token_hash, invited_by, expires_at, status, plan_ids)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		inv.ID, inv.OrgID, inv.Email, inv.Role, inv.TokenHash,
		inv.InvitedBy, inv.ExpiresAt, inv.Status, inv.PlanIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("insert invitation: %w", err)
	}

	inviteLink := fmt.Sprintf("%s/accept-invite?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendUserInvite(req.Email, req.OrgName, req.InviterName, string(req.Role), inviteLink)

	slog.Info("user invite sent", "email", req.Email, "org_id", req.OrgID, "role", req.Role)
	return inv, nil
}

// ── List invitations ──────────────────────────────────────────────────────

// ListInvitations returns all invitations for an org, newest first.
func (s *Service) ListInvitations(ctx context.Context, orgID uuid.UUID) ([]models.Invitation, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, org_id, email, role, invited_by, expires_at, accepted_at, status, plan_ids, created_at, updated_at
		 FROM invitations WHERE org_id = $1 ORDER BY created_at DESC`,
		orgID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var invites []models.Invitation
	for rows.Next() {
		var inv models.Invitation
		if err := rows.Scan(
			&inv.ID, &inv.OrgID, &inv.Email, &inv.Role,
			&inv.InvitedBy, &inv.ExpiresAt, &inv.AcceptedAt,
			&inv.Status, &inv.PlanIDs, &inv.CreatedAt, &inv.UpdatedAt,
		); err != nil {
			return nil, err
		}
		invites = append(invites, inv)
	}
	return invites, rows.Err()
}

// ── Cancel invitation ─────────────────────────────────────────────────────

// CancelInvitation marks a pending invitation as cancelled. Only pending
// invitations for this org can be cancelled; accepted ones are immutable.
func (s *Service) CancelInvitation(ctx context.Context, inviteID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx,
		`UPDATE invitations SET status = 'cancelled', updated_at = NOW()
		 WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
		inviteID, orgID,
	)
	if err != nil {
		return fmt.Errorf("cancel invitation: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("invitation not found or already actioned")
	}
	return nil
}

// ── Resend invitation ─────────────────────────────────────────────────────

// ResendInvitation generates a fresh token, extends the expiry by 72 hours,
// and re-sends the invite email. Works on pending and expired invitations.
func (s *Service) ResendInvitation(ctx context.Context, inviteID, orgID uuid.UUID, orgName, inviterName string) error {
	var inv models.Invitation
	err := s.db.QueryRow(ctx,
		`SELECT id, email, role, status FROM invitations WHERE id = $1 AND org_id = $2`,
		inviteID, orgID,
	).Scan(&inv.ID, &inv.Email, &inv.Role, &inv.Status)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("invitation not found")
	}
	if err != nil {
		return err
	}
	if inv.Status == models.InviteAccepted {
		return fmt.Errorf("invitation has already been accepted")
	}

	plaintext, hash, err := auth.GenerateInviteToken()
	if err != nil {
		return err
	}

	_, err = s.db.Exec(ctx,
		`UPDATE invitations
		 SET token_hash = $1, expires_at = $2, status = 'pending', updated_at = NOW()
		 WHERE id = $3`,
		hash, time.Now().Add(72*time.Hour), inv.ID,
	)
	if err != nil {
		return fmt.Errorf("update invitation: %w", err)
	}

	inviteLink := fmt.Sprintf("%s/accept-invite?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendUserInvite(inv.Email, orgName, inviterName, string(inv.Role), inviteLink)
	return nil
}

// ── User management ───────────────────────────────────────────────────────

// UpdateUserRequest carries the fields an org admin can update.
// Both fields are optional — supply only what needs changing.
type UpdateUserRequest struct {
	Role     *models.Role `json:"role,omitempty"`
	IsActive *bool        `json:"is_active,omitempty"`
}

// UpdateUser updates a user's role and/or active status within the same org.
//
// Constraints enforced here (in addition to RBAC in the middleware):
//   - Cannot assign platform-level roles (super_admin, platform_support) via this endpoint.
//   - Deactivating a user immediately revokes all their active sessions.
func (s *Service) UpdateUser(ctx context.Context, userID, orgID uuid.UUID, req UpdateUserRequest) (*models.User, error) {
	if req.Role == nil && req.IsActive == nil {
		return nil, fmt.Errorf("nothing to update")
	}

	if req.Role != nil && req.Role.IsPlatformRole() {
		return nil, fmt.Errorf("cannot assign platform roles via org admin")
	}

	if req.Role != nil {
		result, err := s.db.Exec(ctx,
			`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Role, userID, orgID,
		)
		if err != nil {
			return nil, fmt.Errorf("update role: %w", err)
		}
		if result.RowsAffected() == 0 {
			return nil, fmt.Errorf("user not found in this organisation")
		}
		slog.Info("user role updated", "user_id", userID, "new_role", *req.Role)
	}

	if req.IsActive != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.IsActive, userID, orgID,
		); err != nil {
			return nil, fmt.Errorf("update is_active: %w", err)
		}
		// On deactivation, revoke all sessions immediately (REQ-F-009).
		if !*req.IsActive {
			if _, err := s.db.Exec(ctx,
				`UPDATE refresh_tokens SET revoked_at = NOW()
				 WHERE user_id = $1 AND revoked_at IS NULL`,
				userID); err != nil {
				// Non-fatal; log but don't fail the request.
				slog.Error("revoke sessions on deactivation", "user_id", userID, "err", err)
			}
			slog.Info("user deactivated, sessions revoked", "user_id", userID)
		}
	}

	// Reload and return the updated user.
	var u models.User
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, email, name, role, locale, is_active, created_at, updated_at
		 FROM users WHERE id = $1 AND org_id = $2`,
		userID, orgID,
	).Scan(&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role, &u.Locale, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("reload user: %w", err)
	}
	return &u, nil
}

// ListUsers returns all non-deleted users in the org, sorted by name.
func (s *Service) ListUsers(ctx context.Context, orgID uuid.UUID) ([]models.User, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, org_id, email, name, role, locale, is_active, last_login_at, created_at, updated_at
		 FROM users WHERE org_id = $1 AND deleted_at IS NULL ORDER BY name`,
		orgID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(
			&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role,
			&u.Locale, &u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// ── Helpers ───────────────────────────────────────────────────────────────

// slugify converts a string to a URL-safe lowercase slug.
// Non-alphanumeric characters are dropped; spaces and hyphens become hyphens.
func slugify(s string) string {
	result := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z':
			result = append(result, c+32)
		case (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'):
			result = append(result, c)
		case c == ' ' || c == '-':
			result = append(result, '-')
		}
	}
	return string(result)
}