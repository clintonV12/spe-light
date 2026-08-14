// links.go — activity link listing and auto-detection (Sprint D gap + REQ-F-040).
//
// Two things live here:
//
//  1. ListLinks — returns all links for a plan (or filtered to one activity).
//     Closes the gap noted in API_REFERENCE.md §5.2: "There is currently no
//     dedicated 'list links for an activity' endpoint."
//     Routes wired in router.go:
//     GET /api/v1/plans/{planID}/links
//     GET /api/v1/activities/{activityID}/links
//
//  2. AutoDetectLinks — rule-based candidate-link detection (REQ-F-040).
//     Deterministic, no AI. Returns suggestions only — nothing is written
//     until the user accepts via CreateActivityLink with link_type = "auto".
package plansvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
)

// ── List links ────────────────────────────────────────────────────────────

// ListLinks returns all activity links for a plan.
// If activityID is non-nil, only links where that activity is source or
// target are returned — otherwise all links for the plan are returned.
func (s *Service) ListLinks(ctx context.Context, planID, orgID uuid.UUID, activityID *uuid.UUID) ([]models.ActivityLink, error) {
	// Verify plan belongs to this org.
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		planID, orgID,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("verify plan: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("plan not found")
	}

	var query string
	var args []any

	if activityID == nil {
		query = `SELECT id, plan_id, source_id, target_id, link_type, created_by, created_at, updated_at
		         FROM activity_links WHERE plan_id = $1 ORDER BY created_at ASC`
		args = []any{planID}
	} else {
		query = `SELECT id, plan_id, source_id, target_id, link_type, created_by, created_at, updated_at
		         FROM activity_links WHERE plan_id = $1 AND (source_id = $2 OR target_id = $2)
		         ORDER BY created_at ASC`
		args = []any{planID, *activityID}
	}

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list links: %w", err)
	}
	defer rows.Close()

	var links []models.ActivityLink
	for rows.Next() {
		var l models.ActivityLink
		if err := rows.Scan(
			&l.ID, &l.PlanID, &l.SourceID, &l.TargetID,
			&l.LinkType, &l.CreatedBy, &l.CreatedAt, &l.UpdatedAt,
		); err != nil {
			return nil, err
		}
		links = append(links, l)
	}
	if links == nil {
		links = []models.ActivityLink{}
	}
	return links, rows.Err()
}

// ── Auto-detection ────────────────────────────────────────────────────────

// CandidateLink is a suggested link returned by AutoDetectLinks.
type CandidateLink struct {
	SourceID   uuid.UUID `json:"source_id"`
	TargetID   uuid.UUID `json:"target_id"`
	SourceType string    `json:"source_type"`
	TargetType string    `json:"target_type"`
	Reason     string    `json:"reason"` // human-readable explanation for the UI
}

// autoLinkRules defines which source activity types naturally lead to which
// target types. REQ-F-040: "auto-identifies candidate links based on activity
// type pairs (e.g. SWOT threats → Risk Register → P3 mitigation tasks)."
//
// Since migration 014_collapse_plan_types, every plan uses the pillar/
// objective structure, and Activity.Type is only a fixed, closed vocabulary
// for Advanced Research activities (models.ValidAdvancedResearchTypes) — an
// ordinary objective-attached activity's Type is free text a planner enters,
// so it can never usefully appear on either side of a rule here. Rules
// referencing types that used to belong to international plans (swot,
// pestle, vision_mission, strategic_objectives, kpi_framework, action_items)
// were removed: those either moved to their own dedicated chapter tables
// (SWOTItem, PESTELItem, Plan.Vision/Mission, StrategicObjective) or were
// dropped as redundant with per-activity KPIs / ordinary activities — none
// of them are Activity.Type values that can occur anymore.
var autoLinkRules = []struct {
	from, to, reason string
}{
	{"risk_register", "operational_roadmap", "Risk mitigations belong in the Operational Roadmap"},
	{"okr_balanced_scorecard", "operational_roadmap", "OKRs define goals the Roadmap must deliver"},
	{"business_model_canvas", "competitive_analysis", "Canvas gaps are worth checking against the competitive landscape"},
	{"operational_roadmap", "budget_allocation", "Roadmap drives Budget Allocation"},
	{"operational_roadmap", "resource_plan", "Roadmap activities require a Resource Plan"},
}

// AutoDetectLinks scans a plan's activities and returns candidate links that
// match the rule table and don't already exist in activity_links.
// Nothing is written to the database — this is read-only suggestion logic.
func (s *Service) AutoDetectLinks(ctx context.Context, planID, orgID uuid.UUID) ([]CandidateLink, error) {
	// Load all activities for the plan indexed by type.
	rows, err := s.db.Query(ctx,
		`SELECT id, type FROM activities
		 WHERE plan_id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("load activities: %w", err)
	}
	defer rows.Close()

	byType := make(map[string][]uuid.UUID)
	for rows.Next() {
		var id uuid.UUID
		var typ string
		if err := rows.Scan(&id, &typ); err != nil {
			return nil, err
		}
		byType[typ] = append(byType[typ], id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Load existing links to avoid re-suggesting them.
	existRows, err := s.db.Query(ctx,
		`SELECT source_id, target_id FROM activity_links WHERE plan_id = $1`,
		planID,
	)
	if err != nil {
		return nil, fmt.Errorf("load existing links: %w", err)
	}
	defer existRows.Close()

	type pair struct{ src, tgt uuid.UUID }
	existing := make(map[pair]bool)
	for existRows.Next() {
		var p pair
		if err := existRows.Scan(&p.src, &p.tgt); err != nil {
			return nil, err
		}
		existing[p] = true
	}

	// Apply rules and collect candidates.
	var candidates []CandidateLink
	for _, rule := range autoLinkRules {
		for _, src := range byType[rule.from] {
			for _, tgt := range byType[rule.to] {
				if src == tgt || existing[pair{src, tgt}] {
					continue
				}
				candidates = append(candidates, CandidateLink{
					SourceID:   src,
					TargetID:   tgt,
					SourceType: rule.from,
					TargetType: rule.to,
					Reason:     rule.reason,
				})
			}
		}
	}
	return candidates, nil
}
