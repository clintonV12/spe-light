// models_local_sections.go — domain structs for local-plan chapters 2, 3, 6,
// and 7 (see migration 009_local_plan_sections). Chapters 4/5 already have
// their models in models.go (StrategicPillar, StrategicObjective, and the
// Budget/Responsibility/TargetPeriod/KPIs fields on Activity).
//
// Same conventions as the rest of models.go: pointer fields are nullable in
// the DB, db:"..." tags map to columns for pgx scanning.
package models

import (
	"time"

	"github.com/google/uuid"
)

// ── Chapter 2: Strategic Focus ──────────────────────────────────────────────
//
// Vision and Mission are singleton text and live directly on Plan (see
// Plan.Vision / Plan.Mission in models.go's Plan struct — add there rather
// than duplicating a Plan type here).

type CoreValue struct {
	ID          uuid.UUID `json:"id"                   db:"id"`
	PlanID      uuid.UUID `json:"plan_id"              db:"plan_id"`
	OrgID       uuid.UUID `json:"org_id"               db:"org_id"`
	Name        string    `json:"name"                 db:"name"`
	Description *string   `json:"description,omitempty" db:"description"`
	UserOrder   int       `json:"user_order"           db:"user_order"`
	CreatedAt   time.Time `json:"created_at"           db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"           db:"updated_at"`
}

// ── Chapter 3: Situational Analysis ─────────────────────────────────────────

type StakeholderLevel string

const (
	StakeholderHigh StakeholderLevel = "high"
	StakeholderLow  StakeholderLevel = "low"
)

// Stakeholder is one row of the power/interest grid (Table 1 in the ESWAMCU
// doc). Quadrant is derived at read time from Influence x Interest rather
// than stored, so relabeling the quadrant names never requires a migration.
type Stakeholder struct {
	ID        uuid.UUID        `json:"id"         db:"id"`
	PlanID    uuid.UUID        `json:"plan_id"    db:"plan_id"`
	OrgID     uuid.UUID        `json:"org_id"     db:"org_id"`
	Name      string           `json:"name"       db:"name"`
	Influence StakeholderLevel `json:"influence"  db:"influence"`
	Interest  StakeholderLevel `json:"interest"   db:"interest"`
	Notes     *string          `json:"notes,omitempty" db:"notes"`
	UserOrder int              `json:"user_order" db:"user_order"`
	CreatedAt time.Time        `json:"created_at" db:"created_at"`
	UpdatedAt time.Time        `json:"updated_at" db:"updated_at"`
}

// StakeholderQuadrant returns the human-readable grid label the ESWAMCU doc
// uses for a given influence/interest pair.
func StakeholderQuadrant(influence, interest StakeholderLevel) string {
	switch {
	case influence == StakeholderHigh && interest == StakeholderHigh:
		return "manage_closely"
	case influence == StakeholderHigh && interest == StakeholderLow:
		return "keep_satisfied"
	case influence == StakeholderLow && interest == StakeholderHigh:
		return "keep_informed"
	default:
		return "monitor"
	}
}

type SWOTCategory string

const (
	SWOTStrength    SWOTCategory = "strength"
	SWOTWeakness    SWOTCategory = "weakness"
	SWOTOpportunity SWOTCategory = "opportunity"
	SWOTThreat      SWOTCategory = "threat"
)

type SWOTItem struct {
	ID        uuid.UUID    `json:"id"         db:"id"`
	PlanID    uuid.UUID    `json:"plan_id"    db:"plan_id"`
	OrgID     uuid.UUID    `json:"org_id"     db:"org_id"`
	Category  SWOTCategory `json:"category"   db:"category"`
	Text      string       `json:"text"       db:"text"`
	UserOrder int          `json:"user_order" db:"user_order"`
	CreatedAt time.Time    `json:"created_at" db:"created_at"`
	UpdatedAt time.Time    `json:"updated_at" db:"updated_at"`
}

type PESTELFactor string

const (
	PESTELPolitical     PESTELFactor = "political"
	PESTELEconomic      PESTELFactor = "economic"
	PESTELSocial        PESTELFactor = "social"
	PESTELTechnological PESTELFactor = "technological"
	PESTELEnvironmental PESTELFactor = "environmental"
	PESTELLegal         PESTELFactor = "legal"
)

// PESTELItem merges the ESWAMCU doc's two PESTEL tables (factor+implication,
// and factor+positive/negative) into one row per factor entry.
type PESTELItem struct {
	ID          uuid.UUID    `json:"id"                    db:"id"`
	PlanID      uuid.UUID    `json:"plan_id"               db:"plan_id"`
	OrgID       uuid.UUID    `json:"org_id"                db:"org_id"`
	Factor      PESTELFactor `json:"factor"                db:"factor"`
	Implication *string      `json:"implication,omitempty" db:"implication"`
	Positive    *string      `json:"positive,omitempty"    db:"positive"`
	Negative    *string      `json:"negative,omitempty"    db:"negative"`
	UserOrder   int          `json:"user_order"            db:"user_order"`
	CreatedAt   time.Time    `json:"created_at"            db:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"            db:"updated_at"`
}

// ── Chapter 6: Organisational Structure ─────────────────────────────────────

// OrgStructureRole is one node in a plan's org chart. ReportsToID is nil at
// the top of the chart (e.g. "General Membership" in the ESWAMCU sample).
type OrgStructureRole struct {
	ID          uuid.UUID  `json:"id"                     db:"id"`
	PlanID      uuid.UUID  `json:"plan_id"                db:"plan_id"`
	OrgID       uuid.UUID  `json:"org_id"                 db:"org_id"`
	Title       string     `json:"title"                  db:"title"`
	Description *string    `json:"description,omitempty"  db:"description"`
	ReportsToID *uuid.UUID `json:"reports_to_id,omitempty" db:"reports_to_id"`
	UserOrder   int        `json:"user_order"             db:"user_order"`
	CreatedAt   time.Time  `json:"created_at"             db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"             db:"updated_at"`
}

// ── Chapter 7: Monitoring & Evaluation ──────────────────────────────────────

type MECategory string

const (
	MEObjective             MECategory = "objective"
	MECriticalSuccessFactor MECategory = "critical_success_factor"
	MEReviewNote            MECategory = "review_note"
	MEConclusionMeasure     MECategory = "conclusion_measure"
)

type MEItem struct {
	ID        uuid.UUID  `json:"id"         db:"id"`
	PlanID    uuid.UUID  `json:"plan_id"    db:"plan_id"`
	OrgID     uuid.UUID  `json:"org_id"     db:"org_id"`
	Category  MECategory `json:"category"   db:"category"`
	Text      string     `json:"text"       db:"text"`
	UserOrder int        `json:"user_order" db:"user_order"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
}
