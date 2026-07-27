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
//   - Fetch the caller's own profile and org (GET /org/me, GET /org)
//   - List the org's audit log (GET /org/audit-log)
package orgsvc

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

	// plan_ids is a NOT NULL uuid[] column. req.PlanIDs is nil for every
	// invite that isn't a plan-scoped viewer (org_admin, planner,
	// contributor, or a viewer with org-wide access) — pgx encodes a nil
	// Go slice as SQL NULL rather than an empty array, which the NOT NULL
	// constraint rejects. Normalise to an empty, non-nil slice so the
	// column always gets '{}' instead.
	planIDs := req.PlanIDs
	if planIDs == nil {
		planIDs = []uuid.UUID{}
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
		PlanIDs:   planIDs,
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

	inviteLink := fmt.Sprintf("%s/invitations/accept?token=%s", s.cfg.FrontendURL, plaintext)
	s.email.SendUserInvite(req.Email, req.OrgName, req.InviterName, string(req.Role), inviteLink, req.OrgID)

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

	inviteLink := fmt.Sprintf("%s/invitations/accept?token=%s", s.cfg.FrontendURL, plaintext)
	s.email.SendUserInvite(inv.Email, orgName, inviterName, string(inv.Role), inviteLink, orgID)
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
// actorID is the org admin performing the change; it is recorded in the
// audit log alongside the change itself.
//
// Constraints enforced here (in addition to RBAC in the middleware):
//   - Cannot assign platform-level roles (super_admin, platform_support) via this endpoint.
//   - Deactivating a user immediately revokes all their active sessions.
func (s *Service) UpdateUser(ctx context.Context, userID, orgID, actorID uuid.UUID, req UpdateUserRequest) (*models.User, error) {
	if req.Role == nil && req.IsActive == nil {
		return nil, fmt.Errorf("nothing to update")
	}

	if req.Role != nil && req.Role.IsPlatformRole() {
		return nil, fmt.Errorf("cannot assign platform roles via org admin")
	}

	// Capture prior state for the audit diff, and the user's email for the
	// role-changed notification below.
	var priorRole models.Role
	var priorActive bool
	var userEmail string
	_ = s.db.QueryRow(ctx,
		`SELECT role, is_active, email FROM users WHERE id = $1 AND org_id = $2`,
		userID, orgID).Scan(&priorRole, &priorActive, &userEmail)

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
		auditlog.Record(ctx, s.db, auditlog.Entry{
			OrgID: orgID, UserID: actorID, Action: "user.role_changed",
			TableName: "users", RecordID: userID,
			Diff: map[string]any{"role": map[string]string{"from": string(priorRole), "to": string(*req.Role)}},
		})
		if userEmail != "" {
			orgName, _ := s.GetOrgAndUserNames(ctx, orgID, userID)
			s.email.SendRoleChanged(userEmail, orgName, string(*req.Role), orgID, userID)
		}
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
		auditlog.Record(ctx, s.db, auditlog.Entry{
			OrgID: orgID, UserID: actorID, Action: "user.active_status_changed",
			TableName: "users", RecordID: userID,
			Diff: map[string]any{"is_active": map[string]bool{"from": priorActive, "to": *req.IsActive}},
		})
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

// ── Caller profile / org lookup ───────────────────────────────────────────
//
// These back GET /api/v1/org/me and GET /api/v1/org, both required by
// LoginPage.tsx (real mode) after exchanging tokens. Neither is role-gated —
// any authenticated org user (including viewers) can read their own profile
// and their own org's public details.

// GetUserByID fetches a single user by ID with no org filter — the handler
// derives the ID from the caller's own JWT claims, so there is no
// cross-tenant read risk here (a user can only ever ask for themselves).
func (s *Service) GetUserByID(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	var u models.User
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, email, name, role, locale, is_active, last_login_at, created_at, updated_at
		 FROM users WHERE id = $1 AND deleted_at IS NULL`,
		userID,
	).Scan(&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role, &u.Locale, &u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	return &u, nil
}

// GetOrgByID fetches an organisation's public details for display in the
// caller's own app shell (name, logo, locale, etc), including the
// self-service profile fields (address, country, contact info, structure,
// member count) an org_admin fills in via UpdateOrgProfile below.
func (s *Service) GetOrgByID(ctx context.Context, orgID uuid.UUID) (*models.Organisation, error) {
	var org models.Organisation
	err := s.db.QueryRow(ctx,
		`SELECT id, name, slug, logo_url, locale, industry, is_active,
		        address, country, contact_email, contact_phone, org_structure, total_members,
		        created_at, updated_at
		 FROM organisations WHERE id = $1 AND deleted_at IS NULL`,
		orgID,
	).Scan(&org.ID, &org.Name, &org.Slug, &org.LogoURL, &org.Locale, &org.Industry, &org.IsActive,
		&org.Address, &org.Country, &org.ContactEmail, &org.ContactPhone, &org.OrgStructure, &org.TotalMembers,
		&org.CreatedAt, &org.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("organisation not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get organisation: %w", err)
	}
	return &org, nil
}

// ── Org profile (self-service) ────────────────────────────────────────────

// UpdateOrgProfileRequest carries the fields an org_admin can set about
// their own organisation. Every field is optional — supply only what needs
// changing. Unlike adminsvc.UpdateOrgRequest (platform-level: name,
// is_active), this never touches Name or IsActive — an org can describe
// itself, but renaming or (de)activating the org is a platform_admin action.
type UpdateOrgProfileRequest struct {
	Industry     *string `json:"industry,omitempty"`
	Address      *string `json:"address,omitempty"`
	Country      *string `json:"country,omitempty"`
	ContactEmail *string `json:"contact_email,omitempty"`
	ContactPhone *string `json:"contact_phone,omitempty"`
	OrgStructure *string `json:"org_structure,omitempty"`
	TotalMembers *int    `json:"total_members,omitempty"`
}

// UpdateOrgProfile lets an org_admin fill in/edit descriptive information
// about their own organisation. This context is picked up by the AI service
// (see aisvc.buildOrgContextSection in context.go) and folded into every
// draft/summary/suggest-links prompt, so the model grounds its output in
// what kind of organisation it's actually writing for instead of guessing.
//
// actorID is the org_admin performing the change, recorded in the audit log.
func (s *Service) UpdateOrgProfile(ctx context.Context, orgID, actorID uuid.UUID, req UpdateOrgProfileRequest) (*models.Organisation, error) {
	if req.Industry == nil && req.Address == nil && req.Country == nil &&
		req.ContactEmail == nil && req.ContactPhone == nil &&
		req.OrgStructure == nil && req.TotalMembers == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.TotalMembers != nil && *req.TotalMembers < 0 {
		return nil, fmt.Errorf("total_members cannot be negative")
	}

	var exists int
	err := s.db.QueryRow(ctx,
		`SELECT 1 FROM organisations WHERE id = $1 AND deleted_at IS NULL`, orgID,
	).Scan(&exists)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("organisation not found")
	}
	if err != nil {
		return nil, fmt.Errorf("fetch org: %w", err)
	}

	_, err = s.db.Exec(ctx,
		`UPDATE organisations SET
		    industry       = COALESCE($1, industry),
		    address        = COALESCE($2, address),
		    country        = COALESCE($3, country),
		    contact_email  = COALESCE($4, contact_email),
		    contact_phone  = COALESCE($5, contact_phone),
		    org_structure  = COALESCE($6, org_structure),
		    total_members  = COALESCE($7, total_members),
		    updated_at     = NOW()
		 WHERE id = $8`,
		req.Industry, req.Address, req.Country, req.ContactEmail, req.ContactPhone,
		req.OrgStructure, req.TotalMembers, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("update org profile: %w", err)
	}

	auditlog.Record(ctx, s.db, auditlog.Entry{
		OrgID: orgID, UserID: actorID, Action: "organisation.profile_updated",
		TableName: "organisations", RecordID: orgID,
	})

	return s.GetOrgByID(ctx, orgID)
}

// ── Audit log ──────────────────────────────────────────────────────────────

// AuditLogParams carries the filters and pagination for ListAuditLog.
// UserID, Action, TableName, From, and To are all optional string filters —
// empty string means "no filter" for that field. From/To are expected to be
// ISO-8601 timestamps; invalid values are ignored rather than erroring, so a
// malformed query param degrades to "no filter" instead of a 400.
type AuditLogParams struct {
	OrgID     uuid.UUID
	UserID    string
	Action    string
	TableName string
	From      string
	To        string
	Limit     int
	Offset    int
}

// AuditLogEntry adds display-only fields the admin UI needs (avoids a
// second round trip to resolve the actor's name/email per row).
type AuditLogEntry struct {
	models.AuditLog
	UserName  string `json:"user_name"`
	UserEmail string `json:"user_email"`
}

type AuditLogResult struct {
	Logs   []AuditLogEntry `json:"logs"`
	Total  int             `json:"total"`
	Limit  int             `json:"limit"`
	Offset int             `json:"offset"`
}

// ListAuditLog returns a filtered, paginated slice of audit log entries for
// an org, newest first, along with the total matching row count (for the UI
// to compute pagination) regardless of Limit/Offset.
func (s *Service) ListAuditLog(ctx context.Context, params AuditLogParams) (*AuditLogResult, error) {
	if params.Limit <= 0 {
		params.Limit = 50
	}
	if params.Offset < 0 {
		params.Offset = 0
	}

	where := `WHERE a.org_id = $1`
	args := []any{params.OrgID}

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
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_log a `+where, args...,
	).Scan(&total); err != nil {
		return nil, fmt.Errorf("count audit log: %w", err)
	}

	args = append(args, params.Limit, params.Offset)
	query := fmt.Sprintf(
		`SELECT a.id, a.org_id, a.user_id, a.action, a.table_name, a.record_id, a.diff, a.created_at,
		        COALESCE(u.name, 'Unknown user') AS user_name,
		        COALESCE(u.email, '')            AS user_email
		 FROM audit_log a
		 LEFT JOIN users u ON u.id = a.user_id
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
			&e.UserName, &e.UserEmail,
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

// ── Helpers ───────────────────────────────────────────────────────────────
//
// Note: org creation (and its slugify helper) lives in the admin service —
// org admins manage existing orgs, they don't create new ones.
