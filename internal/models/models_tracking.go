// models_tracking.go — domain structs for the Tracking Module (migration
// 010_kpi_tracking).
//
// Distinct from the `KPI` struct in models.go, which is an unstructured
// {indicator, target} pair embedded in a local-plan Activity's `kpis` JSONB
// column, purely descriptive and never measured against an actual value.
// A TrackedKPI here is a first-class, addressable row belonging directly to
// a Plan (works for both international and local plans), with its own id,
// so it can carry Target/Actual measurements across the three fixed
// reporting periods and be aggregated into a plan-wide completion score.
package models

import (
	"time"

	"github.com/google/uuid"
)

// KPIDirection controls how a measurement's achievement percentage is
// derived from its Target/Actual pair — see KPIMeasurement.Achievement.
// "increase" is for KPIs where a higher Actual is better (e.g. revenue
// growth); "decrease" is for KPIs where a lower Actual is better (e.g.
// defect rate).
type KPIDirection string

const (
	KPIDirectionIncrease KPIDirection = "increase"
	KPIDirectionDecrease KPIDirection = "decrease"
)

// KPIPeriod is one of the reporting periods a TrackedKPI is measured
// against. Deliberately a free-form checked string (validated against
// ValidKPIPeriods) rather than three hardcoded struct fields, so a fourth
// period (e.g. "weekly") can be added later by extending that one slice —
// plus the DB CHECK constraint — rather than restructuring either table or
// touching every call site.
type KPIPeriod string

const (
	KPIPeriodMonthly   KPIPeriod = "monthly"
	KPIPeriodQuarterly KPIPeriod = "quarterly"
	KPIPeriodAnnual    KPIPeriod = "annual"
)

// ValidKPIPeriods is the ordered set of periods the Tracking Module
// currently supports, in display order.
var ValidKPIPeriods = []KPIPeriod{KPIPeriodMonthly, KPIPeriodQuarterly, KPIPeriodAnnual}

// Valid reports whether p is one of ValidKPIPeriods.
func (p KPIPeriod) Valid() bool {
	for _, v := range ValidKPIPeriods {
		if p == v {
			return true
		}
	}
	return false
}

// TrackedKPI is one Key Performance Indicator tracked by the Tracking
// Module, scoped directly to a Plan.
type TrackedKPI struct {
	ID        uuid.UUID    `json:"id"         db:"id"`
	PlanID    uuid.UUID    `json:"plan_id"    db:"plan_id"`
	OrgID     uuid.UUID    `json:"org_id"     db:"org_id"`
	Name      string       `json:"name"       db:"name"`
	Direction KPIDirection `json:"direction"  db:"direction"`
	UserOrder int          `json:"user_order" db:"user_order"`
	CreatedAt time.Time    `json:"created_at" db:"created_at"`
	UpdatedAt time.Time    `json:"updated_at" db:"updated_at"`
}

// KPIMeasurement holds one period's Target/Actual pair for one TrackedKPI.
// At most one row exists per (kpi_id, period) — enforced by a UNIQUE
// constraint, see tracking.go's migration comment. Target/Actual are
// nullable: a KPI can exist before any numbers have been entered for a
// given period, and the achievement percentage is simply unavailable until
// both are present.
type KPIMeasurement struct {
	ID          uuid.UUID `json:"id"                     db:"id"`
	KPIID       uuid.UUID `json:"kpi_id"                 db:"kpi_id"`
	PlanID      uuid.UUID `json:"plan_id"                db:"plan_id"`
	OrgID       uuid.UUID `json:"org_id"                 db:"org_id"`
	Period      KPIPeriod `json:"period"                 db:"period"`
	TargetValue *float64  `json:"target_value,omitempty" db:"target_value"`
	ActualValue *float64  `json:"actual_value,omitempty" db:"actual_value"`
	CreatedAt   time.Time `json:"created_at"             db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"             db:"updated_at"`
}

// Achievement returns this measurement's achievement percentage and
// whether it could be computed at all (both Target and Actual must be
// present, and the relevant value must be non-zero).
//
//	direction == increase:  pct = actual / target * 100   (higher is better)
//	direction == decrease:  pct = target / actual * 100   (lower is better)
//
// Neither formula is capped at 100 — overachievement (e.g. actual 120 vs.
// target 100) is meaningful and returned as >100 rather than clamped;
// callers that want a capped visual (e.g. a progress bar) can clamp at the
// display layer.
func (m KPIMeasurement) Achievement(direction KPIDirection) (pct float64, ok bool) {
	if m.TargetValue == nil || m.ActualValue == nil {
		return 0, false
	}
	target, actual := *m.TargetValue, *m.ActualValue
	if direction == KPIDirectionDecrease {
		if actual == 0 {
			return 0, false
		}
		return (target / actual) * 100, true
	}
	if target == 0 {
		return 0, false
	}
	return (actual / target) * 100, true
}
