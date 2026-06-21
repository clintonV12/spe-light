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
var autoLinkRules = []struct {
	from, to, reason string
}{
	{"swot", "risk_register", "SWOT threats feed into the Risk Register"},
	{"swot", "strategic_objectives", "SWOT outcomes inform Strategic Objectives"},
	{"swot", "okr", "SWOT analysis contextualises OKR definition"},
	{"pestle", "risk_register", "PESTLE factors are a primary risk source"},
	{"pestle", "strategic_objectives", "PESTLE environment shapes strategy"},
	{"risk_register", "roadmap", "Risk mitigations belong in the Operational Roadmap"},
	{"strategic_objectives", "okr", "Strategic Objectives are operationalised as OKRs"},
	{"strategic_objectives", "kpi", "Strategic Objectives drive KPI selection"},
	{"okr", "roadmap", "OKRs define goals the Roadmap must deliver"},
	{"okr", "action_items", "OKRs decompose into concrete Action Items"},
	{"vision", "strategic_objectives", "Vision sets the destination for Strategic Objectives"},
	{"business_model_canvas", "strategic_objectives", "Canvas gaps drive Strategic Objectives"},
	{"competitive_analysis", "strategic_objectives", "Competitive positioning informs strategy"},
	{"kpi", "roadmap", "KPIs need to be trackable via Roadmap milestones"},
	{"roadmap", "budget", "Roadmap drives Budget Allocation"},
	{"roadmap", "resource_plan", "Roadmap activities require a Resource Plan"},
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
