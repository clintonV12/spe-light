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

type Service struct {
	db    *pgxpool.Pool
	cfg   *config.Config
	email *email.Service
}

func New(db *pgxpool.Pool, cfg *config.Config, emailSvc *email.Service) *Service {
	return &Service{db: db, cfg: cfg, email: emailSvc}
}

// ── Invite user to org ────────────────────────────────────────────────────

type SendInviteRequest struct {
	Email       string      `json:"email"`
	Role        models.Role `json:"role"`
	PlanIDs     []uuid.UUID `json:"plan_ids,omitempty"` // non-empty = plan-scoped viewer
	InviterID   uuid.UUID
	OrgID       uuid.UUID
	OrgName     string
	InviterName string
}

func (s *Service) SendUserInvite(ctx context.Context, req SendInviteRequest) (*models.Invitation, error) {
	// Validate role — cannot invite super_admin or platform_support via org invite
	switch req.Role {
	case models.RoleOrgAdmin, models.RolePlanner, models.RoleContributor, models.RoleViewer:
		// allowed
	default:
		return nil, fmt.Errorf("invalid role for org invite: %s", req.Role)
	}

	// Check no pending invite already exists for this email+org
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

// ── Platform: invite org ──────────────────────────────────────────────────

type SendOrgInviteRequest struct {
	Email       string
	OrgName     string
	InviterID   uuid.UUID
	InviterName string
}

func (s *Service) SendOrgInvite(ctx context.Context, req SendOrgInviteRequest) (*models.Invitation, error) {
	// Create a pending org record (inactive until accepted)
	orgID := uuid.New()
	_, err := s.db.Exec(ctx,
		`INSERT INTO organisations (id, name, slug, locale, is_active)
		 VALUES ($1, $2, $3, 'en', false)`,
		orgID, req.OrgName, slugify(req.OrgName)+"-"+orgID.String()[:8],
	)
	if err != nil {
		return nil, fmt.Errorf("create pending org: %w", err)
	}

	plaintext, hash, err := auth.GenerateInviteToken()
	if err != nil {
		return nil, err
	}

	inv := &models.Invitation{
		ID:        uuid.New(),
		OrgID:     &orgID,
		Email:     req.Email,
		Role:      models.RoleOrgAdmin,
		TokenHash: hash,
		InvitedBy: req.InviterID,
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
		Status:    models.InvitePending,
	}

	_, err = s.db.Exec(ctx,
		`INSERT INTO invitations (id, org_id, email, role, token_hash, invited_by, expires_at, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		inv.ID, inv.OrgID, inv.Email, inv.Role,
		inv.TokenHash, inv.InvitedBy, inv.ExpiresAt, inv.Status,
	)
	if err != nil {
		return nil, fmt.Errorf("insert org invitation: %w", err)
	}

	inviteLink := fmt.Sprintf("%s/setup-org?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendOrgInvite(req.Email, req.OrgName, req.InviterName, inviteLink)

	slog.Info("org invite sent", "email", req.Email, "org_id", orgID)
	return inv, nil
}

// ── List invitations ──────────────────────────────────────────────────────

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

	newExpiry := time.Now().Add(72 * time.Hour)
	_, err = s.db.Exec(ctx,
		`UPDATE invitations
		 SET token_hash = $1, expires_at = $2, status = 'pending', updated_at = NOW()
		 WHERE id = $3`,
		hash, newExpiry, inv.ID,
	)
	if err != nil {
		return fmt.Errorf("update invitation: %w", err)
	}

	inviteLink := fmt.Sprintf("%s/accept-invite?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendUserInvite(inv.Email, orgName, inviterName, string(inv.Role), inviteLink)
	return nil
}

// ── User management ───────────────────────────────────────────────────────

type UpdateUserRequest struct {
	Role     *models.Role `json:"role,omitempty"`
	IsActive *bool        `json:"is_active,omitempty"`
}

func (s *Service) UpdateUser(ctx context.Context, userID, orgID uuid.UUID, req UpdateUserRequest) (*models.User, error) {
	if req.Role == nil && req.IsActive == nil {
		return nil, fmt.Errorf("nothing to update")
	}

	// Prevent promoting to platform roles via org admin
	if req.Role != nil && req.Role.IsPlatformRole() {
		return nil, fmt.Errorf("cannot assign platform roles via org admin")
	}

	if req.Role != nil {
		_, err := s.db.Exec(ctx,
			`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Role, userID, orgID,
		)
		if err != nil {
			return nil, fmt.Errorf("update role: %w", err)
		}
		slog.Info("user role updated", "user_id", userID, "new_role", *req.Role)
	}

	if req.IsActive != nil {
		_, err := s.db.Exec(ctx,
			`UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.IsActive, userID, orgID,
		)
		if err != nil {
			return nil, fmt.Errorf("update is_active: %w", err)
		}
		// Revoke all sessions if deactivating
		if !*req.IsActive {
			_, _ = s.db.Exec(ctx,
				`UPDATE refresh_tokens SET revoked_at = NOW()
				 WHERE user_id = $1 AND revoked_at IS NULL`, userID)
			slog.Info("user deactivated, sessions revoked", "user_id", userID)
		}
	}

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

func slugify(s string) string {
	result := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			result = append(result, c+32)
		} else if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			result = append(result, c)
		} else if c == ' ' || c == '-' {
			result = append(result, '-')
		}
	}
	return string(result)
}
