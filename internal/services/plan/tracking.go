// tracking.go — Tracking Module business logic (migration 010_kpi_tracking).
//
// Two new tables back this file:
//
//	CREATE TABLE kpis (
//	  id          uuid PRIMARY KEY,
//	  plan_id     uuid NOT NULL REFERENCES plans(id),
//	  org_id      uuid NOT NULL REFERENCES organisations(id),
//	  name        text NOT NULL,
//	  direction   text NOT NULL DEFAULT 'increase' CHECK (direction IN ('increase','decrease')),
//	  user_order  int NOT NULL DEFAULT 0,
//	  created_at  timestamptz NOT NULL DEFAULT now(),
//	  updated_at  timestamptz NOT NULL DEFAULT now()
//	);
//
//	CREATE TABLE kpi_measurements (
//	  id            uuid PRIMARY KEY,
//	  kpi_id        uuid NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
//	  plan_id       uuid NOT NULL REFERENCES plans(id),
//	  org_id        uuid NOT NULL REFERENCES organisations(id),
//	  period        text NOT NULL CHECK (period IN ('monthly','quarterly','annual')),
//	  target_value  double precision,
//	  actual_value  double precision,
//	  created_at    timestamptz NOT NULL DEFAULT now(),
//	  updated_at    timestamptz NOT NULL DEFAULT now(),
//	  UNIQUE (kpi_id, period)
//	);
//
// KPIPeriod (models_tracking.go) is deliberately a checked string rather
// than three hardcoded columns, and models.ValidKPIPeriods is the single
// place listing the currently-supported periods — adding a fourth period
// later means extending that slice and the CHECK constraint above, not
// restructuring either table or any of the methods below.
//
// Works for both plan types — a KPI belongs directly to a Plan, not to a
// Phase or StrategicObjective, so the same Tracking Module UI works
// unmodified for international and local plans alike.
package plansvc

import (
	"context"
	"fmt"
	"log/slog"

	"spe-light/internal/models"

	"github.com/google/uuid"
)

// KPIWithMeasurements bundles a KPI with whatever Monthly/Quarterly/Annual
// measurements have been entered so far, keyed by period, so the frontend
// can hydrate the whole Tracking Module in a single request. A period with
// no measurement yet is simply absent from the map.
type KPIWithMeasurements struct {
	models.TrackedKPI
	Measurements map[models.KPIPeriod]models.KPIMeasurement `json:"measurements"`
}

// ListKPIs returns every KPI tracked for a plan, each with its measurements.
func (s *Service) ListKPIs(ctx context.Context, planID, orgID uuid.UUID) ([]KPIWithMeasurements, error) {
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

	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, name, direction, user_order, created_at, updated_at
		 FROM kpis WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list kpis: %w", err)
	}
	kpis := make([]KPIWithMeasurements, 0)
	for rows.Next() {
		var k models.TrackedKPI
		if err := rows.Scan(&k.ID, &k.PlanID, &k.OrgID, &k.Name, &k.Direction, &k.UserOrder, &k.CreatedAt, &k.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		kpis = append(kpis, KPIWithMeasurements{TrackedKPI: k, Measurements: map[models.KPIPeriod]models.KPIMeasurement{}})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(kpis) == 0 {
		return kpis, nil
	}

	byID := make(map[uuid.UUID]*KPIWithMeasurements, len(kpis))
	for i := range kpis {
		byID[kpis[i].ID] = &kpis[i]
	}

	mrows, err := s.db.Query(ctx,
		`SELECT id, kpi_id, plan_id, org_id, period, target_value, actual_value, created_at, updated_at
		 FROM kpi_measurements WHERE plan_id = $1 AND org_id = $2`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list kpi measurements: %w", err)
	}
	defer mrows.Close()
	for mrows.Next() {
		var m models.KPIMeasurement
		if err := mrows.Scan(&m.ID, &m.KPIID, &m.PlanID, &m.OrgID, &m.Period, &m.TargetValue, &m.ActualValue, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		if entry, ok := byID[m.KPIID]; ok {
			entry.Measurements[m.Period] = m
		}
	}
	return kpis, mrows.Err()
}

// CreateKPIRequest holds the fields required to add a KPI to a plan's
// Tracking Module. Direction defaults to "increase" when omitted.
type CreateKPIRequest struct {
	Name      string               `json:"name"`
	Direction *models.KPIDirection `json:"direction,omitempty"`
}

// CreateKPI adds a new tracked KPI to a plan.
func (s *Service) CreateKPI(ctx context.Context, planID, orgID uuid.UUID, req CreateKPIRequest) (*models.TrackedKPI, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	direction := models.KPIDirectionIncrease
	if req.Direction != nil {
		if *req.Direction != models.KPIDirectionIncrease && *req.Direction != models.KPIDirectionDecrease {
			return nil, fmt.Errorf("direction must be 'increase' or 'decrease'")
		}
		direction = *req.Direction
	}

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

	var maxOrder int
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(MAX(user_order), 0) FROM kpis WHERE plan_id = $1`, planID).Scan(&maxOrder)

	k := &models.TrackedKPI{
		ID:        uuid.New(),
		PlanID:    planID,
		OrgID:     orgID,
		Name:      req.Name,
		Direction: direction,
		UserOrder: maxOrder + 1,
	}
	if err := s.db.QueryRow(ctx,
		`INSERT INTO kpis (id, plan_id, org_id, name, direction, user_order)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING created_at, updated_at`,
		k.ID, k.PlanID, k.OrgID, k.Name, k.Direction, k.UserOrder,
	).Scan(&k.CreatedAt, &k.UpdatedAt); err != nil {
		return nil, fmt.Errorf("create kpi: %w", err)
	}

	slog.Info("kpi created", "kpi_id", k.ID, "plan_id", planID)
	return k, nil
}

// UpdateKPIRequest carries the mutable fields of a tracked KPI. All fields
// are optional — supply only what needs changing.
type UpdateKPIRequest struct {
	Name      *string              `json:"name,omitempty"`
	Direction *models.KPIDirection `json:"direction,omitempty"`
}

// UpdateKPI renames a KPI and/or flips its direction.
func (s *Service) UpdateKPI(ctx context.Context, kpiID, orgID uuid.UUID, req UpdateKPIRequest) (*models.TrackedKPI, error) {
	if req.Direction != nil && *req.Direction != models.KPIDirectionIncrease && *req.Direction != models.KPIDirectionDecrease {
		return nil, fmt.Errorf("direction must be 'increase' or 'decrease'")
	}
	if req.Name == nil && req.Direction == nil {
		return s.getKPI(ctx, kpiID, orgID)
	}

	result, err := s.db.Exec(ctx,
		`UPDATE kpis SET
		   name       = COALESCE($3, name),
		   direction  = COALESCE($4, direction),
		   updated_at = NOW()
		 WHERE id = $1 AND org_id = $2`,
		kpiID, orgID, req.Name, req.Direction,
	)
	if err != nil {
		return nil, fmt.Errorf("update kpi: %w", err)
	}
	if result.RowsAffected() == 0 {
		return nil, fmt.Errorf("kpi not found")
	}
	return s.getKPI(ctx, kpiID, orgID)
}

func (s *Service) getKPI(ctx context.Context, kpiID, orgID uuid.UUID) (*models.TrackedKPI, error) {
	var k models.TrackedKPI
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, name, direction, user_order, created_at, updated_at
		 FROM kpis WHERE id = $1 AND org_id = $2`,
		kpiID, orgID,
	).Scan(&k.ID, &k.PlanID, &k.OrgID, &k.Name, &k.Direction, &k.UserOrder, &k.CreatedAt, &k.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("kpi not found")
	}
	return &k, nil
}

// DeleteKPI removes a tracked KPI. Its measurements cascade via
// kpi_measurements.kpi_id's ON DELETE CASCADE.
func (s *Service) DeleteKPI(ctx context.Context, kpiID, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM kpis WHERE id = $1 AND org_id = $2`, kpiID, orgID)
	if err != nil {
		return fmt.Errorf("delete kpi: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("kpi not found")
	}
	return nil
}

// UpsertMeasurementRequest carries a period's Target/Actual pair. Both are
// optional independently — a user might enter next quarter's Target well
// before the Actual is known.
type UpsertMeasurementRequest struct {
	TargetValue *float64 `json:"target_value"`
	ActualValue *float64 `json:"actual_value"`
}

// UpsertMeasurement creates or replaces the Target/Actual pair for one KPI
// in one reporting period. There is at most one row per (kpi_id, period) —
// see the UNIQUE constraint in the migration comment above — so this is a
// single INSERT ... ON CONFLICT DO UPDATE rather than a separate
// create/update pair, matching how a user actually interacts with this
// screen: there's no meaningful "create" vs. "edit" distinction from their
// point of view, just "the Q1 numbers".
func (s *Service) UpsertMeasurement(ctx context.Context, kpiID, orgID uuid.UUID, period models.KPIPeriod, req UpsertMeasurementRequest) (*models.KPIMeasurement, error) {
	if !period.Valid() {
		return nil, fmt.Errorf("period must be one of: monthly, quarterly, annual")
	}

	var planID uuid.UUID
	if err := s.db.QueryRow(ctx,
		`SELECT plan_id FROM kpis WHERE id = $1 AND org_id = $2`,
		kpiID, orgID,
	).Scan(&planID); err != nil {
		return nil, fmt.Errorf("kpi not found")
	}

	m := &models.KPIMeasurement{
		ID:          uuid.New(),
		KPIID:       kpiID,
		PlanID:      planID,
		OrgID:       orgID,
		Period:      period,
		TargetValue: req.TargetValue,
		ActualValue: req.ActualValue,
	}
	err := s.db.QueryRow(ctx,
		`INSERT INTO kpi_measurements (id, kpi_id, plan_id, org_id, period, target_value, actual_value)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (kpi_id, period) DO UPDATE SET
		   target_value = EXCLUDED.target_value,
		   actual_value = EXCLUDED.actual_value,
		   updated_at   = NOW()
		 RETURNING id, created_at, updated_at`,
		m.ID, m.KPIID, m.PlanID, m.OrgID, m.Period, m.TargetValue, m.ActualValue,
	).Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("save measurement: %w", err)
	}
	return m, nil
}
