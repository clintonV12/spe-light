// completeness.go — plan completeness score (REQ-F-044).
//
// The SRS defines a "Should" requirement: a plan completeness score derived
// from phase coverage and link density. This is surfaced as two additional
// fields on the GetProgress response:
//
//	completeness_score   float64   0–100; overall plan completeness
//	completeness_detail  object    breakdown showing what drove the score
//
// Scoring model (transparent, deterministic, no ML):
//
//	Phase coverage (60% of total score):
//	  Each of the 3 phases contributes 20 points if it has ≥ 1 activity.
//
//	Activity completion (30% of total score):
//	  (complete activities / total activities) × 30, rounded to 1dp.
//	  Zero activities → 0 (no division by zero).
//
//	Link density (10% of total score):
//	  A plan is "well-linked" if at least (total_activities / 2) link pairs
//	  exist (i.e. roughly half the activities are connected to something).
//	  Capped at 10 points. Zero activities → 0.
//
// The weights are intentionally simple and easy to explain to a non-technical
// stakeholder. They can be tuned without changing the API shape.
//
// This function is called from plansvc.GetProgress (in service.go) and its
// result is appended to the ProgressResponse struct.
package plansvc

import (
	"context"
	"math"

	"github.com/google/uuid"
)

// CompletenessDetail breaks down the completeness score into its components.
type CompletenessDetail struct {
	PhaseCoverage   float64 `json:"phase_coverage"`   // 0–60: points from having activities in all 3 phases
	ActivityCompl   float64 `json:"activity_compl"`   // 0–30: points from % of activities marked complete
	LinkDensity     float64 `json:"link_density"`     // 0–10: points from link-graph density
	PhasesWithWork  int     `json:"phases_with_work"` // 0–3: how many phases have ≥1 activity
	TotalActivities int     `json:"total_activities"`
	CompleteCount   int     `json:"complete_count"`
	LinkCount       int     `json:"link_count"`
}

// ComputeCompleteness calculates the completeness score for a plan.
// Returns the 0–100 score and the detail breakdown.
func (s *Service) ComputeCompleteness(ctx context.Context, planID, orgID uuid.UUID) (float64, CompletenessDetail, error) {
	var detail CompletenessDetail

	// Phase coverage: how many of P1/P2/P3 have at least one non-deleted activity?
	rows, err := s.db.Query(ctx,
		`SELECT DISTINCT phase FROM activities
		 WHERE plan_id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		planID, orgID,
	)
	if err != nil {
		return 0, detail, err
	}
	for rows.Next() {
		var phase string
		if err := rows.Scan(&phase); err != nil {
			rows.Close()
			return 0, detail, err
		}
		detail.PhasesWithWork++
	}
	rows.Close()

	// Total activities and complete count.
	err = s.db.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'complete')
		 FROM activities
		 WHERE plan_id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		planID, orgID,
	).Scan(&detail.TotalActivities, &detail.CompleteCount)
	if err != nil {
		return 0, detail, err
	}

	// Link count (each row in activity_links = one directed link).
	err = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM activity_links WHERE plan_id = $1`,
		planID,
	).Scan(&detail.LinkCount)
	if err != nil {
		return 0, detail, err
	}

	// Phase coverage score (max 60).
	detail.PhaseCoverage = round1dp(float64(detail.PhasesWithWork) * 20)

	// Activity completion score (max 30).
	if detail.TotalActivities > 0 {
		detail.ActivityCompl = round1dp(
			float64(detail.CompleteCount) / float64(detail.TotalActivities) * 30,
		)
	}

	// Link density score (max 10).
	// Target: at least (total / 2) links. Each link beyond that threshold adds
	// proportional credit up to the cap.
	if detail.TotalActivities > 0 {
		target := float64(detail.TotalActivities) / 2
		raw := float64(detail.LinkCount) / target * 10
		detail.LinkDensity = round1dp(math.Min(raw, 10))
	}

	score := round1dp(detail.PhaseCoverage + detail.ActivityCompl + detail.LinkDensity)
	return score, detail, nil
}

func round1dp(f float64) float64 {
	return math.Round(f*10) / 10
}
