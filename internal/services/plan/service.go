// Package plansvc implements all plan and activity business logic for Sprint 2.
//
// Plans are the top-level container for strategic work in StratPlan. Each plan
// belongs to a single organisation and is divided into three phases (P1, P2, P3).
// Activities are the discrete units of work within a plan/phase.
//
// Access model:
//   - org_admin and planner can create/edit plans and activities.
//   - contributor can edit activities assigned to them.
//   - viewer (org-wide or plan-scoped) has read-only access.
//   - All operations are scoped to org_id to enforce multi-tenancy.
//
// Phase labels are independent of creation order — an activity can be labelled
// P2 even if it is created before a P1 activity. user_order records insertion
// sequence and is used as the default display order within a phase.
package plansvc

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"spe-light/internal/config"
	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service handles plan and activity business logic.
type Service struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

// New creates a plan Service.
func New(db *pgxpool.Pool, cfg *config.Config) *Service {
	return &Service{db: db, cfg: cfg}
}

// ── Plan CRUD ─────────────────────────────────────────────────────────────

// CreatePlanRequest holds the fields required to create a new plan.
type CreatePlanRequest struct {
	Title       string     `json:"title"`
	Description *string    `json:"description,omitempty"`
	StartDate   *time.Time `json:"start_date,omitempty"`
	EndDate     *time.Time `json:"end_date,omitempty"`
}

// CreatePlan creates a new plan in draft status for the given org and owner.
func (s *Service) CreatePlan(ctx context.Context, orgID, ownerID uuid.UUID, req CreatePlanRequest) (*models.Plan, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("title is required")
	}

	plan := &models.Plan{
		ID:          uuid.New(),
		OrgID:       orgID,
		Title:       req.Title,
		Description: req.Description,
		Status:      models.PlanDraft,
		OwnerID:     ownerID,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
	}

	err := s.db.QueryRow(ctx,
		`INSERT INTO plans (id, org_id, title, description, status, owner_id, start_date, end_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING created_at, updated_at`,
		plan.ID, plan.OrgID, plan.Title, plan.Description,
		plan.Status, plan.OwnerID, plan.StartDate, plan.EndDate,
	).Scan(&plan.CreatedAt, &plan.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create plan: %w", err)
	}

	slog.Info("plan created", "plan_id", plan.ID, "org_id", orgID, "owner_id", ownerID)
	return plan, nil
}

// GetPlan fetches a single non-deleted plan, enforcing org scope.
// Returns a not-found error if the plan does not exist or belongs to a different org.
func (s *Service) GetPlan(ctx context.Context, planID, orgID uuid.UUID) (*models.Plan, error) {
	var p models.Plan
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, title, description, status, owner_id, start_date, end_date, created_at, updated_at
		 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		planID, orgID,
	).Scan(&p.ID, &p.OrgID, &p.Title, &p.Description, &p.Status,
		&p.OwnerID, &p.StartDate, &p.EndDate, &p.CreatedAt, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("plan not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get plan: %w", err)
	}
	return &p, nil
}

// ListPlans returns all non-deleted plans for an org, newest first.
// Viewers with plan-scoped access see only plans they have been explicitly granted.
func (s *Service) ListPlans(ctx context.Context, orgID uuid.UUID, callerID uuid.UUID, callerRole models.Role) ([]models.Plan, error) {
	var query string
	var args []any

	if callerRole == models.RoleViewer {
		// Plan-scoped viewers only see plans they have been granted access to,
		// OR all plans if they are an org-wide viewer (no rows in plan_viewers).
		// The simpler policy for v1: org-wide viewers see all; plan-scoped viewers
		// (those with any plan_viewers row) see only their granted plans.
		query = `
			SELECT p.id, p.org_id, p.title, p.description, p.status, p.owner_id,
			       p.start_date, p.end_date, p.created_at, p.updated_at
			FROM plans p
			WHERE p.org_id = $1 AND p.deleted_at IS NULL
			  AND (
			    -- No plan_viewers rows for this user means org-wide viewer
			    NOT EXISTS (SELECT 1 FROM plan_viewers WHERE user_id = $2)
			    OR
			    -- Otherwise, only plans explicitly granted
			    EXISTS (SELECT 1 FROM plan_viewers WHERE plan_id = p.id AND user_id = $2)
			  )
			ORDER BY p.created_at DESC`
		args = []any{orgID, callerID}
	} else {
		query = `
			SELECT id, org_id, title, description, status, owner_id,
			       start_date, end_date, created_at, updated_at
			FROM plans
			WHERE org_id = $1 AND deleted_at IS NULL
			ORDER BY created_at DESC`
		args = []any{orgID}
	}

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list plans: %w", err)
	}
	defer rows.Close()

	var plans []models.Plan
	for rows.Next() {
		var p models.Plan
		if err := rows.Scan(&p.ID, &p.OrgID, &p.Title, &p.Description, &p.Status,
			&p.OwnerID, &p.StartDate, &p.EndDate, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		plans = append(plans, p)
	}
	return plans, rows.Err()
}

// UpdatePlanRequest carries the mutable fields of a plan.
// Only non-nil fields are applied.
type UpdatePlanRequest struct {
	Title       *string            `json:"title,omitempty"`
	Description *string            `json:"description,omitempty"`
	Status      *models.PlanStatus `json:"status,omitempty"`
	StartDate   *time.Time         `json:"start_date,omitempty"`
	EndDate     *time.Time         `json:"end_date,omitempty"`
}

// UpdatePlan applies a partial update to a plan and returns the updated record.
// Status transitions are validated: archived plans cannot be updated.
func (s *Service) UpdatePlan(ctx context.Context, planID, orgID uuid.UUID, req UpdatePlanRequest) (*models.Plan, error) {
	if req.Title == nil && req.Description == nil && req.Status == nil &&
		req.StartDate == nil && req.EndDate == nil {
		return nil, fmt.Errorf("nothing to update")
	}

	// Validate status transition.
	if req.Status != nil {
		var currentStatus models.PlanStatus
		err := s.db.QueryRow(ctx,
			`SELECT status FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
			planID, orgID,
		).Scan(&currentStatus)
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("plan not found")
		}
		if err != nil {
			return nil, fmt.Errorf("fetch plan: %w", err)
		}
		if currentStatus == models.PlanArchived {
			return nil, fmt.Errorf("archived plans cannot be updated")
		}
	}

	if req.Title != nil {
		if *req.Title == "" {
			return nil, fmt.Errorf("title cannot be empty")
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET title = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Title, planID, orgID); err != nil {
			return nil, fmt.Errorf("update title: %w", err)
		}
	}
	if req.Description != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET description = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Description, planID, orgID); err != nil {
			return nil, fmt.Errorf("update description: %w", err)
		}
	}
	if req.Status != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.Status, planID, orgID); err != nil {
			return nil, fmt.Errorf("update status: %w", err)
		}
	}
	if req.StartDate != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET start_date = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.StartDate, planID, orgID); err != nil {
			return nil, fmt.Errorf("update start_date: %w", err)
		}
	}
	if req.EndDate != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET end_date = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			*req.EndDate, planID, orgID); err != nil {
			return nil, fmt.Errorf("update end_date: %w", err)
		}
	}

	return s.GetPlan(ctx, planID, orgID)
}

// DeletePlan soft-deletes a plan and all its activities.
// Hard deletes are not supported in v1; use the migrations to purge if needed.
func (s *Service) DeletePlan(ctx context.Context, planID, orgID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx,
		`UPDATE plans SET deleted_at = NOW(), updated_at = NOW()
		 WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		planID, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete plan: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("plan not found")
	}

	// Soft-delete all activities in the plan.
	if _, err = tx.Exec(ctx,
		`UPDATE activities SET deleted_at = NOW(), updated_at = NOW()
		 WHERE plan_id = $1 AND deleted_at IS NULL`,
		planID); err != nil {
		return fmt.Errorf("delete activities: %w", err)
	}

	slog.Info("plan deleted", "plan_id", planID, "org_id", orgID)
	return tx.Commit(ctx)
}

// ── Activity CRUD ─────────────────────────────────────────────────────────

// CreateActivityRequest holds the fields for creating a new activity.
type CreateActivityRequest struct {
	Phase      models.Phase   `json:"phase"`
	Type       string         `json:"type"`
	Title      string         `json:"title"`
	Content    map[string]any `json:"content,omitempty"`
	AssignedTo []uuid.UUID    `json:"assigned_to,omitempty"`
	DueDate    *time.Time     `json:"due_date,omitempty"`
}

// CreateActivity adds a new activity to a plan. The user_order is set to
// (max existing + 1) within the plan so display order reflects creation order.
func (s *Service) CreateActivity(ctx context.Context, planID, orgID, creatorID uuid.UUID, req CreateActivityRequest) (*models.Activity, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("title is required")
	}
	if req.Type == "" {
		return nil, fmt.Errorf("type is required")
	}
	if req.Phase != models.PhaseP1 && req.Phase != models.PhaseP2 && req.Phase != models.PhaseP3 {
		return nil, fmt.Errorf("phase must be P1, P2, or P3")
	}

	// Verify the plan exists and belongs to this org.
	var planExists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		planID, orgID,
	).Scan(&planExists)
	if err != nil {
		return nil, fmt.Errorf("check plan: %w", err)
	}
	if !planExists {
		return nil, fmt.Errorf("plan not found")
	}

	// Determine the next user_order value within this plan.
	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM activities WHERE plan_id = $1`,
		planID,
	).Scan(&maxOrder)

	content := req.Content
	if content == nil {
		content = map[string]any{}
	}
	assignedTo := req.AssignedTo
	if assignedTo == nil {
		assignedTo = []uuid.UUID{}
	}

	a := &models.Activity{
		ID:         uuid.New(),
		PlanID:     planID,
		OrgID:      orgID,
		Phase:      req.Phase,
		Type:       req.Type,
		Title:      req.Title,
		UserOrder:  maxOrder + 1,
		Status:     models.ActivityNotStarted,
		Content:    content,
		AssignedTo: assignedTo,
		DueDate:    req.DueDate,
	}

	err = s.db.QueryRow(ctx,
		`INSERT INTO activities
		 (id, plan_id, org_id, phase, type, title, user_order, status, content, assigned_to, due_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING created_at, updated_at`,
		a.ID, a.PlanID, a.OrgID, a.Phase, a.Type, a.Title,
		a.UserOrder, a.Status, a.Content, a.AssignedTo, a.DueDate,
	).Scan(&a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create activity: %w", err)
	}

	slog.Info("activity created", "activity_id", a.ID, "plan_id", planID, "phase", a.Phase)
	return a, nil
}

// ListActivities returns all non-deleted activities for a plan.
// Optionally filter by phase. Results are sorted by phase then user_order.
func (s *Service) ListActivities(ctx context.Context, planID, orgID uuid.UUID, phase *models.Phase) ([]models.Activity, error) {
	// Verify plan access first.
	var planExists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		planID, orgID,
	).Scan(&planExists); err != nil {
		return nil, fmt.Errorf("check plan: %w", err)
	}
	if !planExists {
		return nil, fmt.Errorf("plan not found")
	}

	query := `SELECT id, plan_id, org_id, phase, type, title, user_order, status,
	                 content, ai_draft, assigned_to, due_date, created_at, updated_at
	          FROM activities
	          WHERE plan_id = $1 AND deleted_at IS NULL`
	args := []any{planID}

	if phase != nil {
		args = append(args, *phase)
		query += fmt.Sprintf(" AND phase = $%d", len(args))
	}
	query += " ORDER BY phase, user_order"

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list activities: %w", err)
	}
	defer rows.Close()

	var activities []models.Activity
	for rows.Next() {
		var a models.Activity
		if err := rows.Scan(
			&a.ID, &a.PlanID, &a.OrgID, &a.Phase, &a.Type, &a.Title, &a.UserOrder,
			&a.Status, &a.Content, &a.AIDraft, &a.AssignedTo, &a.DueDate,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		activities = append(activities, a)
	}
	return activities, rows.Err()
}

// UpdateActivityRequest carries the mutable fields of an activity.
// All fields are optional — supply only what needs changing.
type UpdateActivityRequest struct {
	Title      *string                `json:"title,omitempty"`
	Status     *models.ActivityStatus `json:"status,omitempty"`
	Content    map[string]any         `json:"content,omitempty"`
	AssignedTo []uuid.UUID            `json:"assigned_to,omitempty"`
	DueDate    *time.Time             `json:"due_date,omitempty"`
}

// UpdateActivity applies a partial update to an activity.
// Contributors can only update activities assigned to them; planners/admins
// can update any activity in the plan. This is enforced by the caller
// (handler) before invoking this method.
func (s *Service) UpdateActivity(ctx context.Context, activityID, orgID uuid.UUID, req UpdateActivityRequest) (*models.Activity, error) {
	if req.Title == nil && req.Status == nil && req.Content == nil && req.AssignedTo == nil && req.DueDate == nil {
		return nil, fmt.Errorf("nothing to update")
	}

	// Verify the activity belongs to this org.
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM activities WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		activityID, orgID,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check activity: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("activity not found")
	}

	if req.Title != nil {
		if *req.Title == "" {
			return nil, fmt.Errorf("title cannot be empty")
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE activities SET title = $1, updated_at = NOW() WHERE id = $2`,
			*req.Title, activityID); err != nil {
			return nil, fmt.Errorf("update title: %w", err)
		}
	}
	if req.Status != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE activities SET status = $1, updated_at = NOW() WHERE id = $2`,
			*req.Status, activityID); err != nil {
			return nil, fmt.Errorf("update status: %w", err)
		}
	}
	if req.Content != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE activities SET content = $1, updated_at = NOW() WHERE id = $2`,
			req.Content, activityID); err != nil {
			return nil, fmt.Errorf("update content: %w", err)
		}
	}
	if req.AssignedTo != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE activities SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
			req.AssignedTo, activityID); err != nil {
			return nil, fmt.Errorf("update assigned_to: %w", err)
		}
	}
	if req.DueDate != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE activities SET due_date = $1, updated_at = NOW() WHERE id = $2`,
			*req.DueDate, activityID); err != nil {
			return nil, fmt.Errorf("update due_date: %w", err)
		}
	}

	return s.getActivity(ctx, activityID, orgID)
}

// getActivity fetches a single activity by ID, enforcing org scope.
func (s *Service) getActivity(ctx context.Context, activityID, orgID uuid.UUID) (*models.Activity, error) {
	var a models.Activity
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, phase, type, title, user_order, status,
		        content, ai_draft, assigned_to, due_date, created_at, updated_at
		 FROM activities WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		activityID, orgID,
	).Scan(&a.ID, &a.PlanID, &a.OrgID, &a.Phase, &a.Type, &a.Title, &a.UserOrder,
		&a.Status, &a.Content, &a.AIDraft, &a.AssignedTo, &a.DueDate,
		&a.CreatedAt, &a.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("activity not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get activity: %w", err)
	}
	return &a, nil
}

// ── Progress ──────────────────────────────────────────────────────────────

// PhaseProgress holds completion metrics for a single phase.
type PhaseProgress struct {
	Phase      models.Phase `json:"phase"`
	Total      int          `json:"total"`
	Complete   int          `json:"complete"`
	InProgress int          `json:"in_progress"`
	Overdue    int          `json:"overdue"`
	Percent    float64      `json:"percent_complete"`
}

// PlanProgress is the full progress payload returned by GET /plans/:id/progress.
type PlanProgress struct {
	PlanID     uuid.UUID         `json:"plan_id"`
	Status     models.PlanStatus `json:"status"`
	Phases     []PhaseProgress   `json:"phases"`
	Overall    PhaseProgress     `json:"overall"`
	Milestones MilestoneStats    `json:"milestones"`
}

// MilestoneStats gives a quick view of milestone health.
type MilestoneStats struct {
	Total   int `json:"total"`
	Reached int `json:"reached"`
	Missed  int `json:"missed"`
	Pending int `json:"pending"`
}

// GetProgress returns progress metrics for a plan.
func (s *Service) GetProgress(ctx context.Context, planID, orgID uuid.UUID) (*PlanProgress, error) {
	plan, err := s.GetPlan(ctx, planID, orgID)
	if err != nil {
		return nil, err
	}

	// Activity counts per phase and status.
	rows, err := s.db.Query(ctx,
		`SELECT phase, status, COUNT(*) AS cnt,
		        SUM(CASE WHEN due_date < CURRENT_DATE AND status != 'complete' THEN 1 ELSE 0 END) AS overdue
		 FROM activities
		 WHERE plan_id = $1 AND deleted_at IS NULL
		 GROUP BY phase, status`,
		planID,
	)
	if err != nil {
		return nil, fmt.Errorf("query activity stats: %w", err)
	}
	defer rows.Close()

	// Accumulate counts into a map keyed by phase.
	type phaseKey = models.Phase
	type counts struct{ total, complete, inProgress, overdue int }
	phaseMap := map[phaseKey]*counts{
		models.PhaseP1: {},
		models.PhaseP2: {},
		models.PhaseP3: {},
	}
	overall := &counts{}

	for rows.Next() {
		var phase models.Phase
		var status string
		var cnt, overdue int
		if err := rows.Scan(&phase, &status, &cnt, &overdue); err != nil {
			return nil, err
		}
		c := phaseMap[phase]
		c.total += cnt
		c.overdue += overdue
		overall.total += cnt
		overall.overdue += overdue
		switch models.ActivityStatus(status) {
		case models.ActivityComplete:
			c.complete += cnt
			overall.complete += cnt
		case models.ActivityInProgress:
			c.inProgress += cnt
			overall.inProgress += cnt
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	pct := func(c *counts) float64 {
		if c.total == 0 {
			return 0
		}
		return float64(c.complete) / float64(c.total) * 100
	}

	phases := make([]PhaseProgress, 0, 3)
	for _, ph := range []models.Phase{models.PhaseP1, models.PhaseP2, models.PhaseP3} {
		c := phaseMap[ph]
		phases = append(phases, PhaseProgress{
			Phase:      ph,
			Total:      c.total,
			Complete:   c.complete,
			InProgress: c.inProgress,
			Overdue:    c.overdue,
			Percent:    pct(c),
		})
	}

	// Milestone stats.
	var mStats MilestoneStats
	_ = s.db.QueryRow(ctx,
		`SELECT
		   COUNT(*) FILTER (WHERE TRUE)            AS total,
		   COUNT(*) FILTER (WHERE status='reached') AS reached,
		   COUNT(*) FILTER (WHERE status='missed')  AS missed,
		   COUNT(*) FILTER (WHERE status='pending') AS pending
		 FROM milestones WHERE plan_id = $1`,
		planID,
	).Scan(&mStats.Total, &mStats.Reached, &mStats.Missed, &mStats.Pending)

	return &PlanProgress{
		PlanID: plan.ID,
		Status: plan.Status,
		Phases: phases,
		Overall: PhaseProgress{
			Total:      overall.total,
			Complete:   overall.complete,
			InProgress: overall.inProgress,
			Overdue:    overall.overdue,
			Percent:    pct(overall),
		},
		Milestones: mStats,
	}, nil
}

// ── Activity links ─────────────────────────────────────────────────────────

// CreateLinkRequest holds the fields for creating an activity link.
type CreateLinkRequest struct {
	TargetID uuid.UUID               `json:"target_id"`
	LinkType models.ActivityLinkType `json:"link_type"`
}

// CreateActivityLink creates a directional link between two activities.
// Self-links and duplicate links are rejected.
func (s *Service) CreateActivityLink(ctx context.Context, sourceID, orgID, creatorID uuid.UUID, req CreateLinkRequest) (*models.ActivityLink, error) {
	if sourceID == req.TargetID {
		return nil, fmt.Errorf("an activity cannot link to itself")
	}
	if req.LinkType == "" {
		req.LinkType = models.LinkTypeManual
	}

	// Verify both activities exist and belong to the same org.
	var sourcePlanID, targetPlanID uuid.UUID
	if err := s.db.QueryRow(ctx,
		`SELECT plan_id FROM activities WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		sourceID, orgID,
	).Scan(&sourcePlanID); err != nil {
		return nil, fmt.Errorf("source activity not found")
	}
	if err := s.db.QueryRow(ctx,
		`SELECT plan_id FROM activities WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		req.TargetID, orgID,
	).Scan(&targetPlanID); err != nil {
		return nil, fmt.Errorf("target activity not found")
	}
	if sourcePlanID != targetPlanID {
		return nil, fmt.Errorf("cannot link activities across different plans")
	}

	link := &models.ActivityLink{
		ID:        uuid.New(),
		PlanID:    sourcePlanID,
		SourceID:  sourceID,
		TargetID:  req.TargetID,
		LinkType:  req.LinkType,
		CreatedBy: creatorID,
	}

	err := s.db.QueryRow(ctx,
		`INSERT INTO activity_links (id, plan_id, source_id, target_id, link_type, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING created_at, updated_at`,
		link.ID, link.PlanID, link.SourceID, link.TargetID, link.LinkType, link.CreatedBy,
	).Scan(&link.CreatedAt, &link.UpdatedAt)
	if err != nil {
		// Unique constraint violation — link already exists.
		return nil, fmt.Errorf("link already exists between these activities")
	}

	return link, nil
}
