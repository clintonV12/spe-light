// links.go — AI-generated candidate link suggestions.
//
// Distinct from plansvc.AutoDetectLinks (internal/services/plan/links.go) —
// that's a fixed, deterministic rule table (SWOT → Risk Register, etc.) with
// no model involved. This asks the actual LLM to look at what's really in
// the plan (via the same loadPlanContext machinery Draft() uses — see
// context.go) and propose links freeform, including relationships the fixed
// rule table doesn't know about.
//
// Like AutoDetectLinks, this is read-only: nothing is written to
// activity_links here. The frontend (TransPhaseNetwork.tsx) shows each
// suggestion for the user to individually accept (POST
// /api/v1/activities/{id}/links with link_type="ai_suggested" — the
// existing endpoint, unchanged) or reject (discarded client-side; nothing
// to undo since nothing was ever saved).
//
// Route wired in router.go (planner/org_admin, same gate as /ai/draft):
//
//	POST /api/v1/ai/suggest-links
package aisvc

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// Field names must match the frontend's AiSuggestLinksRequest/
// AiSuggestLinksResponse in types/index.ts exactly — response.go's
// DecodeJSON calls dec.DisallowUnknownFields().

type SuggestLinksRequest struct {
	PlanID uuid.UUID `json:"plan_id"`
}

// LinkSuggestion is a candidate link the model proposed. It carries titles/
// types alongside the ids purely so the frontend can render the review list
// without an extra round-trip to look activities up by id.
type LinkSuggestion struct {
	SourceID    uuid.UUID `json:"source_id"`
	TargetID    uuid.UUID `json:"target_id"`
	SourceTitle string    `json:"source_title"`
	TargetTitle string    `json:"target_title"`
	SourceType  string    `json:"source_type"`
	TargetType  string    `json:"target_type"`
	Reason      string    `json:"reason"`
}

type SuggestLinksResponse struct {
	Suggestions []LinkSuggestion `json:"suggestions"`
	Model       string           `json:"model"`
}

// maxLinkSuggestions bounds both what we ask the model for and how many
// suggestions we'll ever return, regardless of how many it tries to give us.
const maxLinkSuggestions = 8

// SuggestLinks asks the model to propose new activity links for a plan,
// grounded in the same plan-wide context Draft() uses: each activity's
// phase/type/status and a synopsis of what it has actually produced (see
// context.go), plus the links that already exist so the model doesn't
// re-suggest them.
func (s *Service) SuggestLinks(ctx context.Context, orgID uuid.UUID, req SuggestLinksRequest) (*SuggestLinksResponse, error) {
	var planTitle string
	var planDesc *string
	if err := s.db.QueryRow(ctx,
		`SELECT title, description FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		req.PlanID, orgID,
	).Scan(&planTitle, &planDesc); err != nil {
		return nil, fmt.Errorf("plan not found")
	}

	activities, links, err := s.loadPlanContext(ctx, orgID, req.PlanID)
	if err != nil {
		return nil, fmt.Errorf("load plan context: %w", err)
	}
	if len(activities) < 2 {
		// Nothing to link yet — return an empty list rather than bothering
		// the model with a near-empty prompt.
		return &SuggestLinksResponse{Suggestions: []LinkSuggestion{}, Model: s.model}, nil
	}

	// Existing links are excluded from the model's candidate pool by tag
	// below, in *either* direction — an AI "suggestion" that's just an
	// existing link reversed is no more useful than repeating it verbatim.
	existing := make(map[[2]uuid.UUID]bool, len(links)*2)
	for _, l := range links {
		existing[[2]uuid.UUID{l.sourceID, l.targetID}] = true
		existing[[2]uuid.UUID{l.targetID, l.sourceID}] = true
	}

	// Assign each activity a short reference tag (A1, A2, ...) instead of
	// asking the model to echo back full UUIDs — LLMs reliably mangle long
	// hex strings, which would otherwise silently drop or corrupt
	// suggestions. tagOf/idOf map between the two.
	tagOf := make(map[uuid.UUID]string, len(activities))
	idOf := make(map[string]activitySynopsis, len(activities))
	for i, a := range activities {
		tag := fmt.Sprintf("A%d", i+1)
		tagOf[a.id] = tag
		idOf[tag] = a
	}

	var sb strings.Builder
	sb.WriteString("You are a strategic planning assistant. Look at the activities already in this plan below " +
		"and propose new directed links between them. A link means the source activity's output should feed " +
		"into, inform, or be considered by the target activity — for example a SWOT analysis's threats feeding " +
		"a Risk Register, or Strategic Objectives feeding a KPI Framework.\n\n")
	fmt.Fprintf(&sb, "Plan title: %s\n", planTitle)
	if planDesc != nil && *planDesc != "" {
		fmt.Fprintf(&sb, "Plan description: %s\n", *planDesc)
	}
	sb.WriteString("\nActivities in this plan:\n")
	for _, a := range activities {
		fmt.Fprintf(&sb, "- %s [%s][%s] %s (%s): %s\n", tagOf[a.id], a.phase, a.status, a.title, a.typ, a.synopsis)
	}

	if len(links) > 0 {
		sb.WriteString("\nLinks that already exist (do NOT suggest these again, in either direction):\n")
		for _, l := range links {
			srcTag, srcOK := tagOf[l.sourceID]
			tgtTag, tgtOK := tagOf[l.targetID]
			if srcOK && tgtOK {
				fmt.Fprintf(&sb, "- %s -> %s\n", srcTag, tgtTag)
			}
		}
	}

	fmt.Fprintf(&sb, "\nPropose at most %d new links using only the tags listed above (e.g. \"A3\"). Only "+
		"suggest a link where there's a genuine, specific reason one activity's content should inform the "+
		"other — skip anything you're not confident about rather than padding out the count. It's fine to "+
		"return fewer than %d, or none at all, if that's all that's genuinely justified. Never suggest a link "+
		"from an activity to itself, and never suggest a link matching one already listed as existing (in "+
		"either direction).\n\n", maxLinkSuggestions, maxLinkSuggestions)
	sb.WriteString(`Respond with ONLY a single JSON object — no markdown fences, no commentary — matching ` +
		`exactly this shape: {"links": [{"source": "A1", "target": "A2", "reason": "..."}]}`)

	obj, _, err := s.generateJSON(ctx, sb.String())
	if err != nil {
		return nil, err
	}
	if obj == nil {
		// Model didn't return parseable JSON on either attempt. From the
		// caller's point of view this is indistinguishable from "found
		// nothing worth suggesting" — degrade to an empty list rather than
		// failing the request outright.
		return &SuggestLinksResponse{Suggestions: []LinkSuggestion{}, Model: s.model}, nil
	}

	rawLinks, _ := obj["links"].([]any)
	seen := make(map[[2]uuid.UUID]bool, len(rawLinks))
	suggestions := make([]LinkSuggestion, 0, len(rawLinks))

	for _, rl := range rawLinks {
		if len(suggestions) >= maxLinkSuggestions {
			break
		}
		row, ok := rl.(map[string]any)
		if !ok {
			continue
		}
		src, srcOK := idOf[tagString(row["source"])]
		tgt, tgtOK := idOf[tagString(row["target"])]
		if !srcOK || !tgtOK || src.id == tgt.id {
			continue // hallucinated/unknown tag, or a self-link
		}
		pair := [2]uuid.UUID{src.id, tgt.id}
		if existing[pair] || existing[[2]uuid.UUID{tgt.id, src.id}] || seen[pair] {
			continue // duplicates an existing link, or one already in this response
		}
		seen[pair] = true

		reason := strings.TrimSpace(stringField(row["reason"]))
		if reason == "" {
			reason = fmt.Sprintf("%s may inform %s.", src.title, tgt.title)
		}

		suggestions = append(suggestions, LinkSuggestion{
			SourceID:    src.id,
			TargetID:    tgt.id,
			SourceTitle: src.title,
			TargetTitle: tgt.title,
			SourceType:  src.typ,
			TargetType:  tgt.typ,
			Reason:      reason,
		})
	}

	return &SuggestLinksResponse{Suggestions: suggestions, Model: s.model}, nil
}

// tagString extracts a reference tag ("A3") from a JSON value that should be
// a string but — since LLM output can't be trusted to match the requested
// schema exactly — might arrive as something else (a bare number, if the
// model drops the quotes around it).
func tagString(v any) string {
	switch val := v.(type) {
	case string:
		return strings.TrimSpace(val)
	case float64:
		return "A" + strconv.Itoa(int(val))
	default:
		return ""
	}
}

// stringField reads a JSON value expected to be a string, tolerating
// anything else by returning "" rather than panicking on a failed type
// assertion.
func stringField(v any) string {
	s, _ := v.(string)
	return s
}
