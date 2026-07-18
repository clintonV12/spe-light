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

// AuditLogParams filters audit entries across all orgs (OrgID nil = every org).
type AuditLogParams struct {
	OrgID     *uuid.UUID
	UserID    string
	Action    string
	TableName string
	From      string
	To        string
	Limit     int
	Offset    int
}

type AuditLogEntry struct {
	models.AuditLog
	UserName  string `json:"user_name"`
	UserEmail string `json:"user_email"`
	OrgName   string `json:"org_name"`
}

type AuditLogResult struct {
	Logs   []AuditLogEntry `json:"logs"`
	Total  int             `json:"total"`
	Limit  int             `json:"limit"`
	Offset int             `json:"offset"`
}

// ListAuditLog returns audit entries platform-wide (super_admin / platform_support).
func (s *Service) ListAuditLog(ctx context.Context, params AuditLogParams) (*AuditLogResult, error) {
	if params.Limit <= 0 {
		params.Limit = 50
	}
	if params.Offset < 0 {
		params.Offset = 0
	}

	where := `WHERE 1=1`
	args := []any{}

	if params.OrgID != nil {
		args = append(args, *params.OrgID)
		where += fmt.Sprintf(" AND a.org_id = $%d", len(args))
	}
	if params.UserID != "" {
		if uid, err := uuid.Parse(params.UserID); err == nil {
			args = append(args, uid)
			where += fmt.Sprintf(" AND a.user_id = $%d", len(args))
		}
	}
	if params.Action != "" {
		args = append(args, params.Action)
		where += fmt.Sprintf(" AND a.action = $%d", len(args))
	}
	if params.TableName != "" {
		args = append(args, params.TableName)
		where += fmt.Sprintf(" AND a.table_name = $%d", len(args))
	}
	if params.From != "" {
		if from, err := time.Parse(time.RFC3339, params.From); err == nil {
			args = append(args, from)
			where += fmt.Sprintf(" AND a.created_at >= $%d", len(args))
		}
	}
	if params.To != "" {
		if to, err := time.Parse(time.RFC3339, params.To); err == nil {
			args = append(args, to)
			where += fmt.Sprintf(" AND a.created_at <= $%d", len(args))
		}
	}

	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM audit_log a `+where, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count audit log: %w", err)
	}

	args = append(args, params.Limit, params.Offset)
	query := fmt.Sprintf(
		`SELECT a.id, a.org_id, a.user_id, a.action, a.table_name, a.record_id, a.diff, a.created_at,
		        COALESCE(u.name, 'Unknown user') AS user_name,
		        COALESCE(u.email, '')            AS user_email,
		        COALESCE(o.name, 'Unknown org')  AS org_name
		 FROM audit_log a
		 LEFT JOIN users         u ON u.id = a.user_id
		 LEFT JOIN organisations o ON o.id = a.org_id
		 %s ORDER BY a.created_at DESC LIMIT $%d OFFSET $%d`,
		where, len(args)-1, len(args),
	)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list audit log: %w", err)
	}
	defer rows.Close()

	logs := []AuditLogEntry{}
	for rows.Next() {
		var e AuditLogEntry
		if err := rows.Scan(
			&e.ID, &e.OrgID, &e.UserID, &e.Action, &e.TableName, &e.RecordID, &e.Diff, &e.CreatedAt,
			&e.UserName, &e.UserEmail, &e.OrgName,
		); err != nil {
			return nil, err
		}
		logs = append(logs, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &AuditLogResult{Logs: logs, Total: total, Limit: params.Limit, Offset: params.Offset}, nil
}

// ── Platform user management ─────────────────────────────────────────────
//
// Platform-tier users (super_admin, platform_support) have org_id = NULL
// (migration 003). Invitations for them reuse the invitations table with
// org_id left genuinely NULL — distinct from the org-onboarding invite
// above, which always sets org_id to the newly-created pending org.
// authsvc.AcceptInvite already branches correctly on inv.OrgID == nil
// (it only activates an org when inv.OrgID != nil), so no changes were
// needed there.

// InvitePlatformUserRequest invites a new platform-tier teammate.
type InvitePlatformUserRequest struct {
	Email       string      `json:"email"`
	Role        models.Role `json:"role"` // must be super_admin or platform_support
	InviterID   uuid.UUID   // set by the handler from JWT claims
	InviterName string      // looked up by the handler
}

// InvitePlatformUser sends a platform-team invite. Only callable by
// super_admin — enforced at the router level, checked again here as
// defense in depth since granting platform access is high-privilege.
func (s *Service) InvitePlatformUser(ctx context.Context, req InvitePlatformUserRequest) (*models.Invitation, error) {
	if req.Email == "" {
		return nil, fmt.Errorf("email is required")
	}
	if !req.Role.IsPlatformRole() {
		return nil, fmt.Errorf("role must be super_admin or platform_support")
	}

	// Refuse if an active platform-tier account already exists for this email.
	var exists bool
	_ = s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND org_id IS NULL AND deleted_at IS NULL)`,
		req.Email,
	).Scan(&exists)
	if exists {
		return nil, fmt.Errorf("a platform account already exists for this email")
	}

	plaintext, hash, err := auth.GenerateInviteToken()
	if err != nil {
		return nil, err
	}

	inv := &models.Invitation{
		ID:        uuid.New(),
		OrgID:     nil, // genuinely NULL — platform-tier, not org-onboarding
		Email:     req.Email,
		Role:      req.Role,
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
		return nil, fmt.Errorf("insert platform invitation: %w", err)
	}

	inviteLink := fmt.Sprintf("%s/invitations/accept?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendPlatformUserInvite(req.Email, string(req.Role), req.InviterName, inviteLink)

	slog.Info("platform user invited", "email", req.Email, "role", req.Role, "invited_by", req.InviterID)
	return inv, nil
}

// ListPlatformUsers returns every platform-tier user (org_id IS NULL).
func (s *Service) ListPlatformUsers(ctx context.Context) ([]models.User, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, org_id, email, name, role, locale, is_active, last_login_at, created_at, updated_at
		 FROM users WHERE org_id IS NULL AND deleted_at IS NULL ORDER BY created_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("list platform users: %w", err)
	}
	defer rows.Close()

	users := []models.User{}
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role,
			&u.Locale, &u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// ListPlatformInvitations returns invitations for platform-tier accounts
// (pending, accepted, cancelled, expired — the console filters by status).
func (s *Service) ListPlatformInvitations(ctx context.Context) ([]models.Invitation, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, org_id, email, role, invited_by, expires_at, accepted_at, status, created_at, updated_at
		 FROM invitations WHERE org_id IS NULL ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list platform invitations: %w", err)
	}
	defer rows.Close()

	invs := []models.Invitation{}
	for rows.Next() {
		var inv models.Invitation
		if err := rows.Scan(&inv.ID, &inv.OrgID, &inv.Email, &inv.Role, &inv.InvitedBy,
			&inv.ExpiresAt, &inv.AcceptedAt, &inv.Status, &inv.CreatedAt, &inv.UpdatedAt); err != nil {
			return nil, err
		}
		invs = append(invs, inv)
	}
	return invs, rows.Err()
}

// CancelPlatformInvitation cancels a pending platform-tier invitation.
func (s *Service) CancelPlatformInvitation(ctx context.Context, invID uuid.UUID) error {
	result, err := s.db.Exec(ctx,
		`UPDATE invitations SET status = 'cancelled', updated_at = NOW()
		 WHERE id = $1 AND org_id IS NULL AND status = 'pending'`,
		invID,
	)
	if err != nil {
		return fmt.Errorf("cancel platform invitation: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("no pending platform invitation found")
	}
	return nil
}

// ResendPlatformInvitation issues a fresh token and expiry for an existing
// platform invitation (pending, cancelled, or expired) and re-sends the email.
func (s *Service) ResendPlatformInvitation(ctx context.Context, invID uuid.UUID, inviterName string) error {
	var email string
	var role models.Role
	err := s.db.QueryRow(ctx,
		`SELECT email, role FROM invitations WHERE id = $1 AND org_id IS NULL`,
		invID,
	).Scan(&email, &role)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("platform invitation not found")
	}
	if err != nil {
		return fmt.Errorf("fetch invitation: %w", err)
	}

	plaintext, hash, err := auth.GenerateInviteToken()
	if err != nil {
		return err
	}

	if _, err = s.db.Exec(ctx,
		`UPDATE invitations
		 SET token_hash = $1, expires_at = $2, status = 'pending', updated_at = NOW()
		 WHERE id = $3`,
		hash, time.Now().Add(7*24*time.Hour), invID,
	); err != nil {
		return fmt.Errorf("update invitation: %w", err)
	}

	inviteLink := fmt.Sprintf("%s/invitations/accept?token=%s", s.cfg.AppURL, plaintext)
	s.email.SendPlatformUserInvite(email, string(role), inviterName, inviteLink)
	return nil
}

// UpdatePlatformUserRequest carries mutable fields for a platform-tier user.
type UpdatePlatformUserRequest struct {
	Role     *models.Role `json:"role,omitempty"`
	IsActive *bool        `json:"is_active,omitempty"`
}

// UpdatePlatformUser changes a platform-tier user's role or active status.
// A user may not target themselves — prevents a super_admin from locking
// themselves out or self-demoting with nobody left to reverse it.
func (s *Service) UpdatePlatformUser(ctx context.Context, userID, actorID uuid.UUID, req UpdatePlatformUserRequest) (*models.User, error) {
	if req.Role == nil && req.IsActive == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if userID == actorID {
		return nil, fmt.Errorf("cannot change your own platform role or active status")
	}
	if req.Role != nil && !req.Role.IsPlatformRole() {
		return nil, fmt.Errorf("role must be super_admin or platform_support")
	}

	if req.Role != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND org_id IS NULL`,
			*req.Role, userID); err != nil {
			return nil, fmt.Errorf("update role: %w", err)
		}
	}
	if req.IsActive != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 AND org_id IS NULL`,
			*req.IsActive, userID); err != nil {
			return nil, fmt.Errorf("update is_active: %w", err)
		}
		if !*req.IsActive {
			if _, err := s.db.Exec(ctx,
				`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
				userID); err != nil {
				slog.Error("revoke sessions on platform user deactivation", "user_id", userID, "err", err)
			}
		}
	}

	var u models.User
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, email, name, role, locale, is_active, last_login_at, created_at, updated_at
		 FROM users WHERE id = $1 AND org_id IS NULL`,
		userID,
	).Scan(&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role, &u.Locale, &u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("reload platform user: %w", err)
	}
	return &u, nil
}
