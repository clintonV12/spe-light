// vision_mission.go — Chapter 2 (Strategic Focus) for local plans: Vision,
// Mission (singleton text on the plan row), and Core Values (a list).
//
// Routes wired in router.go:
//
//	PUT    /api/v1/plans/{planID}/strategic-focus         — set vision/mission
//	GET    /api/v1/plans/{planID}/core-values             — list core values
//	POST   /api/v1/plans/{planID}/core-values             — create a core value
//	PUT    /api/v1/core-values/{coreValueID}                — rename/reorder
//	DELETE /api/v1/core-values/{coreValueID}                — delete
package plansvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ── Vision / Mission ─────────────────────────────────────────────────────

// UpdateStrategicFocusRequest carries the mutable vision/mission text.
// Either or both may be supplied; omitted fields are left unchanged.
type UpdateStrategicFocusRequest struct {
	Vision  *string `json:"vision,omitempty"`
	Mission *string `json:"mission,omitempty"`
}

// UpdateStrategicFocus sets a local plan's vision and/or mission statement.
func (s *Service) UpdateStrategicFocus(ctx context.Context, planID, orgID uuid.UUID, req UpdateStrategicFocusRequest) (*models.Plan, error) {
	if req.Vision == nil && req.Mission == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if err := s.requirePlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	if req.Vision != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET vision = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Vision, planID, orgID); err != nil {
			return nil, fmt.Errorf("update vision: %w", err)
		}
	}
	if req.Mission != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET mission = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Mission, planID, orgID); err != nil {
			return nil, fmt.Errorf("update mission: %w", err)
		}
	}

	return s.GetPlan(ctx, planID, orgID)
}

// ── Core values ───────────────────────────────────────────────────────────

// CreateCoreValueRequest holds the fields for creating a Core Value.
type CreateCoreValueRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

// CreateCoreValue adds a new Core Value to a local plan.
func (s *Service) CreateCoreValue(ctx context.Context, planID, orgID uuid.UUID, req CreateCoreValueRequest) (*models.CoreValue, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if err := s.requirePlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM core_values WHERE plan_id = $1`,
		planID,
	).Scan(&maxOrder)

	cv := &models.CoreValue{
		ID:          uuid.New(),
		PlanID:      planID,
		OrgID:       orgID,
		Name:        req.Name,
		Description: req.Description,
		UserOrder:   maxOrder + 1,
	}
	err := s.db.QueryRow(ctx,
		`INSERT INTO core_values (id, plan_id, org_id, name, description, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING created_at, updated_at`,
		cv.ID, cv.PlanID, cv.OrgID, cv.Name, cv.Description, cv.UserOrder,
	).Scan(&cv.CreatedAt, &cv.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create core value: %w", err)
	}
	return cv, nil
}

// ListCoreValues returns all Core Values for a plan, in display order.
func (s *Service) ListCoreValues(ctx context.Context, planID, orgID uuid.UUID) ([]models.CoreValue, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, name, description, user_order, created_at, updated_at
		 FROM core_values WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list core values: %w", err)
	}
	defer rows.Close()

	values := make([]models.CoreValue, 0)
	for rows.Next() {
		var cv models.CoreValue
		if err := rows.Scan(&cv.ID, &cv.PlanID, &cv.OrgID, &cv.Name, &cv.Description, &cv.UserOrder, &cv.CreatedAt, &cv.UpdatedAt); err != nil {
			return nil, err
		}
		values = append(values, cv)
	}
	return values, rows.Err()
}

// UpdateCoreValueRequest carries the mutable fields of a core value.
type UpdateCoreValueRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	UserOrder   *int    `json:"user_order,omitempty"`
}

// UpdateCoreValue renames, redescribes, and/or reorders a Core Value.
func (s *Service) UpdateCoreValue(ctx context.Context, coreValueID, orgID uuid.UUID, req UpdateCoreValueRequest) (*models.CoreValue, error) {
	if req.Name == nil && req.Description == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Name != nil {
		if *req.Name == "" {
			return nil, fmt.Errorf("name cannot be empty")
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE core_values SET name = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Name, coreValueID, orgID); err != nil {
			return nil, fmt.Errorf("update core value name: %w", err)
		}
	}
	if req.Description != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE core_values SET description = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Description, coreValueID, orgID); err != nil {
			return nil, fmt.Errorf("update core value description: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE core_values SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.UserOrder, coreValueID, orgID); err != nil {
			return nil, fmt.Errorf("update core value order: %w", err)
		}
	}

	var cv models.CoreValue
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, name, description, user_order, created_at, updated_at
		 FROM core_values WHERE id = $1 AND org_id = $2`,
		coreValueID, orgID,
	).Scan(&cv.ID, &cv.PlanID, &cv.OrgID, &cv.Name, &cv.Description, &cv.UserOrder, &cv.CreatedAt, &cv.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("core value not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get core value: %w", err)
	}
	return &cv, nil
}

// DeleteCoreValue removes a Core Value.
func (s *Service) DeleteCoreValue(ctx context.Context, coreValueID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx,
		`DELETE FROM core_values WHERE id = $1 AND org_id = $2`,
		coreValueID, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete core value: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("core value not found")
	}
	return nil
}
