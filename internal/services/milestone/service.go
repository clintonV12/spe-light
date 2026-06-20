// Package milestonesvc implements milestone CRUD for StratPlan (gap 2.4).
//
// Milestones are optional key-date markers within a plan. The progress endpoint
// (GetProgress in plansvc) already queries the milestones table correctly but
// always returned zero counts because there was no way to insert rows. This
// package closes that gap.
//
// Operations:
//   - Create a milestone (planner+)
//   - Update title, due_date, status, or linked_activity_id (planner+)
//   - Delete a milestone (org_admin only)
//   - List milestones for a plan (all org roles)
//
// All operations verify plan ownership via org_id before acting so that an
// org admin from one tenant cannot affect another tenant's milestones.
package milestonesvc

import (
	"context"
	"fmt"
	"time"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service handles milestone operations.
type Service struct {
	db *pgxpool.Pool
}

// New creates a milestone Service.
func New(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// ── DTOs ──────────────────────────────────────────────────────────────────

// CreateMilestoneRequest carries the fields for a new milestone.
type CreateMilestoneRequest struct {
	Title            string     `json:"title"`
	DueDate          time.Time  `json:"due_date"`
	LinkedActivityID *uuid.UUID `json:"linked_activity_id,omitempty"`
}

// UpdateMilestoneRequest carries the mutable milestone fields.
// Only non-nil fields are applied — all fields are optional on update.
type UpdateMilestoneRequest struct {
	Title            *string                 `json:"title,omitempty"`
	DueDate          *time.Time              `json:"due_date,omitempty"`
	Status           *models.MilestoneStatus `json:"status,omitempty"`
	LinkedActivityID *uuid.UUID              `json:"linked_activity_id,omitempty"`
}

// ── Create ────────────────────────────────────────────────────────────────

// CreateMilestone inserts a new milestone under the given plan.
// orgID is used to verify the plan belongs to this tenant before inserting.
func (s *Service) CreateMilestone(ctx context.Context, planID, orgID uuid.UUID, req CreateMilestoneRequest) (*models.Milestone, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("title is required")
	}
	if req.DueDate.IsZero() {
		return nil, fmt.Errorf("due_date is required")
	}

	if err := s.verifyPlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	m := &models.Milestone{
		ID:               uuid.New(),
		PlanID:           planID,
		Title:            req.Title,
		DueDate:          req.DueDate,
		Status:           models.MilestonePending,
		LinkedActivityID: req.LinkedActivityID,
	}

	err := s.db.QueryRow(ctx,
		`INSERT INTO milestones (id, plan_id, title, due_date, status, linked_activity_id)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING created_at, updated_at`,
		m.ID, m.PlanID, m.Title, m.DueDate, m.Status, m.LinkedActivityID,
	).Scan(&m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create milestone: %w", err)
	}
	return m, nil
}

// ── List ──────────────────────────────────────────────────────────────────

// ListMilestones returns all milestones for a plan ordered by due_date ascending.
func (s *Service) ListMilestones(ctx context.Context, planID, orgID uuid.UUID) ([]models.Milestone, error) {
	if err := s.verifyPlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, title, due_date, status, linked_activity_id, created_at, updated_at
		 FROM milestones
		 WHERE plan_id = $1
		 ORDER BY due_date ASC`,
		planID,
	)
	if err != nil {
		return nil, fmt.Errorf("list milestones: %w", err)
	}
	defer rows.Close()

	var milestones []models.Milestone
	for rows.Next() {
		var m models.Milestone
		if err := rows.Scan(
			&m.ID, &m.PlanID, &m.Title, &m.DueDate,
			&m.Status, &m.LinkedActivityID, &m.CreatedAt, &m.UpdatedAt,
		); err != nil {
			return nil, err
		}
		milestones = append(milestones, m)
	}
	return milestones, rows.Err()
}

// ── Update ────────────────────────────────────────────────────────────────

// UpdateMilestone applies a partial update to an existing milestone.
// orgID is used to verify ownership via the milestone's parent plan.
func (s *Service) UpdateMilestone(ctx context.Context, milestoneID, orgID uuid.UUID, req UpdateMilestoneRequest) (*models.Milestone, error) {
	if req.Title == nil && req.DueDate == nil && req.Status == nil && req.LinkedActivityID == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Title != nil && *req.Title == "" {
		return nil, fmt.Errorf("title cannot be empty")
	}
	if req.Status != nil {
		if err := validateStatus(*req.Status); err != nil {
			return nil, err
		}
	}

	// Verify org ownership via the milestone's parent plan.
	var exists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM milestones m
		   JOIN plans p ON p.id = m.plan_id
		   WHERE m.id = $1 AND p.org_id = $2 AND p.deleted_at IS NULL
		 )`,
		milestoneID, orgID,
	).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("verify milestone: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("milestone not found")
	}

	if req.Title != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE milestones SET title = $1, updated_at = NOW() WHERE id = $2`,
			*req.Title, milestoneID); err != nil {
			return nil, fmt.Errorf("update title: %w", err)
		}
	}
	if req.DueDate != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE milestones SET due_date = $1, updated_at = NOW() WHERE id = $2`,
			*req.DueDate, milestoneID); err != nil {
			return nil, fmt.Errorf("update due_date: %w", err)
		}
	}
	if req.Status != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE milestones SET status = $1, updated_at = NOW() WHERE id = $2`,
			*req.Status, milestoneID); err != nil {
			return nil, fmt.Errorf("update status: %w", err)
		}
	}
	if req.LinkedActivityID != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE milestones SET linked_activity_id = $1, updated_at = NOW() WHERE id = $2`,
			*req.LinkedActivityID, milestoneID); err != nil {
			return nil, fmt.Errorf("update linked_activity_id: %w", err)
		}
	}

	return s.get(ctx, milestoneID)
}

// ── Delete ────────────────────────────────────────────────────────────────

// DeleteMilestone permanently removes a milestone.
// orgID is used to verify the milestone's plan belongs to this tenant.
// The milestones table has no deleted_at column per the SRS schema, so this
// is a hard delete.
func (s *Service) DeleteMilestone(ctx context.Context, milestoneID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx,
		`DELETE FROM milestones
		 WHERE id = $1
		   AND plan_id IN (
		     SELECT id FROM plans WHERE org_id = $2 AND deleted_at IS NULL
		   )`,
		milestoneID, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete milestone: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("milestone not found")
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────

// verifyPlan checks the plan exists and belongs to orgID.
func (s *Service) verifyPlan(ctx context.Context, planID, orgID uuid.UUID) error {
	var exists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		planID, orgID,
	).Scan(&exists)
	if err != nil {
		return fmt.Errorf("verify plan: %w", err)
	}
	if !exists {
		return fmt.Errorf("plan not found")
	}
	return nil
}

// get reloads a milestone by primary key after an update.
func (s *Service) get(ctx context.Context, milestoneID uuid.UUID) (*models.Milestone, error) {
	var m models.Milestone
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, title, due_date, status, linked_activity_id, created_at, updated_at
		 FROM milestones WHERE id = $1`,
		milestoneID,
	).Scan(&m.ID, &m.PlanID, &m.Title, &m.DueDate,
		&m.Status, &m.LinkedActivityID, &m.CreatedAt, &m.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("milestone not found")
	}
	if err != nil {
		return nil, fmt.Errorf("reload milestone: %w", err)
	}
	return &m, nil
}

// validateStatus returns an error if s is not a known MilestoneStatus value.
func validateStatus(s models.MilestoneStatus) error {
	switch s {
	case models.MilestonePending, models.MilestoneReached, models.MilestoneMissed:
		return nil
	default:
		return fmt.Errorf("status must be one of: pending, reached, missed")
	}
}
