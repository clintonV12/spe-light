// org_structure.go — Chapter 6 (Organisational Structure) for local plans.
//
// A flat, self-referencing list of roles (ReportsToID) rather than a fixed-
// depth tree — the ESWAMCU sample doc's chart (General Membership -> Board
// -> Executive Manager -> Business Development Officer / Technical Officer
// / Finance & Admin -> ...) has varying depth per branch, so a rigid
// "level 1/2/3" schema would not fit a different org's chart shape.
//
// Routes wired in router.go:
//
//	GET    /api/v1/plans/{planID}/org-structure-roles   — list (flat; caller builds the tree from reports_to_id)
//	POST   /api/v1/plans/{planID}/org-structure-roles   — create
//	PUT    /api/v1/org-structure-roles/{roleID}           — update
//	DELETE /api/v1/org-structure-roles/{roleID}           — delete
package plansvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CreateOrgStructureRoleRequest struct {
	Title       string     `json:"title"`
	Description *string    `json:"description,omitempty"`
	ReportsToID *uuid.UUID `json:"reports_to_id,omitempty"`
}

func (s *Service) CreateOrgStructureRole(ctx context.Context, planID, orgID uuid.UUID, req CreateOrgStructureRoleRequest) (*models.OrgStructureRole, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("title is required")
	}
	if err := s.requirePlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	if req.ReportsToID != nil {
		var exists bool
		if err := s.db.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM org_structure_roles WHERE id = $1 AND plan_id = $2 AND org_id = $3)`,
			*req.ReportsToID, planID, orgID,
		).Scan(&exists); err != nil {
			return nil, fmt.Errorf("check reports_to role: %w", err)
		}
		if !exists {
			return nil, fmt.Errorf("reports_to_id role not found on this plan")
		}
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM org_structure_roles WHERE plan_id = $1`,
		planID,
	).Scan(&maxOrder)

	role := &models.OrgStructureRole{
		ID: uuid.New(), PlanID: planID, OrgID: orgID,
		Title: req.Title, Description: req.Description, ReportsToID: req.ReportsToID,
		UserOrder: maxOrder + 1,
	}
	err := s.db.QueryRow(ctx,
		`INSERT INTO org_structure_roles (id, plan_id, org_id, title, description, reports_to_id, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at, updated_at`,
		role.ID, role.PlanID, role.OrgID, role.Title, role.Description, role.ReportsToID, role.UserOrder,
	).Scan(&role.CreatedAt, &role.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create org structure role: %w", err)
	}
	return role, nil
}

// ListOrgStructureRoles returns all roles for a plan, flat. The caller
// builds the tree from ReportsToID — keeping this flat avoids an arbitrary
// recursion-depth limit on the API response.
func (s *Service) ListOrgStructureRoles(ctx context.Context, planID, orgID uuid.UUID) ([]models.OrgStructureRole, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, title, description, reports_to_id, user_order, created_at, updated_at
		 FROM org_structure_roles WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list org structure roles: %w", err)
	}
	defer rows.Close()

	roles := make([]models.OrgStructureRole, 0)
	for rows.Next() {
		var r models.OrgStructureRole
		if err := rows.Scan(&r.ID, &r.PlanID, &r.OrgID, &r.Title, &r.Description, &r.ReportsToID, &r.UserOrder, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		roles = append(roles, r)
	}
	return roles, rows.Err()
}

type UpdateOrgStructureRoleRequest struct {
	Title       *string    `json:"title,omitempty"`
	Description *string    `json:"description,omitempty"`
	ReportsToID *uuid.UUID `json:"reports_to_id,omitempty"`
	UserOrder   *int       `json:"user_order,omitempty"`
}

func (s *Service) UpdateOrgStructureRole(ctx context.Context, roleID, orgID uuid.UUID, req UpdateOrgStructureRoleRequest) (*models.OrgStructureRole, error) {
	if req.Title == nil && req.Description == nil && req.ReportsToID == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.ReportsToID != nil && *req.ReportsToID == roleID {
		return nil, fmt.Errorf("a role cannot report to itself")
	}
	if req.Title != nil {
		if *req.Title == "" {
			return nil, fmt.Errorf("title cannot be empty")
		}
		if _, err := s.db.Exec(ctx, `UPDATE org_structure_roles SET title = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Title, roleID, orgID); err != nil {
			return nil, fmt.Errorf("update role title: %w", err)
		}
	}
	if req.Description != nil {
		if _, err := s.db.Exec(ctx, `UPDATE org_structure_roles SET description = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Description, roleID, orgID); err != nil {
			return nil, fmt.Errorf("update role description: %w", err)
		}
	}
	if req.ReportsToID != nil {
		if _, err := s.db.Exec(ctx, `UPDATE org_structure_roles SET reports_to_id = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.ReportsToID, roleID, orgID); err != nil {
			return nil, fmt.Errorf("update role reports_to: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx, `UPDATE org_structure_roles SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.UserOrder, roleID, orgID); err != nil {
			return nil, fmt.Errorf("update role order: %w", err)
		}
	}

	var r models.OrgStructureRole
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, title, description, reports_to_id, user_order, created_at, updated_at
		 FROM org_structure_roles WHERE id = $1 AND org_id = $2`, roleID, orgID,
	).Scan(&r.ID, &r.PlanID, &r.OrgID, &r.Title, &r.Description, &r.ReportsToID, &r.UserOrder, &r.CreatedAt, &r.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("role not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get role: %w", err)
	}
	return &r, nil
}

// DeleteOrgStructureRole removes a role. Any roles that reported to it are
// re-parented to NULL by the DB's ON DELETE SET NULL — they become top-level
// rather than being silently deleted, so the chart stays intact minus the
// one removed node.
func (s *Service) DeleteOrgStructureRole(ctx context.Context, roleID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM org_structure_roles WHERE id = $1 AND org_id = $2`, roleID, orgID)
	if err != nil {
		return fmt.Errorf("delete role: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("role not found")
	}
	return nil
}
