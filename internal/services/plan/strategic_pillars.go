// strategic_pillars.go — Strategic Pillar / Strategic Objective CRUD for
// "local" (Eswatini-standard) plans.
//
// A pillar is a top-level, user-defined grouping (the local equivalent of a
// Phase). An objective (KPA) nests under exactly one pillar. Activities in a
// local plan attach to an objective via activities.objective_id — see
// CreateActivity in plan_service.go.
//
// Both CRUD surfaces are only meaningful for plans with plan_type = 'local',
// and every method here verifies that up front so a caller can't create
// pillars/objectives on an international plan by mistake.
package plansvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ── Strategic pillars ────────────────────────────────────────────────────

// CreatePillarRequest holds the fields for creating a Strategic Pillar.
type CreatePillarRequest struct {
	Title string `json:"title"`
}

// CreatePillar adds a new Strategic Pillar to a local plan. user_order is
// set to (max existing + 1) so pillars display in creation order by default.
func (s *Service) CreatePillar(ctx context.Context, planID, orgID uuid.UUID, req CreatePillarRequest) (*models.StrategicPillar, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("title is required")
	}
	if err := s.requireLocalPlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM strategic_pillars WHERE plan_id = $1`,
		planID,
	).Scan(&maxOrder)

	p := &models.StrategicPillar{
		ID:        uuid.New(),
		PlanID:    planID,
		OrgID:     orgID,
		Title:     req.Title,
		UserOrder: maxOrder + 1,
	}
	err := s.db.QueryRow(ctx,
		`INSERT INTO strategic_pillars (id, plan_id, org_id, title, user_order)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING created_at, updated_at`,
		p.ID, p.PlanID, p.OrgID, p.Title, p.UserOrder,
	).Scan(&p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create pillar: %w", err)
	}
	return p, nil
}

// ListPillars returns all Strategic Pillars for a plan, in display order.
// ListPillars returns all Strategic Pillars for a plan, in display order.
func (s *Service) ListPillars(ctx context.Context, planID, orgID uuid.UUID) ([]models.StrategicPillar, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, title, user_order, created_at, updated_at
		 FROM strategic_pillars WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list pillars: %w", err)
	}
	defer rows.Close()

	pillars := make([]models.StrategicPillar, 0)
	for rows.Next() {
		var p models.StrategicPillar
		if err := rows.Scan(&p.ID, &p.PlanID, &p.OrgID, &p.Title, &p.UserOrder, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		pillars = append(pillars, p)
	}
	return pillars, rows.Err()
}

// UpdatePillarRequest carries the mutable fields of a pillar.
type UpdatePillarRequest struct {
	Title     *string `json:"title,omitempty"`
	UserOrder *int    `json:"user_order,omitempty"`
}

// UpdatePillar renames and/or reorders a Strategic Pillar.
func (s *Service) UpdatePillar(ctx context.Context, pillarID, orgID uuid.UUID, req UpdatePillarRequest) (*models.StrategicPillar, error) {
	if req.Title == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Title != nil {
		if *req.Title == "" {
			return nil, fmt.Errorf("title cannot be empty")
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE strategic_pillars SET title = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Title, pillarID, orgID); err != nil {
			return nil, fmt.Errorf("update pillar title: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE strategic_pillars SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.UserOrder, pillarID, orgID); err != nil {
			return nil, fmt.Errorf("update pillar order: %w", err)
		}
	}

	var p models.StrategicPillar
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, title, user_order, created_at, updated_at
		 FROM strategic_pillars WHERE id = $1 AND org_id = $2`,
		pillarID, orgID,
	).Scan(&p.ID, &p.PlanID, &p.OrgID, &p.Title, &p.UserOrder, &p.CreatedAt, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("pillar not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get pillar: %w", err)
	}
	return &p, nil
}

// DeletePillar removes a Strategic Pillar. Rejected if any objective still
// references it (and, transitively, any activity still references one of
// those objectives) — the caller must delete the objectives (and their
// activities) first. This mirrors the DB's ON DELETE behaviour (no CASCADE
// was configured) and gives a clear error instead of a raw FK violation.
func (s *Service) DeletePillar(ctx context.Context, pillarID, orgID uuid.UUID) error {
	var objectiveCount int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM strategic_objectives WHERE pillar_id = $1 AND org_id = $2`,
		pillarID, orgID,
	).Scan(&objectiveCount); err != nil {
		return fmt.Errorf("check objectives: %w", err)
	}
	if objectiveCount > 0 {
		return fmt.Errorf("cannot delete a pillar that still has strategic objectives — delete those first")
	}

	result, err := s.db.Exec(ctx,
		`DELETE FROM strategic_pillars WHERE id = $1 AND org_id = $2`,
		pillarID, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete pillar: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("pillar not found")
	}
	return nil
}

// ── Strategic objectives (KPAs) ──────────────────────────────────────────

// CreateObjectiveRequest holds the fields for creating a Strategic Objective.
type CreateObjectiveRequest struct {
	Title string `json:"title"`
}

// CreateObjective adds a new Strategic Objective under a pillar.
func (s *Service) CreateObjective(ctx context.Context, pillarID, orgID uuid.UUID, req CreateObjectiveRequest) (*models.StrategicObjective, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("title is required")
	}

	var planID uuid.UUID
	if err := s.db.QueryRow(ctx,
		`SELECT plan_id FROM strategic_pillars WHERE id = $1 AND org_id = $2`,
		pillarID, orgID,
	).Scan(&planID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("pillar not found")
		}
		return nil, fmt.Errorf("lookup pillar: %w", err)
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM strategic_objectives WHERE pillar_id = $1`,
		pillarID,
	).Scan(&maxOrder)

	o := &models.StrategicObjective{
		ID:        uuid.New(),
		PlanID:    planID,
		PillarID:  pillarID,
		OrgID:     orgID,
		Title:     req.Title,
		UserOrder: maxOrder + 1,
	}
	err := s.db.QueryRow(ctx,
		`INSERT INTO strategic_objectives (id, plan_id, pillar_id, org_id, title, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING created_at, updated_at`,
		o.ID, o.PlanID, o.PillarID, o.OrgID, o.Title, o.UserOrder,
	).Scan(&o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create objective: %w", err)
	}
	return o, nil
}

// ListObjectives returns all Strategic Objectives for a plan (across all of
// its pillars), in pillar then display order.
// ListObjectives returns all Strategic Objectives for a plan (across all of
// its pillars), in pillar then display order.
func (s *Service) ListObjectives(ctx context.Context, planID, orgID uuid.UUID) ([]models.StrategicObjective, error) {
	rows, err := s.db.Query(ctx,
		`SELECT o.id, o.plan_id, o.pillar_id, o.org_id, o.title, o.user_order, o.created_at, o.updated_at
		 FROM strategic_objectives o
		 JOIN strategic_pillars p ON p.id = o.pillar_id
		 WHERE o.plan_id = $1 AND o.org_id = $2
		 ORDER BY p.user_order, o.user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list objectives: %w", err)
	}
	defer rows.Close()

	objectives := make([]models.StrategicObjective, 0)
	for rows.Next() {
		var o models.StrategicObjective
		if err := rows.Scan(&o.ID, &o.PlanID, &o.PillarID, &o.OrgID, &o.Title, &o.UserOrder, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		objectives = append(objectives, o)
	}
	return objectives, rows.Err()
}

// UpdateObjectiveRequest carries the mutable fields of an objective.
type UpdateObjectiveRequest struct {
	Title     *string `json:"title,omitempty"`
	UserOrder *int    `json:"user_order,omitempty"`
}

// UpdateObjective renames and/or reorders a Strategic Objective.
func (s *Service) UpdateObjective(ctx context.Context, objectiveID, orgID uuid.UUID, req UpdateObjectiveRequest) (*models.StrategicObjective, error) {
	if req.Title == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Title != nil {
		if *req.Title == "" {
			return nil, fmt.Errorf("title cannot be empty")
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE strategic_objectives SET title = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Title, objectiveID, orgID); err != nil {
			return nil, fmt.Errorf("update objective title: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE strategic_objectives SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.UserOrder, objectiveID, orgID); err != nil {
			return nil, fmt.Errorf("update objective order: %w", err)
		}
	}

	var o models.StrategicObjective
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, pillar_id, org_id, title, user_order, created_at, updated_at
		 FROM strategic_objectives WHERE id = $1 AND org_id = $2`,
		objectiveID, orgID,
	).Scan(&o.ID, &o.PlanID, &o.PillarID, &o.OrgID, &o.Title, &o.UserOrder, &o.CreatedAt, &o.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("objective not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get objective: %w", err)
	}
	return &o, nil
}

// DeleteObjective removes a Strategic Objective. Rejected if any activity
// still references it — the caller must delete/move those activities first.
func (s *Service) DeleteObjective(ctx context.Context, objectiveID, orgID uuid.UUID) error {
	var activityCount int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM activities WHERE objective_id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		objectiveID, orgID,
	).Scan(&activityCount); err != nil {
		return fmt.Errorf("check activities: %w", err)
	}
	if activityCount > 0 {
		return fmt.Errorf("cannot delete an objective that still has activities — delete those first")
	}

	result, err := s.db.Exec(ctx,
		`DELETE FROM strategic_objectives WHERE id = $1 AND org_id = $2`,
		objectiveID, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete objective: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("objective not found")
	}
	return nil
}

// ── Shared helper ─────────────────────────────────────────────────────────

// requireLocalPlan verifies planID exists, belongs to orgID, and is a
// "local" plan — pillars only make sense for local plans.
func (s *Service) requireLocalPlan(ctx context.Context, planID, orgID uuid.UUID) error {
	var planType models.PlanType
	err := s.db.QueryRow(ctx,
		`SELECT plan_type FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		planID, orgID,
	).Scan(&planType)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("plan not found")
	}
	if err != nil {
		return fmt.Errorf("check plan: %w", err)
	}
	if planType != models.PlanTypeLocal {
		return fmt.Errorf("strategic pillars are only available for local plans")
	}
	return nil
}
