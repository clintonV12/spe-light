// situational_analysis.go — Chapter 3 (Situational Analysis) for local
// plans: Stakeholder Analysis, SWOT Analysis, PESTEL Analysis.
//
// Routes wired in router.go:
//
//	GET    /api/v1/plans/{planID}/stakeholders     — list
//	POST   /api/v1/plans/{planID}/stakeholders     — create
//	PUT    /api/v1/stakeholders/{stakeholderID}      — update
//	DELETE /api/v1/stakeholders/{stakeholderID}      — delete
//
//	GET    /api/v1/plans/{planID}/swot-items       — list
//	POST   /api/v1/plans/{planID}/swot-items       — create
//	PUT    /api/v1/swot-items/{swotItemID}           — update
//	DELETE /api/v1/swot-items/{swotItemID}           — delete
//
//	GET    /api/v1/plans/{planID}/pestel-items     — list
//	POST   /api/v1/plans/{planID}/pestel-items     — create
//	PUT    /api/v1/pestel-items/{pestelItemID}       — update
//	DELETE /api/v1/pestel-items/{pestelItemID}       — delete
package plansvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ── Stakeholders ──────────────────────────────────────────────────────────

type CreateStakeholderRequest struct {
	Name      string                  `json:"name"`
	Influence models.StakeholderLevel `json:"influence"`
	Interest  models.StakeholderLevel `json:"interest"`
	Notes     *string                 `json:"notes,omitempty"`
}

func validStakeholderLevel(l models.StakeholderLevel) bool {
	return l == models.StakeholderHigh || l == models.StakeholderLow
}

func (s *Service) CreateStakeholder(ctx context.Context, planID, orgID uuid.UUID, req CreateStakeholderRequest) (*models.Stakeholder, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if !validStakeholderLevel(req.Influence) || !validStakeholderLevel(req.Interest) {
		return nil, fmt.Errorf("influence and interest must be 'high' or 'low'")
	}
	if err := s.requirePlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM stakeholders WHERE plan_id = $1`,
		planID,
	).Scan(&maxOrder)

	st := &models.Stakeholder{
		ID: uuid.New(), PlanID: planID, OrgID: orgID,
		Name: req.Name, Influence: req.Influence, Interest: req.Interest,
		Notes: req.Notes, UserOrder: maxOrder + 1,
	}
	err := s.db.QueryRow(ctx,
		`INSERT INTO stakeholders (id, plan_id, org_id, name, influence, interest, notes, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING created_at, updated_at`,
		st.ID, st.PlanID, st.OrgID, st.Name, st.Influence, st.Interest, st.Notes, st.UserOrder,
	).Scan(&st.CreatedAt, &st.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create stakeholder: %w", err)
	}
	return st, nil
}

func (s *Service) ListStakeholders(ctx context.Context, planID, orgID uuid.UUID) ([]models.Stakeholder, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, name, influence, interest, notes, user_order, created_at, updated_at
		 FROM stakeholders WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list stakeholders: %w", err)
	}
	defer rows.Close()

	items := make([]models.Stakeholder, 0)
	for rows.Next() {
		var st models.Stakeholder
		if err := rows.Scan(&st.ID, &st.PlanID, &st.OrgID, &st.Name, &st.Influence, &st.Interest, &st.Notes, &st.UserOrder, &st.CreatedAt, &st.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, st)
	}
	return items, rows.Err()
}

type UpdateStakeholderRequest struct {
	Name      *string                  `json:"name,omitempty"`
	Influence *models.StakeholderLevel `json:"influence,omitempty"`
	Interest  *models.StakeholderLevel `json:"interest,omitempty"`
	Notes     *string                  `json:"notes,omitempty"`
	UserOrder *int                     `json:"user_order,omitempty"`
}

func (s *Service) UpdateStakeholder(ctx context.Context, stakeholderID, orgID uuid.UUID, req UpdateStakeholderRequest) (*models.Stakeholder, error) {
	if req.Name == nil && req.Influence == nil && req.Interest == nil && req.Notes == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Influence != nil && !validStakeholderLevel(*req.Influence) {
		return nil, fmt.Errorf("influence must be 'high' or 'low'")
	}
	if req.Interest != nil && !validStakeholderLevel(*req.Interest) {
		return nil, fmt.Errorf("interest must be 'high' or 'low'")
	}

	if req.Name != nil {
		if *req.Name == "" {
			return nil, fmt.Errorf("name cannot be empty")
		}
		if _, err := s.db.Exec(ctx, `UPDATE stakeholders SET name = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Name, stakeholderID, orgID); err != nil {
			return nil, fmt.Errorf("update stakeholder name: %w", err)
		}
	}
	if req.Influence != nil {
		if _, err := s.db.Exec(ctx, `UPDATE stakeholders SET influence = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Influence, stakeholderID, orgID); err != nil {
			return nil, fmt.Errorf("update stakeholder influence: %w", err)
		}
	}
	if req.Interest != nil {
		if _, err := s.db.Exec(ctx, `UPDATE stakeholders SET interest = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Interest, stakeholderID, orgID); err != nil {
			return nil, fmt.Errorf("update stakeholder interest: %w", err)
		}
	}
	if req.Notes != nil {
		if _, err := s.db.Exec(ctx, `UPDATE stakeholders SET notes = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Notes, stakeholderID, orgID); err != nil {
			return nil, fmt.Errorf("update stakeholder notes: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx, `UPDATE stakeholders SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.UserOrder, stakeholderID, orgID); err != nil {
			return nil, fmt.Errorf("update stakeholder order: %w", err)
		}
	}

	var st models.Stakeholder
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, name, influence, interest, notes, user_order, created_at, updated_at
		 FROM stakeholders WHERE id = $1 AND org_id = $2`,
		stakeholderID, orgID,
	).Scan(&st.ID, &st.PlanID, &st.OrgID, &st.Name, &st.Influence, &st.Interest, &st.Notes, &st.UserOrder, &st.CreatedAt, &st.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("stakeholder not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get stakeholder: %w", err)
	}
	return &st, nil
}

func (s *Service) DeleteStakeholder(ctx context.Context, stakeholderID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM stakeholders WHERE id = $1 AND org_id = $2`, stakeholderID, orgID)
	if err != nil {
		return fmt.Errorf("delete stakeholder: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("stakeholder not found")
	}
	return nil
}

// ── SWOT items ────────────────────────────────────────────────────────────

type CreateSWOTItemRequest struct {
	Category models.SWOTCategory `json:"category"`
	Text     string              `json:"text"`
}

func validSWOTCategory(c models.SWOTCategory) bool {
	switch c {
	case models.SWOTStrength, models.SWOTWeakness, models.SWOTOpportunity, models.SWOTThreat:
		return true
	}
	return false
}

func (s *Service) CreateSWOTItem(ctx context.Context, planID, orgID uuid.UUID, req CreateSWOTItemRequest) (*models.SWOTItem, error) {
	if req.Text == "" {
		return nil, fmt.Errorf("text is required")
	}
	if !validSWOTCategory(req.Category) {
		return nil, fmt.Errorf("category must be one of: strength, weakness, opportunity, threat")
	}
	if err := s.requirePlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM swot_items WHERE plan_id = $1 AND category = $2`,
		planID, req.Category,
	).Scan(&maxOrder)

	item := &models.SWOTItem{ID: uuid.New(), PlanID: planID, OrgID: orgID, Category: req.Category, Text: req.Text, UserOrder: maxOrder + 1}
	err := s.db.QueryRow(ctx,
		`INSERT INTO swot_items (id, plan_id, org_id, category, text, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at, updated_at`,
		item.ID, item.PlanID, item.OrgID, item.Category, item.Text, item.UserOrder,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create swot item: %w", err)
	}
	return item, nil
}

func (s *Service) ListSWOTItems(ctx context.Context, planID, orgID uuid.UUID) ([]models.SWOTItem, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, category, text, user_order, created_at, updated_at
		 FROM swot_items WHERE plan_id = $1 AND org_id = $2 ORDER BY category, user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list swot items: %w", err)
	}
	defer rows.Close()

	items := make([]models.SWOTItem, 0)
	for rows.Next() {
		var it models.SWOTItem
		if err := rows.Scan(&it.ID, &it.PlanID, &it.OrgID, &it.Category, &it.Text, &it.UserOrder, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

type UpdateSWOTItemRequest struct {
	Text      *string `json:"text,omitempty"`
	UserOrder *int    `json:"user_order,omitempty"`
}

func (s *Service) UpdateSWOTItem(ctx context.Context, itemID, orgID uuid.UUID, req UpdateSWOTItemRequest) (*models.SWOTItem, error) {
	if req.Text == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Text != nil {
		if *req.Text == "" {
			return nil, fmt.Errorf("text cannot be empty")
		}
		if _, err := s.db.Exec(ctx, `UPDATE swot_items SET text = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Text, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update swot item text: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx, `UPDATE swot_items SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.UserOrder, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update swot item order: %w", err)
		}
	}

	var it models.SWOTItem
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, category, text, user_order, created_at, updated_at
		 FROM swot_items WHERE id = $1 AND org_id = $2`, itemID, orgID,
	).Scan(&it.ID, &it.PlanID, &it.OrgID, &it.Category, &it.Text, &it.UserOrder, &it.CreatedAt, &it.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("swot item not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get swot item: %w", err)
	}
	return &it, nil
}

func (s *Service) DeleteSWOTItem(ctx context.Context, itemID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM swot_items WHERE id = $1 AND org_id = $2`, itemID, orgID)
	if err != nil {
		return fmt.Errorf("delete swot item: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("swot item not found")
	}
	return nil
}

// ── PESTEL items ──────────────────────────────────────────────────────────

type CreatePESTELItemRequest struct {
	Factor      models.PESTELFactor `json:"factor"`
	Implication *string             `json:"implication,omitempty"`
	Positive    *string             `json:"positive,omitempty"`
	Negative    *string             `json:"negative,omitempty"`
}

func validPESTELFactor(f models.PESTELFactor) bool {
	switch f {
	case models.PESTELPolitical, models.PESTELEconomic, models.PESTELSocial,
		models.PESTELTechnological, models.PESTELEnvironmental, models.PESTELLegal:
		return true
	}
	return false
}

func (s *Service) CreatePESTELItem(ctx context.Context, planID, orgID uuid.UUID, req CreatePESTELItemRequest) (*models.PESTELItem, error) {
	if !validPESTELFactor(req.Factor) {
		return nil, fmt.Errorf("factor must be one of: political, economic, social, technological, environmental, legal")
	}
	if req.Implication == nil && req.Positive == nil && req.Negative == nil {
		return nil, fmt.Errorf("at least one of implication, positive, or negative is required")
	}
	if err := s.requirePlan(ctx, planID, orgID); err != nil {
		return nil, err
	}

	var maxOrder int
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(user_order), 0) FROM pestel_items WHERE plan_id = $1 AND factor = $2`,
		planID, req.Factor,
	).Scan(&maxOrder)

	item := &models.PESTELItem{
		ID: uuid.New(), PlanID: planID, OrgID: orgID, Factor: req.Factor,
		Implication: req.Implication, Positive: req.Positive, Negative: req.Negative,
		UserOrder: maxOrder + 1,
	}
	err := s.db.QueryRow(ctx,
		`INSERT INTO pestel_items (id, plan_id, org_id, factor, implication, positive, negative, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING created_at, updated_at`,
		item.ID, item.PlanID, item.OrgID, item.Factor, item.Implication, item.Positive, item.Negative, item.UserOrder,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create pestel item: %w", err)
	}
	return item, nil
}

func (s *Service) ListPESTELItems(ctx context.Context, planID, orgID uuid.UUID) ([]models.PESTELItem, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, factor, implication, positive, negative, user_order, created_at, updated_at
		 FROM pestel_items WHERE plan_id = $1 AND org_id = $2 ORDER BY factor, user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list pestel items: %w", err)
	}
	defer rows.Close()

	items := make([]models.PESTELItem, 0)
	for rows.Next() {
		var it models.PESTELItem
		if err := rows.Scan(&it.ID, &it.PlanID, &it.OrgID, &it.Factor, &it.Implication, &it.Positive, &it.Negative, &it.UserOrder, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

type UpdatePESTELItemRequest struct {
	Implication *string `json:"implication,omitempty"`
	Positive    *string `json:"positive,omitempty"`
	Negative    *string `json:"negative,omitempty"`
	UserOrder   *int    `json:"user_order,omitempty"`
}

func (s *Service) UpdatePESTELItem(ctx context.Context, itemID, orgID uuid.UUID, req UpdatePESTELItemRequest) (*models.PESTELItem, error) {
	if req.Implication == nil && req.Positive == nil && req.Negative == nil && req.UserOrder == nil {
		return nil, fmt.Errorf("nothing to update")
	}
	if req.Implication != nil {
		if _, err := s.db.Exec(ctx, `UPDATE pestel_items SET implication = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Implication, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update pestel implication: %w", err)
		}
	}
	if req.Positive != nil {
		if _, err := s.db.Exec(ctx, `UPDATE pestel_items SET positive = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Positive, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update pestel positive: %w", err)
		}
	}
	if req.Negative != nil {
		if _, err := s.db.Exec(ctx, `UPDATE pestel_items SET negative = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.Negative, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update pestel negative: %w", err)
		}
	}
	if req.UserOrder != nil {
		if _, err := s.db.Exec(ctx, `UPDATE pestel_items SET user_order = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, *req.UserOrder, itemID, orgID); err != nil {
			return nil, fmt.Errorf("update pestel order: %w", err)
		}
	}

	var it models.PESTELItem
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, factor, implication, positive, negative, user_order, created_at, updated_at
		 FROM pestel_items WHERE id = $1 AND org_id = $2`, itemID, orgID,
	).Scan(&it.ID, &it.PlanID, &it.OrgID, &it.Factor, &it.Implication, &it.Positive, &it.Negative, &it.UserOrder, &it.CreatedAt, &it.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("pestel item not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get pestel item: %w", err)
	}
	return &it, nil
}

func (s *Service) DeletePESTELItem(ctx context.Context, itemID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM pestel_items WHERE id = $1 AND org_id = $2`, itemID, orgID)
	if err != nil {
		return fmt.Errorf("delete pestel item: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("pestel item not found")
	}
	return nil
}
