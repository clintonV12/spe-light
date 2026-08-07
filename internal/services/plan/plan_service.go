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

	"spe-light/internal/auditlog"
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
// PlanType is optional and defaults to "international" (the plan structure
// that existed before local plans were introduced), preserving existing
// client behaviour for any caller that doesn't send it.
type CreatePlanRequest struct {
	Title       string           `json:"title"`
	Description *string          `json:"description,omitempty"`
	PlanType    *models.PlanType `json:"plan_type,omitempty"`
	StartDate   *FlexDate        `json:"start_date,omitempty"`
	EndDate     *FlexDate        `json:"end_date,omitempty"`
}

// CreatePlan creates a new plan in draft status for the given org and owner.
func (s *Service) CreatePlan(ctx context.Context, orgID, ownerID uuid.UUID, req CreatePlanRequest) (*models.Plan, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("title is required")
	}

	planType := models.PlanTypeInternational
	if req.PlanType != nil {
		if *req.PlanType != models.PlanTypeInternational && *req.PlanType != models.PlanTypeLocal {
			return nil, fmt.Errorf("plan_type must be 'international' or 'local'")
		}
		planType = *req.PlanType
	}

	plan := &models.Plan{
		ID:          uuid.New(),
		OrgID:       orgID,
		Title:       req.Title,
		Description: req.Description,
		Status:      models.PlanDraft,
		PlanType:    planType,
		OwnerID:     ownerID,
		StartDate:   req.StartDate.ToTimePtr(),
		EndDate:     req.EndDate.ToTimePtr(),
	}

	err := s.db.QueryRow(ctx,
		`INSERT INTO plans (id, org_id, title, description, status, plan_type, owner_id, start_date, end_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING created_at, updated_at`,
		plan.ID, plan.OrgID, plan.Title, plan.Description,
		plan.Status, plan.PlanType, plan.OwnerID, plan.StartDate, plan.EndDate,
	).Scan(&plan.CreatedAt, &plan.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create plan: %w", err)
	}

	slog.Info("plan created", "plan_id", plan.ID, "org_id", orgID, "owner_id", ownerID, "plan_type", plan.PlanType)
	return plan, nil
}

// GetPlan fetches a single non-deleted plan, enforcing org scope.
// Returns a not-found error if the plan does not exist or belongs to a different org.
func (s *Service) GetPlan(ctx context.Context, planID, orgID uuid.UUID) (*models.Plan, error) {
	var p models.Plan
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, title, description, status, plan_type, owner_id, start_date, end_date, vision, mission, created_at, updated_at
		 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		planID, orgID,
	).Scan(&p.ID, &p.OrgID, &p.Title, &p.Description, &p.Status, &p.PlanType,
		&p.OwnerID, &p.StartDate, &p.EndDate, &p.Vision, &p.Mission, &p.CreatedAt, &p.UpdatedAt)
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
			SELECT p.id, p.org_id, p.title, p.description, p.status, p.plan_type, p.owner_id,
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
			SELECT id, org_id, title, description, status, plan_type, owner_id,
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
		if err := rows.Scan(&p.ID, &p.OrgID, &p.Title, &p.Description, &p.Status, &p.PlanType,
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
	StartDate   *FlexDate          `json:"start_date,omitempty"`
	EndDate     *FlexDate          `json:"end_date,omitempty"`
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
			req.StartDate.Time, planID, orgID); err != nil {
			return nil, fmt.Errorf("update start_date: %w", err)
		}
	}
	if req.EndDate != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE plans SET end_date = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
			req.EndDate.Time, planID, orgID); err != nil {
			return nil, fmt.Errorf("update end_date: %w", err)
		}
	}

	return s.GetPlan(ctx, planID, orgID)
}

// DeletePlan soft-deletes a plan and all its activities.
// Hard deletes are not supported in v1; use the migrations to purge if needed.
func (s *Service) DeletePlan(ctx context.Context, planID, orgID, actorID uuid.UUID) error {
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

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	slog.Info("plan deleted", "plan_id", planID, "org_id", orgID)
	auditlog.Record(ctx, s.db, auditlog.Entry{
		OrgID: orgID, UserID: actorID, Action: "plan.deleted",
		TableName: "plans", RecordID: planID,
	})
	return nil
}

// DuplicatePlan creates a full copy of a plan — including all of its
// non-deleted activities — owned by callerID. The duplicate always starts
// in "draft" status regardless of the source plan's status. Activity links
// are intentionally NOT copied: links reference activity IDs, and since the
// duplicate gets fresh IDs, carrying links over would require rewriting
// every link's source/target, which is easy to get subtly wrong. Plan
// owners can re-run auto-link detection on the new plan instead.
func (s *Service) DuplicatePlan(ctx context.Context, planID, orgID, callerID uuid.UUID) (*models.Plan, error) {
	src, err := s.GetPlan(ctx, planID, orgID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	newPlan := &models.Plan{
		ID:          uuid.New(),
		OrgID:       orgID,
		Title:       src.Title + " (copy)",
		Description: src.Description,
		Status:      models.PlanDraft,
		PlanType:    src.PlanType,
		OwnerID:     callerID,
		StartDate:   src.StartDate,
		EndDate:     src.EndDate,
	}
	err = tx.QueryRow(ctx,
		`INSERT INTO plans (id, org_id, title, description, status, plan_type, owner_id, start_date, end_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING created_at, updated_at`,
		newPlan.ID, newPlan.OrgID, newPlan.Title, newPlan.Description,
		newPlan.Status, newPlan.PlanType, newPlan.OwnerID, newPlan.StartDate, newPlan.EndDate,
	).Scan(&newPlan.CreatedAt, &newPlan.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create duplicate plan: %w", err)
	}

	// For local plans, pillars and objectives must be copied first — their
	// new IDs are what the copied activities' objective_id will point at.
	// pillarIDMap/objectiveIDMap translate source IDs to the freshly minted
	// destination IDs.
	pillarIDMap := map[uuid.UUID]uuid.UUID{}
	objectiveIDMap := map[uuid.UUID]uuid.UUID{}

	if newPlan.PlanType == models.PlanTypeLocal {
		pRows, err := tx.Query(ctx,
			`SELECT id, title, user_order FROM strategic_pillars
			 WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
			planID, orgID,
		)
		if err != nil {
			return nil, fmt.Errorf("load source pillars: %w", err)
		}
		type srcPillar struct {
			id        uuid.UUID
			title     string
			userOrder int
		}
		var pillars []srcPillar
		for pRows.Next() {
			var p srcPillar
			if err := pRows.Scan(&p.id, &p.title, &p.userOrder); err != nil {
				pRows.Close()
				return nil, err
			}
			pillars = append(pillars, p)
		}
		pRows.Close()
		if err := pRows.Err(); err != nil {
			return nil, err
		}
		for _, p := range pillars {
			newID := uuid.New()
			pillarIDMap[p.id] = newID
			if _, err := tx.Exec(ctx,
				`INSERT INTO strategic_pillars (id, plan_id, org_id, title, user_order)
				 VALUES ($1, $2, $3, $4, $5)`,
				newID, newPlan.ID, orgID, p.title, p.userOrder,
			); err != nil {
				return nil, fmt.Errorf("copy pillar: %w", err)
			}
		}

		oRows, err := tx.Query(ctx,
			`SELECT id, pillar_id, title, user_order FROM strategic_objectives
			 WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
			planID, orgID,
		)
		if err != nil {
			return nil, fmt.Errorf("load source objectives: %w", err)
		}
		type srcObjective struct {
			id        uuid.UUID
			pillarID  uuid.UUID
			title     string
			userOrder int
		}
		var objectives []srcObjective
		for oRows.Next() {
			var o srcObjective
			if err := oRows.Scan(&o.id, &o.pillarID, &o.title, &o.userOrder); err != nil {
				oRows.Close()
				return nil, err
			}
			objectives = append(objectives, o)
		}
		oRows.Close()
		if err := oRows.Err(); err != nil {
			return nil, err
		}
		for _, o := range objectives {
			newID := uuid.New()
			objectiveIDMap[o.id] = newID
			if _, err := tx.Exec(ctx,
				`INSERT INTO strategic_objectives (id, plan_id, pillar_id, org_id, title, user_order)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				newID, newPlan.ID, pillarIDMap[o.pillarID], orgID, o.title, o.userOrder,
			); err != nil {
				return nil, fmt.Errorf("copy objective: %w", err)
			}
		}
	}

	rows, err := tx.Query(ctx,
		`SELECT phase, objective_id, type, title, user_order, status, content,
		        assigned_to, due_date, budget, responsibility, target_period, kpis
		 FROM activities WHERE plan_id = $1 AND org_id = $2 AND deleted_at IS NULL
		 ORDER BY phase, objective_id, user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("load source activities: %w", err)
	}

	type srcActivity struct {
		phase          *models.Phase
		objectiveID    *uuid.UUID
		typ            string
		title          string
		userOrder      int
		status         models.ActivityStatus
		content        map[string]any
		assignedTo     []uuid.UUID
		dueDate        *time.Time
		budget         *float64
		responsibility *string
		targetPeriod   *string
		kpis           []models.KPI
	}
	var toCopy []srcActivity
	for rows.Next() {
		var a srcActivity
		if err := rows.Scan(&a.phase, &a.objectiveID, &a.typ, &a.title, &a.userOrder, &a.status,
			&a.content, &a.assignedTo, &a.dueDate, &a.budget, &a.responsibility,
			&a.targetPeriod, &a.kpis); err != nil {
			rows.Close()
			return nil, err
		}
		toCopy = append(toCopy, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, a := range toCopy {
		var newObjectiveID *uuid.UUID
		if a.objectiveID != nil {
			mapped := objectiveIDMap[*a.objectiveID]
			newObjectiveID = &mapped
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO activities
			 (id, plan_id, org_id, phase, objective_id, type, title, user_order, status, content,
			  assigned_to, due_date, budget, responsibility, target_period, kpis)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
			uuid.New(), newPlan.ID, orgID, a.phase, newObjectiveID, a.typ, a.title,
			a.userOrder, a.status, a.content, a.assignedTo, a.dueDate,
			a.budget, a.responsibility, a.targetPeriod, a.kpis,
		); err != nil {
			return nil, fmt.Errorf("copy activity: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	slog.Info("plan duplicated", "source_plan_id", planID, "new_plan_id", newPlan.ID, "org_id", orgID, "activities_copied", len(toCopy))
	auditlog.Record(ctx, s.db, auditlog.Entry{
		OrgID: orgID, UserID: callerID, Action: "plan.duplicated",
		TableName: "plans", RecordID: newPlan.ID,
		Diff: map[string]any{"source_plan_id": planID},
	})

	return newPlan, nil
}

// ── Activity CRUD ─────────────────────────────────────────────────────────

// CreateActivityRequest holds the fields for creating a new activity.
//
// Exactly one of Phase / ObjectiveID must be supplied, matching whichever
// hierarchy the target plan's PlanType uses: Phase for an "international"
// plan, ObjectiveID for a "local" plan. KPIs is only meaningful (and only
// accepted) for local-plan activities — Budget/Responsibility/TargetPeriod
// live inside each KPI (see models.KPI) rather than as separate fields
// here; validateKPIs below is what enforces TargetPeriod's enum for them.
type CreateActivityRequest struct {
	Phase       *models.Phase  `json:"phase,omitempty"`
	ObjectiveID *uuid.UUID     `json:"objective_id,omitempty"`
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Content     map[string]any `json:"content,omitempty"`
	AssignedTo  []uuid.UUID    `json:"assigned_to,omitempty"`
	DueDate     *FlexDate      `json:"due_date,omitempty"`

	KPIs []models.KPI `json:"kpis,omitempty"`
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
	if err := validateKPIs(req.KPIs); err != nil {
		return nil, err
	}

	// Verify the plan exists and belongs to this org, and fetch its
	// plan_type so we know which hierarchy field (Phase vs ObjectiveID)
	// this activity is required to use.
	plan, err := s.GetPlan(ctx, planID, orgID)
	if err != nil {
		return nil, err
	}

	switch plan.PlanType {
	case models.PlanTypeLocal:
		if req.ObjectiveID == nil {
			return nil, fmt.Errorf("objective_id is required for activities in a local plan")
		}
		if req.Phase != nil {
			return nil, fmt.Errorf("phase must not be set for activities in a local plan")
		}
		// Verify the objective exists, belongs to this org, and belongs to
		// this plan (a stray objective_id from another plan must not link in).
		var objectiveExists bool
		if err := s.db.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM strategic_objectives WHERE id = $1 AND plan_id = $2 AND org_id = $3)`,
			*req.ObjectiveID, planID, orgID,
		).Scan(&objectiveExists); err != nil {
			return nil, fmt.Errorf("check objective: %w", err)
		}
		if !objectiveExists {
			return nil, fmt.Errorf("strategic objective not found")
		}
	default: // international
		if req.Phase == nil {
			return nil, fmt.Errorf("phase is required for activities in an international plan")
		}
		if *req.Phase != models.PhaseP1 && *req.Phase != models.PhaseP2 && *req.Phase != models.PhaseP3 {
			return nil, fmt.Errorf("phase must be P1, P2, or P3")
		}
		if req.ObjectiveID != nil {
			return nil, fmt.Errorf("objective_id must not be set for activities in an international plan")
		}
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
	kpis := req.KPIs
	if kpis == nil {
		kpis = []models.KPI{}
	}

	a := &models.Activity{
		ID:          uuid.New(),
		PlanID:      planID,
		OrgID:       orgID,
		Phase:       req.Phase,
		ObjectiveID: req.ObjectiveID,
		Type:        req.Type,
		Title:       req.Title,
		UserOrder:   maxOrder + 1,
		Status:      models.ActivityNotStarted,
		Content:     content,
		AssignedTo:  assignedTo,
		DueDate:     req.DueDate.ToTimePtr(),
		KPIs:        kpis,
	}

	err = s.db.QueryRow(ctx,
		`INSERT INTO activities
		 (id, plan_id, org_id, phase, objective_id, type, title, user_order, status, content,
		  assigned_to, due_date, kpis)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		 RETURNING created_at, updated_at`,
		a.ID, a.PlanID, a.OrgID, a.Phase, a.ObjectiveID, a.Type, a.Title,
		a.UserOrder, a.Status, a.Content, a.AssignedTo, a.DueDate, a.KPIs,
	).Scan(&a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create activity: %w", err)
	}

	slog.Info("activity created", "activity_id", a.ID, "plan_id", planID, "plan_type", plan.PlanType)
	return a, nil
}

// validateKPIs enforces TargetPeriod's monthly/quarterly/annual enum on
// every KPI that sets one — the same constraint that used to live on
// Activity.TargetPeriod (migration 012) before Budget/Responsibility/
// TargetPeriod moved onto each KPI individually (migration 013). Checked
// here, alongside where each KPI's other fields are collected in the UI,
// rather than left as free text a Tracking Module gauge can't be computed
// from.
func validateKPIs(kpis []models.KPI) error {
	for i, k := range kpis {
		if k.TargetPeriod != nil && !k.TargetPeriod.Valid() {
			return fmt.Errorf("kpis[%d].target_period must be one of: monthly, quarterly, annual", i)
		}
	}
	return nil
}

// ListActivities returns all non-deleted activities for a plan.
// Optionally filter by phase, objectiveID, and/or status. Results are
// sorted by phase/objective then user_order.
func (s *Service) ListActivities(ctx context.Context, planID, orgID uuid.UUID, phase *models.Phase, objectiveID *uuid.UUID, status *models.ActivityStatus) ([]models.Activity, error) {
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

	query := `SELECT id, plan_id, org_id, phase, objective_id, type, title, user_order, status,
	                 content, ai_draft, assigned_to, due_date,
	                 kpis, created_at, updated_at
	          FROM activities
	          WHERE plan_id = $1 AND deleted_at IS NULL`
	args := []any{planID}

	if phase != nil {
		args = append(args, *phase)
		query += fmt.Sprintf(" AND phase = $%d", len(args))
	}
	if objectiveID != nil {
		args = append(args, *objectiveID)
		query += fmt.Sprintf(" AND objective_id = $%d", len(args))
	}
	if status != nil {
		args = append(args, *status)
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY phase, objective_id, user_order"

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list activities: %w", err)
	}
	defer rows.Close()

	activities := make([]models.Activity, 0)
	for rows.Next() {
		var a models.Activity
		if err := rows.Scan(
			&a.ID, &a.PlanID, &a.OrgID, &a.Phase, &a.ObjectiveID, &a.Type, &a.Title, &a.UserOrder,
			&a.Status, &a.Content, &a.AIDraft, &a.AssignedTo, &a.DueDate,
			&a.KPIs,
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
	DueDate    *FlexDate              `json:"due_date,omitempty"`

	// Local-plan-only field — harmless no-op if sent for an
	// international-plan activity, but the frontend should only ever send
	// this for local plans. Budget/Responsibility/TargetPeriod live inside
	// each KPI (see models.KPI) rather than as separate fields here.
	KPIs []models.KPI `json:"kpis,omitempty"`
}

// UpdateActivity applies a partial update to an activity.
// Contributors can only update activities assigned to them; planners/admins
// can update any activity in the plan. This is enforced by the caller
// (handler) before invoking this method.
func (s *Service) UpdateActivity(ctx context.Context, activityID, orgID uuid.UUID, req UpdateActivityRequest) (*models.Activity, error) {
	if req.Title == nil && req.Status == nil && req.Content == nil && req.AssignedTo == nil && req.DueDate == nil &&
		req.KPIs == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if err := validateKPIs(req.KPIs); err != nil {
		return nil, err
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
			req.DueDate.Time, activityID); err != nil {
			return nil, fmt.Errorf("update due_date: %w", err)
		}
	}
	if req.KPIs != nil {
		if _, err := s.db.Exec(ctx,
			`UPDATE activities SET kpis = $1, updated_at = NOW() WHERE id = $2`,
			req.KPIs, activityID); err != nil {
			return nil, fmt.Errorf("update kpis: %w", err)
		}
	}

	return s.getActivity(ctx, activityID, orgID)
}

// GetActivity fetches a single activity by ID, enforcing org scope.
// Exported for the standalone GET /api/v1/activities/{activityID} endpoint —
// previously the frontend had to fetch the whole activity list and filter
// client-side.
func (s *Service) GetActivity(ctx context.Context, activityID, orgID uuid.UUID) (*models.Activity, error) {
	return s.getActivity(ctx, activityID, orgID)
}

// DeleteActivity soft-deletes an activity and cascades the delete to any
// activity_links that reference it as source or target, so the link graph
// never contains a dangling reference to a deleted activity.
func (s *Service) DeleteActivity(ctx context.Context, activityID, orgID, actorID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx,
		`UPDATE activities SET deleted_at = NOW(), updated_at = NOW()
		 WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		activityID, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete activity: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("activity not found")
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM activity_links WHERE source_id = $1 OR target_id = $1`,
		activityID,
	); err != nil {
		return fmt.Errorf("cascade delete links: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	slog.Info("activity deleted", "activity_id", activityID, "org_id", orgID)
	auditlog.Record(ctx, s.db, auditlog.Entry{
		OrgID: orgID, UserID: actorID, Action: "activity.deleted",
		TableName: "activities", RecordID: activityID,
	})
	return nil
}

// getActivity fetches a single activity by ID, enforcing org scope.
func (s *Service) getActivity(ctx context.Context, activityID, orgID uuid.UUID) (*models.Activity, error) {
	var a models.Activity
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, phase, objective_id, type, title, user_order, status,
		        content, ai_draft, assigned_to, due_date,
		        kpis, created_at, updated_at
		 FROM activities WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		activityID, orgID,
	).Scan(&a.ID, &a.PlanID, &a.OrgID, &a.Phase, &a.ObjectiveID, &a.Type, &a.Title, &a.UserOrder,
		&a.Status, &a.Content, &a.AIDraft, &a.AssignedTo, &a.DueDate,
		&a.KPIs,
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

// PillarProgress holds completion metrics for a single strategic pillar,
// the local-plan equivalent of PhaseProgress. Only populated when the
// plan's PlanType is "local" (Phases is used for "international" instead).
type PillarProgress struct {
	PillarID   uuid.UUID `json:"pillar_id"`
	Title      string    `json:"title"`
	Total      int       `json:"total"`
	Complete   int       `json:"complete"`
	InProgress int       `json:"in_progress"`
	Overdue    int       `json:"overdue"`
	Percent    float64   `json:"percent_complete"`
}

// PlanProgress is the full progress payload returned by GET /plans/:id/progress.
// Exactly one of Phases / Pillars is populated, matching the plan's PlanType.
type PlanProgress struct {
	PlanID     uuid.UUID         `json:"plan_id"`
	Status     models.PlanStatus `json:"status"`
	PlanType   models.PlanType   `json:"plan_type"`
	Phases     []PhaseProgress   `json:"phases,omitempty"`
	Pillars    []PillarProgress  `json:"pillars,omitempty"`
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

// GetProgress returns progress metrics for a plan. The breakdown returned
// depends on the plan's PlanType: "international" plans get per-phase
// (P1/P2/P3) breakdown in Phases; "local" plans get per-pillar breakdown in
// Pillars instead. Overall and Milestones are populated for both.
func (s *Service) GetProgress(ctx context.Context, planID, orgID uuid.UUID) (*PlanProgress, error) {
	plan, err := s.GetPlan(ctx, planID, orgID)
	if err != nil {
		return nil, err
	}

	type counts struct{ total, complete, inProgress, overdue int }
	pct := func(c *counts) float64 {
		if c.total == 0 {
			return 0
		}
		return float64(c.complete) / float64(c.total) * 100
	}

	overall := &counts{}
	var phases []PhaseProgress
	var pillars []PillarProgress

	if plan.PlanType == models.PlanTypeLocal {
		// Local plans group progress by pillar. An activity's pillar is
		// found by joining through its objective, so pillars with zero
		// activities still show up (LEFT JOIN from strategic_pillars).
		rows, err := s.db.Query(ctx,
			`SELECT sp.id, sp.title, a.status,
			        COUNT(a.id) AS cnt,
			        SUM(CASE WHEN a.due_date < CURRENT_DATE AND a.status != 'complete' THEN 1 ELSE 0 END) AS overdue
			 FROM strategic_pillars sp
			 LEFT JOIN strategic_objectives so ON so.pillar_id = sp.id
			 LEFT JOIN activities a ON a.objective_id = so.id AND a.deleted_at IS NULL
			 WHERE sp.plan_id = $1
			 GROUP BY sp.id, sp.title, a.status
			 ORDER BY sp.user_order`,
			planID,
		)
		if err != nil {
			return nil, fmt.Errorf("query pillar stats: %w", err)
		}
		defer rows.Close()

		pillarMap := map[uuid.UUID]*counts{}
		pillarTitles := map[uuid.UUID]string{}
		var pillarOrder []uuid.UUID

		for rows.Next() {
			var pillarID uuid.UUID
			var title string
			var status *string
			var cnt, overdue int
			if err := rows.Scan(&pillarID, &title, &status, &cnt, &overdue); err != nil {
				return nil, err
			}
			c, ok := pillarMap[pillarID]
			if !ok {
				c = &counts{}
				pillarMap[pillarID] = c
				pillarTitles[pillarID] = title
				pillarOrder = append(pillarOrder, pillarID)
			}
			if status == nil {
				continue // pillar has no activities at all — cnt is 0 from the LEFT JOIN
			}
			c.total += cnt
			c.overdue += overdue
			overall.total += cnt
			overall.overdue += overdue
			switch models.ActivityStatus(*status) {
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

		pillars = make([]PillarProgress, 0, len(pillarOrder))
		for _, pillarID := range pillarOrder {
			c := pillarMap[pillarID]
			pillars = append(pillars, PillarProgress{
				PillarID:   pillarID,
				Title:      pillarTitles[pillarID],
				Total:      c.total,
				Complete:   c.complete,
				InProgress: c.inProgress,
				Overdue:    c.overdue,
				Percent:    pct(c),
			})
		}
	} else {
		// International plans group progress by phase (P1/P2/P3), fixed set.
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

		phaseMap := map[models.Phase]*counts{
			models.PhaseP1: {},
			models.PhaseP2: {},
			models.PhaseP3: {},
		}

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

		phases = make([]PhaseProgress, 0, 3)
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
		PlanID:   plan.ID,
		Status:   plan.Status,
		PlanType: plan.PlanType,
		Phases:   phases,
		Pillars:  pillars,
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

	// Prevent cycles (REQ-F-042).
	hasCycle, err := s.hasCycle(ctx, req.TargetID, sourceID)
	if err != nil {
		return nil, fmt.Errorf("cycle check: %w", err)
	}
	if hasCycle {
		return nil, fmt.Errorf("this link would create a cycle")
	}

	link := &models.ActivityLink{
		ID:        uuid.New(),
		PlanID:    sourcePlanID,
		SourceID:  sourceID,
		TargetID:  req.TargetID,
		LinkType:  req.LinkType,
		CreatedBy: creatorID,
	}

	err = s.db.QueryRow(ctx,
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

// DeleteActivityLink removes a single activity link. activityID is accepted
// so the handler can scope the delete to a link that actually touches that
// activity (as source or target) — it's not enough to just check org_id,
// since that would let any org member delete any link in the org by ID.
func (s *Service) DeleteActivityLink(ctx context.Context, activityID, linkID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx,
		`DELETE FROM activity_links
		 WHERE id = $1
		   AND (source_id = $2 OR target_id = $2)
		   AND plan_id IN (SELECT id FROM plans WHERE org_id = $3)`,
		linkID, activityID, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete activity link: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("link not found")
	}
	return nil
}
