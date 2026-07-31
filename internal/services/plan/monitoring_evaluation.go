// monitoring_evaluation.go — Chapter 7 (Monitoring & Evaluation) for local
// plans. One table with a category discriminator (see MECategory in
// models_local_sections.go) covering M&E objectives, critical success
// factors, review-cadence notes, and conclusion/rollout measures — the
// ESWAMCU doc presents these as short bulleted lists under separate
// sub-headings rather than a matrix, so a flat categorized list is a closer
// fit than another pillar-style hierarchy.
//
// Routes wired in router.go:
//
//	GET    /api/v1/plans/{planID}/me-items   — list (optionally ?category=)
//	POST   /api/v1/plans/{planID}/me-items   — create
//	PUT    /api/v1/me-items/{meItemID}         — update
//	DELETE /api/v1/me-items/{meItemID}         — delete
package plansvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CreateMEItemRequest struct {
	Category models.MECategory `json:"category"`
	Text     string            `json:"text"`
}

func validMECategory(c models.MECategory) bool {
	switch c {
	case models.MEObjective, models.MECriticalSuccessFactor, models.MEReviewNote, models.MEConclusionMeasure:
		return true
	}
	return false
}

func (s *Service) CreateMEItem(ctx context.Context, planID, orgID uuid.UUID, req CreateMEItemRequest) (*models.MEItem, error) {
	if req.Text == "" {
		return nil, fmt.Errorf("text is required")
	}
	if !validMECategory(req.Category) {
		return nil, fmt.Errorf("category must be one of: objective, critical_success_factor, review_note, conclusion_measure")
	}
	if err := s.requireLocalPlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM me_items WHERE plan_id = $1 AND category = $2`,
		planID, req.Category,
	).Scan(&maxOrder)

	item := &models.MEItem{ID: uuid.New(), PlanID: planID, OrgID: orgID, Category: req.Category, Text: req.Text, UserOrder: maxOrder + 1}
	err := s.db.QueryRow(ctx,
		`INSERT INTO me_items (id, plan_id, org_id, category, text, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at, updated_at`,
		item.ID, item.PlanID, item.OrgID, item.Category, item.Text, item.UserOrder,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create me item: %w", err)
	}
	return item, nil
}

// ListMEItems returns all M&E items for a plan. If category is non-nil,
// only items in that category are returned.
func (s *Service) ListMEItems(ctx context.Context, planID, orgID uuid.UUID, category *models.MECategory) ([]models.MEItem, error) {
	var rows interface {
		Next() bool
		Scan(...any) error
		Err() error
		Close()
	}
	var err error
	if category == nil {
		rows, err = s.db.Query(ctx,
			`SELECT id, plan_id, org_id, category, text, user_order, created_at, updated_at
			 FROM me_items WHERE plan_id = $1 AND org_id = $2 ORDER BY category, user_order`,
			planID, orgID,
		)
	} else {
		rows, err = s.db.Query(ctx,
			`SELECT id, plan_id, org_id, category, text, user_order, created_at, updated_at
			 FROM me_items WHERE plan_id = $1 AND org_id = $2 AND category = $3 ORDER BY user_order`,
			planID, orgID, *category,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("list me items: %w", err)
	}
	defer rows.Close()

	items := make([]models.MEItem, 0)
	for rows.Next() {
		var it models.MEItem
		if err := rows.Scan(&it.ID, &it.PlanID, &it.OrgID, &it.Category, &it.Text, &it.UserOrder, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

type UpdateMEItemRequest struct {
	Text      *string `json:"text,omitempty"`
	UserOrder *int    `json:"user_order,omitempty"`
}

func (s *Service) UpdateMEItem(ctx context.Context, itemID, orgID uuid.UUID, req UpdateMEItemRequest) (*models.MEItem, error) {
	if req.Text == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Text != nil {
		if *req.Text == "" {
			return nil, fmt.Errorf("text cannot be empty")
		}
		if _, err := s.db.Exec(ctx, `UPDATE me_items SET text = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Text, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update me item text: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx, `UPDATE me_items SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.UserOrder, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update me item order: %w", err)
		}
	}

	var it models.MEItem
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, category, text, user_order, created_at, updated_at
		 FROM me_items WHERE id = $1 AND org_id = $2`, itemID, orgID,
	).Scan(&it.ID, &it.PlanID, &it.OrgID, &it.Category, &it.Text, &it.UserOrder, &it.CreatedAt, &it.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("me item not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get me item: %w", err)
	}
	return &it, nil
}

func (s *Service) DeleteMEItem(ctx context.Context, itemID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM me_items WHERE id = $1 AND org_id = $2`, itemID, orgID)
	if err != nil {
		return fmt.Errorf("delete me item: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("me item not found")
	}
	return nil
}
