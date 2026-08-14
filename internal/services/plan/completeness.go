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
//	Pillar coverage (60% of total score):
//	  (pillars with ≥ 1 activity / total pillars) × 60, rounded to 1dp.
//	  Zero pillars → 0 (no division by zero). Replaces the old fixed
//	  "3 phases × 20 points" scheme (migration 014_collapse_plan_types
//	  removed the P1/P2/P3 phase concept — pillars are user-defined and
//	  variable in number, so coverage is now a ratio rather than a fixed
//	  per-phase point value).
//
//	Activity completion (30% of total score):
//	  (complete activities / total activities) × 30, rounded to 1dp.
//	  Zero activities → 0 (no division by zero). Counts every activity in
//	  the plan, pillar-attached and Advanced Research alike.
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
	PillarCoverage  float64 `json:"pillar_coverage"` // 0–60: points from the fraction of pillars with ≥1 activity
	ActivityCompl   float64 `json:"activity_compl"`  // 0–30: points from % of activities marked complete
	LinkDensity     float64 `json:"link_density"`    // 0–10: points from link-graph density
	TotalPillars    int     `json:"total_pillars"`
	PillarsWithWork int     `json:"pillars_with_work"` // how many pillars have ≥1 activity
	TotalActivities int     `json:"total_activities"`
	CompleteCount   int     `json:"complete_count"`
	LinkCount       int     `json:"link_count"`
}

// ComputeCompleteness calculates the completeness score for a plan.
// Returns the 0–100 score and the detail breakdown.
func (s *Service) ComputeCompleteness(ctx context.Context, planID, orgID uuid.UUID) (float64, CompletenessDetail, error) {
	var detail CompletenessDetail

	// Pillar coverage: how many pillars have at least one non-deleted
	// activity under one of their objectives? LEFT JOIN so pillars with
	// zero activities are still counted toward TotalPillars.
	rows, err := s.db.Query(ctx,
		`SELECT sp.id, COUNT(a.id) AS activity_count
		 FROM strategic_pillars sp
		 LEFT JOIN strategic_objectives so ON so.pillar_id = sp.id
		 LEFT JOIN activities a ON a.objective_id = so.id AND a.deleted_at IS NULL
		 WHERE sp.plan_id = $1 AND sp.org_id = $2
		 GROUP BY sp.id`,
		planID, orgID,
	)
	if err != nil {
		return 0, detail, err
	}
	for rows.Next() {
		var pillarID uuid.UUID
		var activityCount int
		if err := rows.Scan(&pillarID, &activityCount); err != nil {
			rows.Close()
			return 0, detail, err
		}
		detail.TotalPillars++
		if activityCount > 0 {
			detail.PillarsWithWork++
		}
	}
	rows.Close()

	// Total activities and complete count (pillar-attached and Advanced
	// Research alike).
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

	// Pillar coverage score (max 60).
	if detail.TotalPillars > 0 {
		detail.PillarCoverage = round1dp(
			float64(detail.PillarsWithWork) / float64(detail.TotalPillars) * 60,
		)
	}

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

	score := round1dp(detail.PillarCoverage + detail.ActivityCompl + detail.LinkDensity)
	return score, detail, nil
}

func round1dp(f float64) float64 {
	return math.Round(f*10) / 10
}
