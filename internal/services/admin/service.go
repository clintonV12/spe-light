// Package adminsvc implements platform-level operations performed by super_admin
// and platform_support users.
//
// These operations are cross-org: listing all organisations, creating
// organisations, activating/deactivating them, and sending the initial
// org-setup invitation to a new org admin contact (REQ-F-005).
//
// Important: platform_support can only READ. Mutations (create, update, invite)
// are restricted to super_admin. This is enforced at the router level via
// middleware.RequireRole, not here.
package adminsvc

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"spe-light/internal/auditlog"
	"spe-light/internal/auth"
	"spe-light/internal/config"
	"spe-light/internal/email"
	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service handles platform-level admin operations.
type Service struct {
	db    *pgxpool.Pool
	cfg   *config.Config
	email *email.Service
}

// New creates an admin Service.
func New(db *pgxpool.Pool, cfg *config.Config, emailSvc *email.Service) *Service {
	return &Service{db: db, cfg: cfg, email: emailSvc}
}

// ── List orgs ─────────────────────────────────────────────────────────────

// ListOrgsRequest supports optional filtering/pagination.
type ListOrgsRequest struct {
	ActiveOnly bool
	Limit      int // 0 = use default (50)
	Offset     int
}

// ListOrgs returns all organisations visible to a platform admin, with
// optional filtering by active status.
func (s *Service) ListOrgs(ctx context.Context, req ListOrgsRequest) ([]models.Organisation, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}

	query := `SELECT id, name, slug, logo_url, locale, industry, is_active, created_at, updated_at
	          FROM organisations WHERE deleted_at IS NULL`
	args := []any{}

	if req.ActiveOnly {
		args = append(args, true)
		query += fmt.Sprintf(" AND is_active = $%d", len(args))
	}

	args = append(args, limit, req.Offset)
	query += fmt.Sprintf(" ORDER BY name LIMIT $%d OFFSET $%d", len(args)-1, len(args))

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list orgs: %w", err)
	}
	defer rows.Close()

	var orgs []models.Organisation
	for rows.Next() {
		var o models.Organisation
		if err := rows.Scan(
			&o.ID, &o.Name, &o.Slug, &o.LogoURL, &o.Locale,
			&o.Industry, &o.IsActive, &o.CreatedAt, &o.UpdatedAt,
		); err != nil {
			return nil, err
		}
		orgs = append(orgs, o)
	}
	return orgs, rows.Err()
}

// ── Create org ────────────────────────────────────────────────────────────

// CreateOrgRequest holds the fields for creating a new organisation directly
// (without the invitation flow).
type CreateOrgRequest struct {
	Name     string  `json:"name"`
	Industry *string `json:"industry,omitempty"`
	Locale   string  `json:"locale,omitempty"`
}

// CreateOrg creates a new, active organisation. Use this when the super admin
// wants to create an org and manually add users, rather than sending an invite.
func (s *Service) CreateOrg(ctx context.Context, req CreateOrgRequest) (*models.Organisation, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("organisation name is required")
	}
	locale := req.Locale
	if locale == "" {
		locale = "en"
	}

	id := uuid.New()
	slug := slugify(req.Name) + "-" + id.String()[:8]

	org := &models.Organisation{
		ID:       id,
		Name:     req.Name,
		Slug:     slug,
		Locale:   locale,
		Industry: req.Industry,
		IsActive: true,
	}

	err := s.db.QueryRow(ctx,
		`INSERT INTO organisations (id, name, slug, locale, industry, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING created_at, updated_at`,
		org.ID, org.Name, org.Slug, org.Locale, org.Industry, org.IsActive,
	).Scan(&org.CreatedAt, &org.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create organisation: %w", err)
	}

	slog.Info("organisation created", "org_id", org.ID, "name", org.Name)
	return org, nil
}

// ── Update org ────────────────────────────────────────────────────────────

// UpdateOrgRequest carries the mutable fields for an org.
// Only non-nil fields are updated (partial update pattern).
type UpdateOrgRequest struct {
	Name     *string `json:"name,omitempty"`
	IsActive *bool   `json:"is_active,omitempty"`
	Industry *string `json:"industry,omitempty"`
	Locale   *string `json:"locale,omitempty"`
}

// UpdateOrg applies a partial update to an organisation.
//
// actorID is the platform admin performing the change, recorded in the audit log.
//
// When deactivating (is_active = false):
//   - All refresh tokens for users in this org are revoked immediately.
//   - Active sessions are terminated on the next API call (JWT expires naturally).
//   - Org admin email notification is sent.
func (s *Service) UpdateOrg(ctx context.Context, orgID, actorID uuid.UUID, req UpdateOrgRequest) (*models.Organisation, error) {
	if req.Name == nil && req.IsActive == nil && req.Industry == nil && req.Locale == nil {
		return nil, fmt.Errorf("nothing to update")
	}

	// Fetch current org to compare is_active before and after.
	var currentActive bool
	err := s.db.QueryRow(ctx,
		`SELECT is_active FROM organisations WHERE id = $1 AND deleted_at IS NULL`, orgID,
	).Scan(&currentActive)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("organisation not found")
	}
	if err != nil {
		return nil, fmt.Errorf("fetch org: %w", err)
	}

	if req.Name != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE organisations SET name = $1, updated_at = NOW() WHERE id = $2`,
			*req.Name, orgID); err != nil {
			return nil, fmt.Errorf("update name: %w", err)
		}
	}
	if req.Industry != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE organisations SET industry = $1, updated_at = NOW() WHERE id = $2`,
			*req.Industry, orgID); err != nil {
			return nil, fmt.Errorf("update industry: %w", err)
		}
	}
	if req.Locale != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE organisations SET locale = $1, updated_at = NOW() WHERE id = $2`,
			*req.Locale, orgID); err != nil {
			return nil, fmt.Errorf("update locale: %w", err)
		}
	}
	if req.IsActive != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE organisations SET is_active = $1, updated_at = NOW() WHERE id = $2`,
			*req.IsActive, orgID); err != nil {
			return nil, fmt.Errorf("update is_active: %w", err)
		}
		auditlog.Record(ctx, s.db, auditlog.Entry{
			OrgID: orgID, UserID: actorID, Action: "organisation.active_status_changed",
			TableName: "organisations", RecordID: orgID,
			Diff: map[string]any{"is_active": map[string]bool{"from": currentActive, "to": *req.IsActive}},
		})
		// If the org is being deactivated, revoke all sessions for its users
		// and notify org admins (REQ-F-005).
		if !*req.IsActive && currentActive {
			s.deactivateOrgSessions(ctx, orgID)
		}
	}

	// Reload the full record to return accurate data.
	var org models.Organisation
	err = s.db.QueryRow(ctx,
		`SELECT id, name, slug, logo_url, locale, industry, is_active, created_at, updated_at
		 FROM organisations WHERE id = $1`,
		orgID,
	).Scan(&org.ID, &org.Name, &org.Slug, &org.LogoURL, &org.Locale,
		&org.Industry, &org.IsActive, &org.CreatedAt, &org.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("reload org: %w", err)
	}
	return &org, nil
}

// deactivateOrgSessions revokes all refresh tokens for users in the org and
// sends deactivation emails to org admins. Errors are logged, not returned,
// because the DB update has already committed.
func (s *Service) deactivateOrgSessions(ctx context.Context, orgID uuid.UUID) {
	_, err := s.db.Exec(ctx,
		`UPDATE refresh_tokens rt
		 SET revoked_at = NOW()
		 FROM users u
		 WHERE rt.user_id = u.id AND u.org_id = $1 AND rt.revoked_at IS NULL`,
		orgID,
	)
	if err != nil {
		slog.Error("revoke sessions on org deactivation", "org_id", orgID, "err", err)
	}
	slog.Info("org deactivated, all sessions revoked", "org_id", orgID)

	// Notify org admins.
	rows, err := s.db.Query(ctx,
		`SELECT u.email, o.name FROM users u
		 JOIN organisations o ON o.id = u.org_id
		 WHERE u.org_id = $1 AND u.role = 'org_admin' AND u.deleted_at IS NULL`,
		orgID,
	)
	if err != nil {
		slog.Error("fetch org admins for deactivation email", "org_id", orgID, "err", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var adminEmail, orgName string
		if err := rows.Scan(&adminEmail, &orgName); err == nil {
			s.email.SendOrgDeactivated(adminEmail, orgName)
		}
	}
}

// ── Org invitation ────────────────────────────────────────────────────────

// SendOrgInviteRequest holds the details for a platform-level org invitation.
type SendOrgInviteRequest struct {
	Email       string    `json:"email"`
	OrgName     string    `json:"org_name"`
	InviterID   uuid.UUID // set by the handler from JWT claims
	InviterName string    // looked up by the handler
}

// SendOrgInvite creates a pending (inactive) organisation, generates an
// invitation token, and emails the link to the designated org admin contact.
// The recipient clicks the link to complete org setup (REQ-F-005).
func (s *Service) SendOrgInvite(ctx context.Context, req SendOrgInviteRequest) (*models.Invitation, error) {
	if req.Email == "" || req.OrgName == "" {
		return nil, fmt.Errorf("email and org_name are required")
	}

	// Create the org in an inactive state; it activates when the invite is accepted.
	orgID := uuid.New()
	slug := slugify(req.OrgName) + "-" + orgID.String()[:8]

	if _, err := s.db.Exec(ctx,
		`INSERT INTO organisations (id, name, slug, locale, is_active)
		 VALUES ($1, $2, $3, 'en', false)`,
		orgID, req.OrgName, slug,
	); err != nil {
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

	if _, err = s.db.Exec(ctx,
		`INSERT INTO invitations (id, org_id, email, role, token_hash, invited_by, expires_at, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		inv.ID, inv.OrgID, inv.Email, inv.Role,
		inv.TokenHash, inv.InvitedBy, inv.ExpiresAt, inv.Status,
	); err != nil {
		return nil, fmt.Errorf("insert org invitation: %w", err)
	}

	inviteLink := fmt.Sprintf("%s/setup-org?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendOrgInvite(req.Email, req.OrgName, req.InviterName, inviteLink)

	slog.Info("org invite sent", "email", req.Email, "org_id", orgID, "org_name", req.OrgName)
	return inv, nil
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
