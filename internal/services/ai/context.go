// context.go — plan-wide context assembly for AI draft generation.
//
// Draft() (ai_service.go) previously only saw the plan's title/description
// plus the title of the single activity being drafted — every other
// activity in the plan, its status, and whatever it had already produced
// was invisible to the model. That meant two activities in the same plan
// could trivially duplicate each other's work, and a Phase 2 activity had
// no way to know Phase 1 was already done and had already produced the
// data it would otherwise reinvent.
//
// This file closes that gap. loadPlanContext pulls every other activity in
// the plan (with a *summary* of its content, not the raw JSON — see
// summarizeContent) plus the activity_links dependency graph, and
// buildContextSection turns that into a bounded block of prompt text.
//
// Design notes:
//   - Activity `content` shapes vary per type (SwotEditor, KpiEditor,
//     RiskRegisterEditor, TableEditor, and a family of dedicated editors
//     built on EditorBlock — see ActivityEditorPage.tsx's per-type
//     routing). summarizeContent extracts structurally (row-shaped vs.
//     flat/nested) so it works for every current type without a
//     hand-written extractor each, and won't break if a future editor's
//     shape doesn't match anything below. Two small data tables layer
//     type-aware polish on top of that structural fallback without
//     abandoning it: fieldOrder/genericSectionKeys give flat-shaped types
//     their real editor order (e.g. SWOT as strengths → weaknesses →
//     opportunities → threats) instead of alphabetical, and
//     headKeys/extraKeys pick the right "identifying" column for a table
//     row (e.g. RiskRow's `risk`, TableEditor's `segment`/`period`/`item`/
//     etc.) instead of an arbitrary first field. An unrecognized type
//     still gets a fully generic — just alphabetically-ordered — synopsis
//     rather than being skipped.
//   - Prompt size is bounded deliberately: local models have limited useful
//     context, so each synopsis is truncated and the activity list is
//     capped, prioritizing the activities most relevant to the one being
//     drafted (its direct dependencies, then its own phase, then the rest).
package aisvc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

const (
	maxSynopsisChars  = 320 // per-activity synopsis cap
	maxFieldChars     = 100 // per-field cap within a synopsis
	maxRowsInSynopsis = 6   // how many table rows to summarize per activity
	maxContextEntries = 25  // how many activities to list in the prompt
)

// activitySynopsis is a compact, model-friendly stand-in for one existing
// activity: its identity/status plus a short synopsis of what it has
// produced so far. It deliberately never carries the raw `content` blob.
type activitySynopsis struct {
	id       uuid.UUID
	phase    string
	typ      string
	title    string
	status   string
	synopsis string
}

// activityLink is a minimal (source, target) pair, enough to compute, for
// any given activity, which activities feed into it and which it feeds
// into.
type activityLink struct {
	sourceID uuid.UUID
	targetID uuid.UUID
}

// orgProfile is a compact stand-in for the organisation's own self-service
// profile (see orgsvc.UpdateOrgProfile / PATCH /api/v1/org), used to ground
// every AI prompt in what kind of organisation it's actually writing for —
// its industry, structure, size, and location — rather than just the plan's
// own text. Every field is optional; an org that hasn't filled its profile
// in yet simply contributes nothing here (see buildOrgContextSection).
type orgProfile struct {
	name         string
	industry     string
	address      string
	country      string
	orgStructure string
	totalMembers int // 0 = not set
}

// loadOrgProfile fetches the calling org's self-service profile fields.
// Like loadPlanContext, this is an enhancement rather than a hard
// requirement — a failed lookup degrades to no org context instead of
// failing the AI request outright, so callers should ignore the error and
// proceed with a zero-value orgProfile.
func (s *Service) loadOrgProfile(ctx context.Context, orgID uuid.UUID) (orgProfile, error) {
	var p orgProfile
	var industry, address, country, structure *string
	var totalMembers *int
	err := s.db.QueryRow(ctx,
		`SELECT name, industry, address, country, org_structure, total_members
		 FROM organisations WHERE id = $1 AND deleted_at IS NULL`,
		orgID,
	).Scan(&p.name, &industry, &address, &country, &structure, &totalMembers)
	if err != nil {
		return orgProfile{}, fmt.Errorf("load org profile: %w", err)
	}
	if industry != nil {
		p.industry = *industry
	}
	if address != nil {
		p.address = *address
	}
	if country != nil {
		p.country = *country
	}
	if structure != nil {
		p.orgStructure = *structure
	}
	if totalMembers != nil {
		p.totalMembers = *totalMembers
	}
	return p, nil
}

// buildOrgContextSection renders the "here's who this plan is for" block
// prepended to draft/summary/suggest-links prompts. Returns "" if the org
// hasn't filled in any profile info yet, so callers can skip the section
// entirely rather than adding an empty/near-empty header.
func buildOrgContextSection(p orgProfile) string {
	var parts []string
	if p.industry != "" {
		parts = append(parts, fmt.Sprintf("Industry: %s", p.industry))
	}
	if p.orgStructure != "" {
		parts = append(parts, fmt.Sprintf("Organisational structure: %s", truncate(p.orgStructure, maxFieldChars)))
	}
	if p.totalMembers > 0 {
		parts = append(parts, fmt.Sprintf("Size: approximately %d members", p.totalMembers))
	}
	location := strings.TrimSpace(strings.Join(nonEmpty(p.address, p.country), ", "))
	if location != "" {
		parts = append(parts, fmt.Sprintf("Location: %s", location))
	}
	if len(parts) == 0 {
		return ""
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "Organisation: %s\n", firstNonEmptyStr(p.name, "(unnamed)"))
	sb.WriteString(strings.Join(parts, "\n") + "\n")
	return sb.String()
}

// nonEmpty filters out empty strings, preserving order — used to join
// address/country into a single "Location:" line without stray ", " when
// one side is unset.
func nonEmpty(vals ...string) []string {
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// objectiveOption is a Strategic Objective a KPI can be linked to — either a
// real StrategicObjective row (local plans) or, when a plan has none (every
// international plan, and any local plan that hasn't defined objectives
// yet), a sibling 'strategic_objectives'-type activity standing in for one.
// This exactly mirrors the frontend's own fallback (see ActivityEditorPage's
// objectiveOptions/KpiEditor.tsx's ObjectiveOption) so the AI never proposes
// a link the user interface itself wouldn't also recognise.
type objectiveOption struct {
	id    uuid.UUID
	title string
}

// loadObjectiveOptions returns the objectives a KPI drafted for this plan
// could genuinely be linked to. Prefers the formal StrategicObjective model;
// falls back to sibling 'strategic_objectives'-type activities in the same
// plan when that's empty. Returns (nil, nil) rather than an error when the
// plan simply has neither — that's a legitimate state (a plan with no
// objectives defined yet), not a failure.
func (s *Service) loadObjectiveOptions(ctx context.Context, orgID, planID uuid.UUID) ([]objectiveOption, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, title FROM strategic_objectives WHERE plan_id = $1 AND org_id = $2 ORDER BY user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("load strategic objectives: %w", err)
	}
	var objectives []objectiveOption
	for rows.Next() {
		var o objectiveOption
		if err := rows.Scan(&o.id, &o.title); err != nil {
			rows.Close()
			return nil, err
		}
		objectives = append(objectives, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(objectives) > 0 {
		return objectives, nil
	}

	// Fallback: no formal objectives (international plan, or a local plan
	// that hasn't defined any yet) — use sibling 'strategic_objectives'-type
	// activities in the same plan instead, same as the frontend does.
	fbRows, err := s.db.Query(ctx,
		`SELECT id, title FROM activities
		 WHERE plan_id = $1 AND org_id = $2 AND type = 'strategic_objectives' AND deleted_at IS NULL
		 ORDER BY user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("load fallback objective activities: %w", err)
	}
	defer fbRows.Close()
	for fbRows.Next() {
		var o objectiveOption
		if err := fbRows.Scan(&o.id, &o.title); err != nil {
			return nil, err
		}
		objectives = append(objectives, o)
	}
	return objectives, fbRows.Err()
}

// loadPlanContext loads every non-deleted activity in the plan (each
// reduced to an activitySynopsis) plus the activity_links dependency graph.
// Returns nil slices (not an error) when the plan simply has no activities
// or links yet — an error return means the query itself failed.
func (s *Service) loadPlanContext(ctx context.Context, orgID, planID uuid.UUID) ([]activitySynopsis, []activityLink, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, phase, type, title, status, content FROM activities
		 WHERE plan_id = $1 AND org_id = $2 AND deleted_at IS NULL
		 ORDER BY phase, user_order`,
		planID, orgID,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("load plan context activities: %w", err)
	}
	defer rows.Close()

	var activities []activitySynopsis
	for rows.Next() {
		var a activitySynopsis
		var content map[string]any
		if err := rows.Scan(&a.id, &a.phase, &a.typ, &a.title, &a.status, &content); err != nil {
			return nil, nil, fmt.Errorf("scan plan context activity: %w", err)
		}
		a.synopsis = summarizeContent(a.typ, content)
		activities = append(activities, a)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	// Links are supplementary (upstream/downstream framing) rather than
	// essential — a failure here degrades to "no dependency info" instead
	// of failing the whole draft request.
	var links []activityLink
	linkRows, err := s.db.Query(ctx,
		`SELECT source_id, target_id FROM activity_links WHERE plan_id = $1`,
		planID,
	)
	if err == nil {
		defer linkRows.Close()
		for linkRows.Next() {
			var l activityLink
			if scanErr := linkRows.Scan(&l.sourceID, &l.targetID); scanErr == nil {
				links = append(links, l)
			}
		}
	}

	return activities, links, nil
}

// buildContextSection renders the "here's what already exists in this
// plan" block appended to the draft prompt. Returns "" if there's nothing
// useful to say (e.g. this is the first activity in the plan), so callers
// can skip the section entirely rather than adding empty headers.
func buildContextSection(activities []activitySynopsis, links []activityLink, targetActivityID uuid.UUID, targetPhase string) string {
	if len(activities) == 0 {
		return ""
	}

	byID := make(map[uuid.UUID]activitySynopsis, len(activities))
	for _, a := range activities {
		byID[a.id] = a
	}
	upstream, downstream := neighborTitles(links, targetActivityID, byID)

	ordered := orderByRelevance(activities, targetActivityID, targetPhase, links)
	filtered := make([]activitySynopsis, 0, len(ordered))
	for _, a := range ordered {
		if a.id == targetActivityID {
			continue // the activity being drafted isn't "existing context"
		}
		filtered = append(filtered, a)
	}

	omitted := 0
	if len(filtered) > maxContextEntries {
		omitted = len(filtered) - maxContextEntries
		filtered = filtered[:maxContextEntries]
	}

	if len(filtered) == 0 && len(upstream) == 0 && len(downstream) == 0 {
		return ""
	}

	var sb strings.Builder
	if len(filtered) > 0 {
		sb.WriteString("Existing activities already in this plan (use this to avoid duplicating work already " +
			"done, and to stay consistent with it):\n")
		for _, a := range filtered {
			fmt.Fprintf(&sb, "- [%s][%s] %s (%s): %s\n", a.phase, a.status, a.title, a.typ, a.synopsis)
		}
		if omitted > 0 {
			fmt.Fprintf(&sb, "(+%d more existing activities not shown)\n", omitted)
		}
	}
	if len(upstream) > 0 {
		fmt.Fprintf(&sb, "\nActivities that feed into this one: %s\n", strings.Join(upstream, ", "))
	}
	if len(downstream) > 0 {
		fmt.Fprintf(&sb, "Activities this one feeds into: %s\n", strings.Join(downstream, ", "))
	}

	return sb.String()
}

// neighborTitles returns the titles of activities directly linked to
// targetID — upstream (feed into it) and downstream (it feeds into).
func neighborTitles(links []activityLink, targetID uuid.UUID, byID map[uuid.UUID]activitySynopsis) (upstream, downstream []string) {
	for _, l := range links {
		if l.targetID == targetID {
			if a, ok := byID[l.sourceID]; ok {
				upstream = append(upstream, a.title)
			}
		}
		if l.sourceID == targetID {
			if a, ok := byID[l.targetID]; ok {
				downstream = append(downstream, a.title)
			}
		}
	}
	return upstream, downstream
}

// orderByRelevance sorts activities so the ones most useful for drafting
// targetID come first: direct link-neighbors, then the rest of the same
// phase, then everything else. Stable, so within each bucket the original
// phase/user_order ordering from loadPlanContext's query is preserved.
func orderByRelevance(activities []activitySynopsis, targetID uuid.UUID, targetPhase string, links []activityLink) []activitySynopsis {
	neighbors := make(map[uuid.UUID]bool)
	for _, l := range links {
		if l.targetID == targetID {
			neighbors[l.sourceID] = true
		}
		if l.sourceID == targetID {
			neighbors[l.targetID] = true
		}
	}

	rank := func(a activitySynopsis) int {
		switch {
		case neighbors[a.id]:
			return 0
		case a.phase == targetPhase:
			return 1
		default:
			return 2
		}
	}

	out := make([]activitySynopsis, len(activities))
	copy(out, activities)
	sort.SliceStable(out, func(i, j int) bool { return rank(out[i]) < rank(out[j]) })
	return out
}

// ── Generic content summarisation ──────────────────────────────────────
//
// summarizeContent extracts a short, bounded synopsis out of an activity's
// `content` blob without needing to know its exact shape. Two structural
// patterns cover everything in this codebase:
//
//   - Table-shaped: {"rows": [{...}, ...]} — kpi_framework, risk_register,
//     and every type routed through TableEditor in ActivityEditorPage.tsx
//     (market_analysis, budget_allocation, action_items, etc.)
//   - Flat/nested field shapes — swot, pestle, vision_mission, and any
//     bespoke editor shape (business_model_canvas, stakeholder_map,
//     theory_of_change, ...) this package doesn't specifically know about.
//
// Either way the extraction is generic: pull out meaningful text/values,
// truncate, bound the total count. This trades a small amount of
// per-type polish for never drifting out of sync with a custom editor's
// exact field names.
func summarizeContent(activityType string, content map[string]any) string {
	if len(content) == 0 {
		return "(no content yet)"
	}

	if rowsAny, ok := content["rows"]; ok {
		if rows, ok := rowsAny.([]any); ok {
			return joinBounded(summarizeRows(rows))
		}
	}

	var parts []string
	for _, k := range orderedKeys(activityType, content) {
		if text := summarizeValue(content[k]); text != "" {
			parts = append(parts, fmt.Sprintf("%s: %s", humanizeKey(k), text))
		}
	}
	return joinBounded(parts)
}

// fieldOrder gives the natural field order for flat-shaped content types —
// the order the corresponding editor actually presents them in (e.g. SWOT
// as strengths → weaknesses → opportunities → threats), rather than
// falling back to alphabetical. Sourced directly from each editor's
// content interface (SwotEditor.tsx, BusinessModelCanvasEditor.tsx,
// TheoryOfChangeEditor.tsx, RoadmapEditor.tsx).
//
// Types already listed in genericSectionKeys (ai_service.go — vision_mission,
// strategic_objectives, pestle, stakeholder_map, competitive_analysis,
// value_proposition, operational_roadmap) are reused from there via
// orderedKeys rather than duplicated here; this map only adds the
// dedicated-editor types genericSectionKeys doesn't cover.
var fieldOrder = map[string][]string{
	"swot": {"strengths", "weaknesses", "opportunities", "threats"},
	"business_model_canvas": {
		"value_propositions", "customer_segments", "customer_relationships", "channels",
		"key_activities", "key_resources", "key_partners", "cost_structure", "revenue_streams",
	},
	"theory_of_change": {"inputs", "activities", "outputs", "outcomes", "impact"},
	// vision_mission, strategic_objectives, pestle, stakeholder_map,
	// competitive_analysis, value_proposition, and operational_roadmap are
	// NOT repeated here — genericSectionKeys' entries for those types
	// already match their dedicated editors' real field order exactly
	// (VisionMissionEditor.tsx, ObjectivesEditor.tsx, PestleEditor.tsx,
	// StakeholderMapEditor.tsx, CompetitiveAnalysisEditor.tsx,
	// ValuePropositionEditor.tsx, RoadmapEditor.tsx), so orderedKeys falls
	// through to genericSectionKeys for those instead of duplicating them.
	//
	// action_items has no entry here or in genericSectionKeys — its real
	// content shape is TableEditor's {rows: [...]}, which the rows-shaped
	// branch in summarizeContent intercepts before orderedKeys is ever
	// consulted for it.
}

// orderedKeys returns content's keys in the editor's natural order where
// known (fieldOrder, falling back to genericSectionKeys), with any
// remaining keys — future/unknown fields, or a type with no known order at
// all — appended alphabetically so nothing is silently dropped.
func orderedKeys(activityType string, content map[string]any) []string {
	order, ok := fieldOrder[activityType]
	if !ok {
		order = genericSectionKeys[activityType]
	}

	seen := make(map[string]bool, len(order))
	keys := make([]string, 0, len(content))
	for _, k := range order {
		if _, exists := content[k]; exists {
			keys = append(keys, k)
			seen[k] = true
		}
	}

	rest := make([]string, 0, len(content))
	for k := range content {
		if k != "id" && !seen[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	return append(keys, rest...)
}

// summarizeRows reduces a `rows` array (KpiRow/RiskRow/TableRow-shaped
// entries) to at most maxRowsInSynopsis short labels, e.g. a KPI row
// becomes "Customer NPS (baseline 32, target 55)", a risk row becomes
// "Vendor lock-in (likelihood 3, impact 4)".
func summarizeRows(rows []any) []string {
	var parts []string
	for i, r := range rows {
		if i >= maxRowsInSynopsis {
			parts = append(parts, fmt.Sprintf("(+%d more rows)", len(rows)-maxRowsInSynopsis))
			break
		}
		row, ok := r.(map[string]any)
		if !ok {
			continue
		}
		if label := summarizeRow(row); label != "" {
			parts = append(parts, label)
		}
	}
	return parts
}

// headKeys are, in priority order, the "identifying" field for a table row
// across every row-shaped content type in the codebase: KpiRow.name,
// RiskRow.risk, and each TABLE_CONFIGS entry's first/label column
// (ActivityEditorPage.tsx — market_analysis.segment, strategic_initiatives
// .initiative, financial_projections.period, budget_allocation.category,
// resource_plan.resource, action_items.action, implementation_timeline
// .phase, procurement_plan.item).
var headKeys = []string{
	"name", "title", "risk", "action", "item", "segment",
	"initiative", "resource", "category", "period", "phase", "metric",
}

// extraKeys are the remaining (non-identifying) columns across those same
// row shapes, shown as parenthetical detail after the head field —
// KpiRow's baseline/target/current/unit/objective_label, RiskRow's
// likelihood/impact/score/owner/mitigation, and every other TABLE_CONFIGS
// column (market_size, growth_rate, priority, timeline, revenue, costs,
// profit, amount, resource type, allocation_pct, status, start/end date,
// quantity, estimated_cost, vendor).
//
// objective_label (KpiEditor.tsx) surfaces which Strategic Objective a KPI
// tracks — including it here means any other activity's draft/summary/
// link-suggestion prompt that sees this KPI row in context also sees what
// it's meant to track, not just its raw numbers.
var extraKeys = []string{
	"baseline", "target", "current", "unit", "objective_label",
	"likelihood", "impact", "score", "mitigation", "owner",
	"priority", "status", "timeline", "type", "allocation_pct",
	"market_size", "growth_rate", "revenue", "costs", "profit", "amount",
	"quantity", "estimated_cost", "vendor", "start_date", "end_date", "notes",
}

// summarizeRow picks an identifying field for a table row (preferring the
// common "name-like" keys used across KpiRow/RiskRow/TableRow shapes) and
// attaches the row's other meaningful fields as parenthetical detail.
func summarizeRow(row map[string]any) string {
	head := firstNonEmpty(row, headKeys)
	if head == "" {
		// Fall back to the first non-id string field, in stable key order,
		// for row shapes that don't use any of the known head keys.
		keys := make([]string, 0, len(row))
		for k := range row {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if k == "id" {
				continue
			}
			if s := summarizeValue(row[k]); s != "" {
				head = s
				break
			}
		}
	}
	if head == "" {
		return ""
	}

	var extras []string
	for _, k := range extraKeys {
		if v, ok := row[k]; ok {
			if s := summarizeValue(v); s != "" {
				extras = append(extras, fmt.Sprintf("%s %s", k, s))
			}
		}
	}
	if len(extras) > 0 {
		return fmt.Sprintf("%s (%s)", head, strings.Join(extras, ", "))
	}
	return head
}

func firstNonEmpty(row map[string]any, keys []string) string {
	for _, k := range keys {
		if v, ok := row[k]; ok {
			if s := summarizeValue(v); s != "" {
				return s
			}
		}
	}
	return ""
}

// summarizeValue renders a single content value (string/number/bool/nested
// object/array) as a short bounded string, or "" if it carries no useful
// signal (empty string, nil, empty collection).
func summarizeValue(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
		return summarizeText(val)
	case float64:
		if val == math.Trunc(val) {
			return strconv.FormatInt(int64(val), 10)
		}
		return strconv.FormatFloat(val, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(val)
	case []any:
		var items []string
		for i, item := range val {
			if i >= 5 {
				break
			}
			if s := summarizeValue(item); s != "" {
				items = append(items, s)
			}
		}
		return truncate(strings.Join(items, ", "), maxFieldChars)
	case map[string]any:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			if s := summarizeValue(val[k]); s != "" {
				parts = append(parts, fmt.Sprintf("%s: %s", humanizeKey(k), s))
			}
		}
		return truncate(strings.Join(parts, "; "), maxFieldChars)
	default:
		return ""
	}
}

// maxLinesInField bounds how many lines of a multi-line free-text field
// (SWOT quadrants, EditorBlock-based editors, roadmap quarters, the
// objectives list, ...) get pulled into a synopsis.
const maxLinesInField = 3

// summarizeText condenses a free-text field into a short synopsis. Most of
// these editors store multi-line, often bullet-prefixed text (e.g.
// SwotEditor's own "- First point\n- Second point" convention) — splitting
// on lines and dropping bullet markers keeps the synopsis reading like a
// list of points instead of an arbitrarily truncated mid-sentence fragment.
func summarizeText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	lines := strings.Split(s, "\n")
	kept := make([]string, 0, maxLinesInField)
	for _, l := range lines {
		l = strings.TrimSpace(l)
		l = strings.TrimPrefix(l, "- ")
		l = strings.TrimPrefix(l, "* ")
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		kept = append(kept, l)
		if len(kept) >= maxLinesInField {
			break
		}
	}
	if len(kept) == 0 {
		return ""
	}
	return truncate(strings.Join(kept, "; "), maxFieldChars)
}

func humanizeKey(k string) string {
	return strings.ReplaceAll(k, "_", " ")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.TrimSpace(s[:n]) + "…"
}

func joinBounded(parts []string) string {
	if len(parts) == 0 {
		return "(no content yet)"
	}
	return truncate(strings.Join(parts, " | "), maxSynopsisChars)
}
