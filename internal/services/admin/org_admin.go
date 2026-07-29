// org_admin.go — platform admin's single-organisation view and deletion.
//
// Distinct from ListOrgs/CreateOrg/UpdateOrg (already in this package): this
// is the "drill into one org" surface a system administrator needs —  the
// fuller profile (address, contacts, industry, structure, member count —
// see orgsvc.UpdateOrgProfile) plus enough summary counts to judge an org's
// size/activity without impersonating into it, and the ability to remove an
// org entirely once it's no longer needed.
//
// Routes wired in router.go:
//
//	GET    /api/v1/admin/orgs/{orgID}   — super_admin or platform_support
//	DELETE /api/v1/admin/orgs/{orgID}   — super_admin only
package adminsvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// OrgDetail is the platform admin's full view of a single organisation:
// the same Organisation shape ListOrgs/CreateOrg/UpdateOrg already return
// (now including the self-service profile fields), plus summary counts.
type OrgDetail struct {
	models.Organisation
	UserCount       int `json:"user_count"`
	PlanCount       int `json:"plan_count"`
	ActivePlanCount int `json:"active_plan_count"`
}

// GetOrgDetail fetches one organisation plus summary counts for the
// platform admin console's org detail view. Read-only — available to both
// super_admin and platform_support (route-gated the same as the rest of
// /api/v1/admin), unlike DeleteOrg below.
func (s *Service) GetOrgDetail(ctx context.Context, orgID uuid.UUID) (*OrgDetail, error) {
	var d OrgDetail
	err := s.db.QueryRow(ctx,
		`SELECT id, name, slug, logo_url, locale, industry, is_active,
		        address, country, contact_email, contact_phone, org_structure, total_members,
		        created_at, updated_at
		 FROM organisations WHERE id = $1 AND deleted_at IS NULL`,
		orgID,
	).Scan(
		&d.ID, &d.Name, &d.Slug, &d.LogoURL, &d.Locale, &d.Industry, &d.IsActive,
		&d.Address, &d.Country, &d.ContactEmail, &d.ContactPhone, &d.OrgStructure, &d.TotalMembers,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("organisation not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get organisation: %w", err)
	}

	// Best-effort — an org with zero of something isn't an error, and a
	// failed count shouldn't hide the org profile itself.
	_ = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE org_id = $1 AND deleted_at IS NULL`, orgID,
	).Scan(&d.UserCount)
	_ = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM plans WHERE org_id = $1 AND deleted_at IS NULL`, orgID,
	).Scan(&d.PlanCount)
	_ = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM plans WHERE org_id = $1 AND deleted_at IS NULL AND status = 'active'`, orgID,
	).Scan(&d.ActivePlanCount)

	return &d, nil
}

// DeleteOrg soft-deletes an organisation. super_admin only (route-gated) —
// this is a serious, hard-to-reverse action for every user in that org.
//
// Requires the org to already be deactivated first: deleting a still-active
// org in one step is too easy to do by accident from a list view, and
// deactivating first gives everyone in that org an immediate, visible signal
// (locked out of login) before the org disappears from the platform admin
// console entirely. Nothing else cascades — the org's plans, activities and
// users all remain in the database exactly as every other soft-delete in
// this codebase works; they simply become unreachable through the normal
// org-scoped API once the org itself is gone.
func (s *Service) DeleteOrg(ctx context.Context, orgID, actorID uuid.UUID) error {
	var isActive bool
	err := s.db.QueryRow(ctx,
		`SELECT is_active FROM organisations WHERE id = $1 AND deleted_at IS NULL`, orgID,
	).Scan(&isActive)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("organisation not found")
	}
	if err != nil {
		return fmt.Errorf("check organisation: %w", err)
	}
	if isActive {
		return fmt.Errorf("deactivate this organisation before deleting it")
	}

	result, err := s.db.Exec(ctx,
		`UPDATE organisations SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
		orgID,
	)
	if err != nil {
		return fmt.Errorf("delete organisation: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("organisation not found")
	}
	return nil
}
