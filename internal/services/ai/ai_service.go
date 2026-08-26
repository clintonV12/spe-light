// Package aisvc implements the AI draft/summary capability (Sprint C gap)
// on top of a locally-running Ollama instance — no external API keys, no
// data leaving the deployment.
//
// Wiring (see router.go):
//
//	aiService := aisvc.New(db, cfg)
//	aiH := handlers.NewAI(aiService)
//	r.Post("/draft", aiH.Draft)
//	r.Post("/summary", aiH.Summary)
//
// Configuration comes from config.Config (see config.go), which already
// defines:
//
//	OLLAMA_URL    → cfg.OllamaURL   (default "http://localhost:11434")
//	OLLAMA_MODEL  → cfg.OllamaModel (default "llama3")
//
// Prerequisites on the host/container running this service:
//
//  1. Install Ollama:  https://ollama.com/download
//  2. Pull a model:    ollama pull llama3   (or whatever OLLAMA_MODEL names)
//  3. Ollama must be reachable at OLLAMA_URL — it listens on
//     localhost:11434 by default once `ollama serve` / the Ollama app
//     is running.
package aisvc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"spe-light/internal/config"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// requestTimeout bounds how long we'll wait on a single Ollama generation
// call. Local models on modest hardware can be slow, so this is generous
// compared to a typical HTTP handler timeout.
const requestTimeout = 90 * time.Second

// Service generates AI drafts and summaries via Ollama.
type Service struct {
	db         *pgxpool.Pool
	httpClient *http.Client
	baseURL    string
	model      string
}

// New creates an ai Service, reading the Ollama connection details straight
// off cfg (populated from OLLAMA_URL / OLLAMA_MODEL in config.go — no
// separate env var handling needed here).
func New(db *pgxpool.Pool, cfg *config.Config) *Service {
	return &Service{
		db:         db,
		httpClient: &http.Client{Timeout: requestTimeout},
		baseURL:    strings.TrimRight(cfg.OllamaURL, "/"),
		model:      cfg.OllamaModel,
	}
}

// ── Requests / responses ─────────────────────────────────────────────────
// Field names must match the frontend's AiDraftRequest/AiDraftResponse and
// AiSummaryRequest/AiSummaryResponse in types/index.ts exactly — response.go's
// DecodeJSON calls dec.DisallowUnknownFields(), so any drift here 400s.

type DraftRequest struct {
	PlanID       uuid.UUID `json:"plan_id"`
	ActivityID   uuid.UUID `json:"activity_id"`
	ActivityType string    `json:"activity_type"`
	Phase        string    `json:"phase"`
	Keywords     []string  `json:"keywords,omitempty"`
	// PillarID grounds a "local_pillar_objectives" draft in one specific
	// Strategic Pillar (see LocalPlanBoard.tsx's PillarSection, which is
	// the only caller that sets this) — required for that activity_type,
	// ignored for every other one. Zero value (uuid.Nil) means omitted,
	// same convention as ActivityID above.
	PillarID uuid.UUID `json:"pillar_id"`
	// ObjectiveID grounds a "local_objective_activities" draft in one
	// specific Strategic Objective (see LocalPlanBoard.tsx's ObjectiveRow,
	// the only caller that sets this) — required for that activity_type,
	// ignored for every other one. Same zero-value convention as PillarID.
	ObjectiveID uuid.UUID `json:"objective_id"`
}

type DraftResponse struct {
	Draft map[string]any `json:"draft"`
	Model string         `json:"model"`
	// Warning is set when the draft was generated despite a data-quality
	// concern the model itself can't fix — currently only used for
	// kpi_framework/okr_balanced_scorecard when the plan has no Strategic
	// Objectives (formal or fallback) for the drafted KPIs to track. The
	// draft still comes back usable (never blocked outright — see Draft),
	// but the frontend should surface this prominently before the user
	// accepts it, since an unlinked KPI isn't tracking anything's progress.
	Warning string `json:"warning,omitempty"`
}

type SummaryRequest struct {
	PlanID uuid.UUID `json:"plan_id"`
	Phase  string    `json:"phase,omitempty"`
}

type SummaryResponse struct {
	Summary string `json:"summary"`
	Model   string `json:"model"`
}

// ── Draft ─────────────────────────────────────────────────────────────────

// Draft generates an AI first-draft for a single activity, shaped to match
// whichever editor the frontend will render for that activity type
// (SwotEditor / KpiEditor / RiskRegisterEditor / GenericEditor).
func (s *Service) Draft(ctx context.Context, orgID uuid.UUID, req DraftRequest) (*DraftResponse, error) {
	// Verify the plan belongs to this org and pull a bit of context (title +
	// description) so the model has something to ground the draft in.
	var planTitle string
	var planDesc *string
	if err := s.db.QueryRow(ctx,
		`SELECT title, description FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		req.PlanID, orgID,
	).Scan(&planTitle, &planDesc); err != nil {
		return nil, fmt.Errorf("plan not found")
	}

	// Best-effort: pull the activity's own title too (falls back silently —
	// a missing/renamed activity shouldn't block drafting).
	var activityTitle string
	_ = s.db.QueryRow(ctx,
		`SELECT title FROM activities WHERE id = $1 AND plan_id = $2 AND org_id = $3 AND deleted_at IS NULL`,
		req.ActivityID, req.PlanID, orgID,
	).Scan(&activityTitle)

	// Unlike activityTitle above, this is NOT best-effort: a
	// local_pillar_objectives draft with no real pillar to ground it in
	// isn't "drafting without extra context", it's drafting objectives for
	// nothing in particular — the whole point of splitting pillar and
	// objective generation into two prompts (see local_pillars/
	// local_pillar_objectives below) is that objectives are grounded in
	// one specific, already-saved pillar. So this hard-fails instead of
	// silently falling through to an ungrounded draft.
	var pillarTitle string
	if req.ActivityType == "local_pillar_objectives" {
		if req.PillarID == uuid.Nil {
			return nil, fmt.Errorf("pillar_id is required for local_pillar_objectives")
		}
		if err := s.db.QueryRow(ctx,
			`SELECT title FROM strategic_pillars WHERE id = $1 AND plan_id = $2 AND org_id = $3`,
			req.PillarID, req.PlanID, orgID,
		).Scan(&pillarTitle); err != nil {
			return nil, fmt.Errorf("pillar not found")
		}
	}

	// Same hard-fail reasoning as pillarTitle above: an activity drafted
	// with nothing to attach it to isn't a degraded draft, it's pointless
	// — "local_objective_activities" backs LocalPlanBoard.tsx's per-
	// objective "Suggest activities" trigger, which only ever appears on
	// an already-saved objective. Also pulls the objective's own pillar
	// title in the same query, reusing pillarTitle above (the two
	// activity_types are mutually exclusive per request, so there's no
	// collision) so the model sees the full pillar → objective chain it's
	// drafting activities under.
	var objectiveTitle string
	if req.ActivityType == "local_objective_activities" {
		if req.ObjectiveID == uuid.Nil {
			return nil, fmt.Errorf("objective_id is required for local_objective_activities")
		}
		if err := s.db.QueryRow(ctx,
			`SELECT o.title, p.title FROM strategic_objectives o
			 JOIN strategic_pillars p ON p.id = o.pillar_id
			 WHERE o.id = $1 AND o.plan_id = $2 AND o.org_id = $3`,
			req.ObjectiveID, req.PlanID, orgID,
		).Scan(&objectiveTitle, &pillarTitle); err != nil {
			return nil, fmt.Errorf("objective not found")
		}
	}

	// Plan-wide context: every other activity in this plan, its status, a
	// compact synopsis of what it has already produced, and the dependency
	// graph around the activity being drafted. Without this, each draft
	// request was previously answered in total isolation from the rest of
	// the plan — the model had no way to know Phase 1 was already done, or
	// that another activity already produced the keywords/data this one
	// would otherwise reinvent. See context.go. This is an enhancement, not
	// a hard requirement, so a load failure just means we draft without it
	// rather than failing the request.
	activities, links, ctxErr := s.loadPlanContext(ctx, orgID, req.PlanID)
	if ctxErr != nil {
		activities, links = nil, nil
	}

	// Org-wide context: the caller's own organisation profile (industry,
	// structure, size, location — see orgsvc.UpdateOrgProfile /
	// PATCH /api/v1/org), so the draft is grounded in what kind of
	// organisation it's actually for rather than the plan text alone. Same
	// best-effort treatment as loadPlanContext: a lookup failure just means
	// drafting without it.
	orgCtx, orgErr := s.loadOrgProfile(ctx, orgID)
	if orgErr != nil {
		orgCtx = orgProfile{}
	}

	schema, instructions := draftSchemaFor(req.ActivityType)

	// KPIs are only meaningful when they track something real — a KPI with
	// no Strategic Objective behind it isn't measuring progress toward
	// anything. For kpi_framework/okr_balanced_scorecard we load the plan's
	// real objectives (or the fallback stand-ins — see loadObjectiveOptions)
	// and require the model to tag every row with one, the same way
	// SuggestLinks (ai_links.go) requires tags instead of raw ids/titles it
	// could otherwise mangle or hallucinate. If the plan genuinely has no
	// objectives to link to, drafting still proceeds (blocking outright
	// would stop the user from ever bootstrapping a plan's first KPIs) but
	// DraftResponse.Warning is set so the frontend can surface it strongly
	// before the user accepts.
	isKPIType := req.ActivityType == "kpi_framework" || req.ActivityType == "okr_balanced_scorecard"
	var objectiveTagOf map[string]objectiveOption
	var objectiveSection string
	var warning string
	if isKPIType {
		objectives, objErr := s.loadObjectiveOptions(ctx, orgID, req.PlanID)
		if objErr != nil {
			objectives = nil
		}
		if len(objectives) == 0 {
			warning = "This plan has no Strategic Objectives yet, so the drafted KPIs below aren't linked to " +
				"anything — a KPI is only meaningful as a measure of progress toward a specific objective. " +
				"Add a Strategic Objective to the plan, then link these KPIs to it (or regenerate once one exists)."
		} else {
			objectiveTagOf = make(map[string]objectiveOption, len(objectives))
			var tb strings.Builder
			tb.WriteString("\nStrategic Objectives already defined for this plan — every KPI you draft MUST " +
				"track exactly one of these (reference it by tag, e.g. \"O1\"):\n")
			for i, o := range objectives {
				tag := fmt.Sprintf("O%d", i+1)
				objectiveTagOf[tag] = o
				fmt.Fprintf(&tb, "- %s: %s\n", tag, o.title)
			}
			objectiveSection = tb.String()

			schema = `{"rows": [{"name": "...", "unit": "...", "baseline": "...", "target": "...", ` +
				`"current": "", "objective": "O1"}]}`
			instructions += " Every row MUST include \"objective\" set to the tag (e.g. \"O1\") of whichever " +
				"Strategic Objective listed below it measures progress toward. Only use tags from that list — " +
				"never invent one. Do not draft a KPI that doesn't genuinely track one of the listed objectives; " +
				"it's better to return fewer, well-grounded rows than to pad the count with KPIs disconnected " +
				"from any real objective."
		}
	}

	var sb strings.Builder
	sb.WriteString("You are a strategic planning assistant helping draft content for one section of a company's strategic plan.\n\n")
	if orgSection := buildOrgContextSection(orgCtx); orgSection != "" {
		sb.WriteString(orgSection + "\n")
	}
	fmt.Fprintf(&sb, "Plan title: %s\n", planTitle)
	if planDesc != nil && *planDesc != "" {
		fmt.Fprintf(&sb, "Plan description: %s\n", *planDesc)
	}
	if req.Phase != "" {
		fmt.Fprintf(&sb, "Phase: %s\n", req.Phase)
	}
	fmt.Fprintf(&sb, "Activity type: %s\n", req.ActivityType)
	if activityTitle != "" {
		fmt.Fprintf(&sb, "Activity title: %s\n", activityTitle)
	}
	if pillarTitle != "" {
		fmt.Fprintf(&sb, "Strategic Pillar: %s\n", pillarTitle)
	}
	if objectiveTitle != "" {
		fmt.Fprintf(&sb, "Strategic Objective (KPA): %s\n", objectiveTitle)
	}
	if len(req.Keywords) > 0 {
		fmt.Fprintf(&sb, "Keywords/focus areas to incorporate: %s\n", strings.Join(req.Keywords, ", "))
	}

	if section := buildContextSection(activities, links, req.ActivityID, req.Phase); section != "" {
		sb.WriteString("\n" + section)
	}
	if objectiveSection != "" {
		sb.WriteString(objectiveSection)
	}

	sb.WriteString("\n" + instructions + "\n\n")
	sb.WriteString("Ground the draft in the plan context above: don't recreate outputs another activity has " +
		"already produced, stay consistent with decisions already made elsewhere in the plan, and if an " +
		"upstream activity already supplies data (e.g. keywords, metrics, findings) this activity would " +
		"otherwise have to invent, build on that explicitly instead of restating it. If the existing activities " +
		"already fully cover what this activity type would normally contribute, say so briefly within the " +
		"drafted content and focus on whatever genuinely new angle is still missing.\n\n")
	sb.WriteString("Respond with ONLY a single JSON object — no markdown fences, no commentary — matching exactly this shape:\n")
	sb.WriteString(schema)

	draft, raw, err := s.generateJSON(ctx, sb.String())
	if err != nil {
		return nil, err
	}
	if draft == nil {
		// Neither attempt in generateJSON produced parseable JSON — degrade
		// gracefully (return whatever text came back as editable content)
		// rather than failing the request outright.
		draft = map[string]any{"content": raw}
	} else {
		postProcessDraft(req.ActivityType, draft)
		if isKPIType && objectiveTagOf != nil {
			applyObjectiveTags(draft, objectiveTagOf)
		}
	}

	return &DraftResponse{Draft: draft, Model: s.model, Warning: warning}, nil
}

// applyObjectiveTags resolves each KPI row's model-supplied "objective" tag
// (e.g. "O2") back to a real objective, writing the same objective_id/
// objective_label fields KpiEditor.tsx itself uses — so an accepted draft
// looks exactly like a row the user linked by hand. The internal "objective"
// tag field is removed either way so it never leaks into saved content.
// A tag the model hallucinated or omitted (not in objectiveTagOf) is left
// unlinked rather than guessed at — KpiEditor's own unlinked-row warning
// will then catch it, same as if a person had left it blank.
func applyObjectiveTags(draft map[string]any, objectiveTagOf map[string]objectiveOption) {
	forEachRow(draft, func(row map[string]any) {
		tag, _ := row["objective"].(string)
		delete(row, "objective")
		if obj, ok := objectiveTagOf[strings.TrimSpace(tag)]; ok {
			row["objective_id"] = obj.id.String()
			row["objective_label"] = obj.title
		}
	})
}

// postProcessDraft fixes up fields the model can't be trusted to produce
// itself, so the draft drops straight into KpiEditor/RiskRegisterEditor/
// TableEditor without the user hitting broken rows:
//
//   - Every row-shaped draft (KpiRow, RiskRow, and every TABLE_CONFIGS type
//     in ActivityEditorPage.tsx — market_analysis, budget_allocation,
//     action_items, etc.) requires each row to have a stable `id`
//     (KpiEditor/RiskRegisterEditor/TableEditor all match rows by
//     `r.id === id` when editing) — an LLM asked to invent IDs tends to
//     reuse or omit them, which would make editing one row silently edit
//     every row sharing that id. We always generate real UUIDs instead of
//     asking the model for them. This is applied structurally (any draft
//     with a `rows` array) rather than enumerated per activity type, so it
//     also covers table types added after this was written.
//   - RiskRow.score is a derived value (likelihood × impact) that
//     RiskRegisterEditor only recomputes on edit, not on initial load — so a
//     freshly-accepted draft needs it pre-computed or the score badge shows
//     nothing until the user touches the row.
//   - likelihood/impact are coerced to the 1-5 int scale RiskRow requires,
//     tolerating a model that ignores the numeric-scale instruction and
//     answers "Low"/"Medium"/"High" instead.
func postProcessDraft(activityType string, draft map[string]any) {
	// Structural: applies to every rows-shaped draft, not just the types
	// enumerated below.
	forEachRow(draft, func(row map[string]any) {
		row["id"] = uuid.New().String()
	})

	switch activityType {
	case "risk_register":
		forEachRow(draft, func(row map[string]any) {
			likelihood := coerceRiskScale(row["likelihood"])
			impact := coerceRiskScale(row["impact"])
			row["likelihood"] = likelihood
			row["impact"] = impact
			row["score"] = likelihood * impact
			if _, ok := row["owner"]; !ok {
				row["owner"] = ""
			}
		})
	case "financial_projections":
		postProcessFinancialProjections(draft)
	}
}

// postProcessFinancialProjections converts the model's label-keyed draft
// (see draftSchemaFor's "financial_projections" case) into the real
// FinancialProjectionsContent shape FinancialProjectionsEditor.tsx expects:
// periods as {id, label} objects, and every line item's `values` as a
// periodId-keyed map instead of a plain positional array. Real UUIDs are
// generated here rather than asked of the model — same reasoning as the
// structural `row["id"]` pass above — and the model's positional values
// array is zipped against them index-by-index. A line item with fewer
// values than periods (model under-filled) gets "" for the missing periods
// rather than being dropped or causing a panic; extra values beyond the
// period count are ignored.
func postProcessFinancialProjections(draft map[string]any) {
	rawPeriods, _ := draft["periods"].([]any)
	periodIDs := make([]string, 0, len(rawPeriods))
	periods := make([]any, 0, len(rawPeriods))
	for _, p := range rawPeriods {
		label, _ := p.(string)
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		id := uuid.New().String()
		periodIDs = append(periodIDs, id)
		periods = append(periods, map[string]any{"id": id, "label": label})
	}
	draft["periods"] = periods

	emptySections := map[string]any{"revenue": []any{}, "cogs": []any{}, "opex": []any{}, "other_income": []any{}}
	lineItems, ok := draft["lineItems"].(map[string]any)
	if !ok {
		draft["lineItems"] = emptySections
		return
	}

	for _, section := range []string{"revenue", "cogs", "opex", "other_income"} {
		rawItems, _ := lineItems[section].([]any)
		items := make([]any, 0, len(rawItems))
		for _, raw := range rawItems {
			row, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			label, _ := row["label"].(string)
			rawValues, _ := row["values"].([]any)
			values := make(map[string]any, len(periodIDs))
			for i, pid := range periodIDs {
				if i < len(rawValues) {
					values[pid] = stringifyNumeric(rawValues[i])
				} else {
					values[pid] = ""
				}
			}
			items = append(items, map[string]any{
				"id":     uuid.New().String(),
				"label":  label,
				"values": values,
			})
		}
		lineItems[section] = items
	}
	draft["lineItems"] = lineItems
}

// stringifyNumeric renders a JSON value as a plain digit string, matching
// FPLineItem.values' Record<string,string> contract (FinancialProjections-
// Editor.tsx parses these with a bare Number(...)). Tolerates the model
// dropping the requested quotes and sending a bare JSON number instead of
// a numeric string.
func stringifyNumeric(v any) string {
	switch val := v.(type) {
	case string:
		return strings.TrimSpace(val)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	default:
		return ""
	}
}

// forEachRow applies fn to every element of draft["rows"] that decoded as a
// JSON object. Non-object entries (a model occasionally emits a stray string
// or null in the array) are skipped rather than causing a panic.
func forEachRow(draft map[string]any, fn func(row map[string]any)) {
	rows, ok := draft["rows"].([]any)
	if !ok {
		return
	}
	for _, r := range rows {
		if row, ok := r.(map[string]any); ok {
			fn(row)
		}
	}
}

// coerceRiskScale normalises a model-supplied likelihood/impact value into
// RiskRow's required 1-5 int range. Handles the value arriving as a JSON
// number (the common case), a numeric string, or a Low/Medium/High word (if
// the model ignores the "respond with a 1-5 integer" instruction).
func coerceRiskScale(v any) int {
	switch val := v.(type) {
	case float64:
		return clampScale(int(math.Round(val)))
	case string:
		switch strings.ToLower(strings.TrimSpace(val)) {
		case "low":
			return 2
		case "medium", "moderate":
			return 3
		case "high":
			return 4
		case "critical", "very high", "very_high":
			return 5
		}
		if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
			return clampScale(n)
		}
	}
	return 3 // sane middle default rather than an invalid 0
}

func clampScale(n int) int {
	if n < 1 {
		return 1
	}
	if n > 5 {
		return 5
	}
	return n
}

// ── Summary ───────────────────────────────────────────────────────────────

// Summary produces a narrative progress summary for a plan, optionally
// scoped to a single phase.
func (s *Service) Summary(ctx context.Context, orgID uuid.UUID, req SummaryRequest) (*SummaryResponse, error) {
	var planTitle string
	var planDesc *string
	var planStatus string
	if err := s.db.QueryRow(ctx,
		`SELECT title, description, status FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		req.PlanID, orgID,
	).Scan(&planTitle, &planDesc, &planStatus); err != nil {
		return nil, fmt.Errorf("plan not found")
	}

	// activities no longer carry a `phase` column as of migration
	// 014_collapse_plan_types — every activity now attaches to an objective
	// (or, for Advanced Research, sits at the plan level with no objective
	// at all; see models.Activity.ObjectiveID / Category). We still want a
	// short grouping label per activity for the summary prompt, so derive
	// one from whichever of those applies rather than querying a column
	// that no longer exists.
	query := `SELECT COALESCE(so.title, CASE WHEN a.category = 'advanced_research' THEN 'Advanced Research' ELSE '' END) AS phase,
	                 a.type, a.title, a.status
	          FROM activities a
	          LEFT JOIN strategic_objectives so ON so.id = a.objective_id
	          WHERE a.plan_id = $1 AND a.org_id = $2 AND a.deleted_at IS NULL`
	args := []any{req.PlanID, orgID}
	if req.Phase != "" {
		query += ` AND COALESCE(so.title, CASE WHEN a.category = 'advanced_research' THEN 'Advanced Research' ELSE '' END) = $3`
		args = append(args, req.Phase)
	}
	query += ` ORDER BY so.user_order NULLS LAST, a.user_order`

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load activities: %w", err)
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var phase, typ, title, status string
		if err := rows.Scan(&phase, &typ, &title, &status); err != nil {
			return nil, err
		}
		lines = append(lines, fmt.Sprintf("- [%s] %s (%s) — status: %s", phase, title, typ, status))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	orgCtx, orgErr := s.loadOrgProfile(ctx, orgID)
	if orgErr != nil {
		orgCtx = orgProfile{}
	}

	var sb strings.Builder
	sb.WriteString("You are a strategic planning assistant. Write a concise, plain-language progress summary ")
	sb.WriteString("(3-6 sentences, no bullet points, no markdown headers) for a stakeholder who has not been ")
	sb.WriteString("closely following the day-to-day work. Mention overall status, what's complete, what's still ")
	sb.WriteString("outstanding, and any notable risk if activity statuses suggest one.\n\n")
	if orgSection := buildOrgContextSection(orgCtx); orgSection != "" {
		sb.WriteString(orgSection + "\n")
	}
	fmt.Fprintf(&sb, "Plan title: %s\n", planTitle)
	if planDesc != nil && *planDesc != "" {
		fmt.Fprintf(&sb, "Plan description: %s\n", *planDesc)
	}
	fmt.Fprintf(&sb, "Plan status: %s\n", planStatus)
	if req.Phase != "" {
		fmt.Fprintf(&sb, "Scope: phase %s only\n", req.Phase)
	}
	sb.WriteString("Activities:\n")
	if len(lines) == 0 {
		sb.WriteString("(none yet)\n")
	} else {
		sb.WriteString(strings.Join(lines, "\n") + "\n")
	}

	raw, err := s.generate(ctx, sb.String(), false)
	if err != nil {
		return nil, err
	}

	return &SummaryResponse{Summary: strings.TrimSpace(raw), Model: s.model}, nil
}

// ── Ollama transport ──────────────────────────────────────────────────────

type ollamaGenerateRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
	Format string `json:"format,omitempty"` // "json" to force structured output
	// Think is honoured by reasoning models (gpt-oss, deepseek-r1, ...) and
	// harmlessly ignored by non-reasoning ones. "low" trims the chain-of-
	// thought pass so more of the token budget goes to the actual answer —
	// gpt-oss in particular can otherwise burn its budget on reasoning and
	// return an empty `response`.
	Think string `json:"think,omitempty"`
}

type ollamaGenerateResponse struct {
	Response string `json:"response"`
	// Thinking holds the model's chain-of-thought when Think is set, kept
	// separate from Response by Ollama itself for reasoning models — we
	// never parse this as data, but capturing it means it can't
	// accidentally end up concatenated into Response either.
	Thinking string `json:"thinking"`
	Done     bool   `json:"done"`
	Error    string `json:"error"`
}

// generateJSON asks Ollama for a JSON object, working around a documented
// gpt-oss quirk where forcing `format: "json"` sometimes yields a
// completely empty response (ollama/ollama#11867) instead of an error we
// could catch and retry cleanly. Strategy:
//
//  1. Ask with format:"json" (works fine for most non-gpt-oss models).
//  2. If that comes back empty or fails to parse, retry once *without* the
//     format constraint, leaning on an explicit "JSON only" instruction
//     appended to the prompt plus our own tolerant parser instead.
//
// Returns (parsedObject, lastRawText, err). err is only non-nil when Ollama
// itself was unreachable/errored on both attempts — a merely-unparseable
// response is not an error, so the caller can decide how to degrade.
func (s *Service) generateJSON(ctx context.Context, prompt string) (map[string]any, string, error) {
	raw, err := s.generate(ctx, prompt, true)
	if err == nil {
		if obj, perr := parseJSONObject(raw); perr == nil {
			return obj, raw, nil
		}
	}

	retryPrompt := prompt + "\n\nReturn ONLY the raw JSON object described above — no explanation, no markdown code fences, nothing before or after it."
	raw2, err2 := s.generate(ctx, retryPrompt, false)
	if err2 != nil {
		if err != nil {
			return nil, "", fmt.Errorf("ollama request failed twice: %w", err2)
		}
		// First attempt reached Ollama fine but wasn't parseable JSON;
		// second attempt (the actual retry) failed to even connect — surface
		// what we got from attempt one rather than erroring the whole request.
		return nil, raw, nil
	}
	if obj, perr := parseJSONObject(raw2); perr == nil {
		return obj, raw2, nil
	}
	return nil, raw2, nil
}

// generate calls Ollama's /api/generate endpoint. When asJSON is true, Ollama
// is asked to constrain output to valid JSON (supported by all current
// Ollama-served models via the `format: "json"` request field).
func (s *Service) generate(ctx context.Context, prompt string, asJSON bool) (string, error) {
	reqBody := ollamaGenerateRequest{
		Model:  s.model,
		Prompt: prompt,
		Stream: false,
		Think:  "low",
	}
	if asJSON {
		reqBody.Format = "json"
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal ollama request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build ollama request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("ollama unreachable at %s — is `ollama serve` running? (%w)", s.baseURL, err)
	}
	defer resp.Body.Close()

	var out ollamaGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode ollama response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		msg := out.Error
		if msg == "" {
			msg = fmt.Sprintf("ollama returned status %d", resp.StatusCode)
		}
		return "", fmt.Errorf("ollama error: %s", msg)
	}
	if out.Error != "" {
		return "", fmt.Errorf("ollama error: %s", out.Error)
	}
	return out.Response, nil
}

// parseJSONObject extracts a JSON object from a model response, tolerating
// the odd stray markdown fence some models still emit even when asked not
// to.
func parseJSONObject(raw string) (map[string]any, error) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)

	var out map[string]any
	if err := json.Unmarshal([]byte(trimmed), &out); err != nil {
		return nil, fmt.Errorf("model did not return valid JSON: %w", err)
	}
	return out, nil
}

// ── Per-activity-type draft schemas ──────────────────────────────────────
//
// These mirror the exact content shapes ActivityEditorPage.tsx routes to
// each editor component (SwotEditor.tsx / KpiEditor.tsx /
// RiskRegisterEditor.tsx / GenericEditor.tsx), so a returned draft can be
// dropped straight into `content` via handleAiAccept without any
// client-side reshaping. `id` fields are deliberately NOT requested from
// the model — see postProcessDraft, which generates real UUIDs itself
// rather than trusting an LLM to produce unique ones.

func draftSchemaFor(activityType string) (schema string, instructions string) {
	switch activityType {
	case "swot":
		// SwotEditor's SwotContent is four plain strings (rendered one per
		// textarea), not arrays — each string holds multiple bullet lines.
		return `{"strengths": "...", "weaknesses": "...", "opportunities": "...", "threats": "..."}`,
			"Draft a SWOT analysis. For each of the four keys, write 3-5 bullet points as a single string, " +
				"each point on its own line starting with \"- \" (e.g. \"- First point\\n- Second point\")."

	case "kpi_framework", "okr_balanced_scorecard":
		// Matches KpiEditor's KpiRow exactly (minus `id`, injected server-side).
		return `{"rows": [{"name": "...", "unit": "...", "baseline": "...", "target": "...", "current": ""}]}`,
			"Draft a KPI/OKR framework. Provide 4-6 rows. \"name\" is the metric name, \"unit\" is how it's " +
				"measured (e.g. \"%\", \"$\", \"count\"), \"baseline\" is the current/starting value, \"target\" is " +
				"the goal value. Leave \"current\" as an empty string — it hasn't been measured yet."

	case "risk_register":
		// Matches RiskRegisterEditor's RiskRow exactly (minus `id` and
		// `score`, both computed server-side in postProcessDraft).
		return `{"rows": [{"risk": "...", "likelihood": 3, "impact": 3, "mitigation": "...", "owner": ""}]}`,
			"Draft a risk register. Provide 4-6 realistic risks relevant to the plan. \"likelihood\" and " +
				"\"impact\" must each be a plain integer from 1 (lowest) to 5 (highest) — not words like " +
				"\"High\". \"mitigation\" is a concrete mitigating action. Leave \"owner\" as an empty string — " +
				"it hasn't been assigned to a person yet."

	case "business_model_canvas":
		// Matches BusinessModelCanvasEditor's BusinessModelCanvasContent
		// exactly — 9 flat string fields, same shape/order as fieldOrder's
		// entry for this type in context.go. Previously this type had no
		// case here and fell through to the generic {content, notes}
		// default, which BusinessModelCanvasEditor can't read at all (it
		// only ever looks at key_partners/key_activities/etc.) — so an
		// accepted draft silently left every block blank.
		return `{"key_partners": "...", "key_activities": "...", "key_resources": "...", ` +
				`"value_propositions": "...", "customer_relationships": "...", "channels": "...", ` +
				`"customer_segments": "...", "cost_structure": "...", "revenue_streams": "..."}`,
			"Draft a Business Model Canvas. Fill all 9 blocks, each as a few sentences of plain, specific " +
				"prose — not further nested JSON, not a bullet list. Keep each block consistent with the " +
				"others (e.g. cost_structure should reflect what key_resources/key_activities actually cost)."

	case "theory_of_change":
		// Matches TheoryOfChangeEditor's TheoryOfChangeContent exactly — 5
		// flat string fields in causal-chain order, same as fieldOrder's
		// entry for this type in context.go. Same previously-missing-case
		// bug as business_model_canvas above.
		return `{"inputs": "...", "activities": "...", "outputs": "...", "outcomes": "...", "impact": "..."}`,
			"Draft a Theory of Change. Fill all 5 stages as a few sentences of plain, specific prose each, " +
				"and keep the causal chain consistent: inputs should plausibly enable the activities, " +
				"activities should plausibly produce the outputs, outputs should plausibly lead to the " +
				"outcomes, and outcomes should plausibly drive the impact."

	// ── TableEditor-backed types ──────────────────────────────────────────
	//
	// These all match ActivityEditorPage.tsx's TABLE_CONFIGS column layout
	// exactly. TableEditor's TableRow type is `{id: string} & Record<string,
	// string>` — every field, including the numeric-looking ones like
	// market_size or amount, is stored (and rendered into a plain <input>)
	// as a string, not a JSON number. So every value below is requested as
	// a string, with instructions to keep numeric fields as bare digit
	// strings (no "$", "%", or commas) so TableEditor's own `Number(...)`
	// coercion (used for its chart views) parses them cleanly. Previously
	// these 8 types had no case here and fell through to the generic
	// {content, notes} schema — which TableEditor can't read at all, so an
	// accepted draft silently vanished (and got clobbered the moment the
	// user added or edited a row, since TableEditor's onChange always
	// rewrites the whole `content` object from its rows).

	case "market_analysis":
		return `{"rows": [{"segment": "...", "market_size": "...", "growth_rate": "...", "notes": "..."}]}`,
			"Draft a market analysis table. Provide 3-5 rows, one per market segment. \"segment\" names the " +
				"segment. \"market_size\" and \"growth_rate\" are plain numeric strings (e.g. \"120\", \"8.5\") " +
				"with no currency symbol, percent sign, or commas. \"notes\" is a short supporting observation."

	case "strategic_initiatives":
		return `{"rows": [{"initiative": "...", "priority": "...", "owner": "", "timeline": "..."}]}`,
			"Draft a strategic initiatives table. Provide 3-5 rows. \"initiative\" is a short initiative name. " +
				"\"priority\" must be exactly one of \"High\", \"Medium\", or \"Low\". Leave \"owner\" as an " +
				"empty string — it hasn't been assigned to a person yet. \"timeline\" is a short target " +
				"timeframe (e.g. \"Q2 2026\")."

	case "financial_projections":
		// FinancialProjectionsEditor.tsx's real content shape needs each
		// period to have a stable `id` and each line item's `values` keyed
		// by that id — not something the model can be trusted to invent
		// and cross-reference correctly (same reasoning as KpiRow/RiskRow's
		// `id` above: an LLM asked to invent and reuse ids across a nested
		// structure tends to drop or mismatch them). So the model is asked
		// for periods as plain labels and each line item's values as a
		// positional array aligned to those labels; postProcessDraft's
		// "financial_projections" case (via postProcessFinancialProjections)
		// converts that into the real id-keyed shape server-side.
		//
		// This also replaces a stale schema that used to return the old
		// flat {rows: [{period, revenue, costs, profit}]} table shape from
		// before this editor was rebuilt into a sectioned P&L (see
		// FinancialProjectionsEditor.tsx's own comment on that rebuild) —
		// that shape doesn't match FinancialProjectionsContent at all, so
		// an accepted draft silently produced an empty-looking projection
		// (no periods, no line items) with the model's actual output
		// effectively discarded.
		return `{"currency": "SZL", "periods": ["Year 1", "Year 2", "Year 3"], ` +
				`"lineItems": {"revenue": [{"label": "...", "values": ["...", "...", "..."]}], ` +
				`"cogs": [{"label": "...", "values": ["...", "...", "..."]}], ` +
				`"opex": [{"label": "...", "values": ["...", "...", "..."]}], "other_income": []}, ` +
				`"assumptions": "..."}`,
			"Draft a financial projection (P&L). \"periods\" is an array of 3-4 period labels (e.g. \"Year " +
				"1\", \"Year 2\", \"Year 3\"). For every line item, \"values\" must be an array with EXACTLY " +
				"the same length and order as \"periods\" — values[i] is that line item's amount for " +
				"periods[i]. Provide 2-3 revenue streams, 1-3 cost-of-sales lines, and 2-4 operating-expense " +
				"lines; leave \"other_income\" as an empty array unless the plan context clearly implies " +
				"grants or interest income. Every value is a plain numeric string with no currency symbol " +
				"or commas (e.g. \"50000\" not \"$50,000\"). \"currency\" should be a 3-letter ISO code — " +
				"default to \"SZL\" unless the plan context clearly implies otherwise. \"assumptions\" is a " +
				"short paragraph on the growth, pricing, and cost basis behind the numbers."

	case "budget_allocation":
		return `{"rows": [{"category": "...", "amount": "...", "notes": "..."}]}`,
			"Draft a budget allocation table. Provide 4-6 rows, one per budget category. \"amount\" is a plain " +
				"numeric string in dollars, no symbol or commas. \"notes\" is a short justification."

	case "resource_plan":
		return `{"rows": [{"resource": "...", "type": "...", "allocation_pct": "...", "notes": "..."}]}`,
			"Draft a resource plan table. Provide 3-5 rows. \"resource\" names the resource. \"type\" is " +
				"exactly one of \"People\", \"Budget\", or \"Equipment\". \"allocation_pct\" is a plain numeric " +
				"string from 0 to 100 with no percent sign. \"notes\" is a short clarification."

	case "action_items":
		// NOTE: activity_items' real content shape (TableEditor, {rows:
		// [{action, owner, status}]}) doesn't match the flat
		// {actions,owners,blockers} shape genericSectionKeys still lists
		// for this type — this case takes priority so that stale entry is
		// never actually reached; see the comment on genericSectionKeys.
		return `{"rows": [{"action": "...", "owner": "", "status": "Open"}]}`,
			"Draft an action items table. Provide 4-6 concrete, actionable items. Leave \"owner\" as an empty " +
				"string — it hasn't been assigned to a person yet. \"status\" must be exactly one of \"Open\", " +
				"\"In Progress\", \"Blocked\", or \"Done\" — use \"Open\" for every new item."

	case "implementation_timeline":
		return `{"rows": [{"phase": "...", "start_date": "", "end_date": "", "status": "Not started"}]}`,
			"Draft an implementation timeline table. Provide 3-5 rows, one per implementation phase. Leave " +
				"\"start_date\" and \"end_date\" as empty strings — they haven't been scheduled yet. \"status\" " +
				"must be exactly \"Not started\" for every new phase."

	case "procurement_plan":
		return `{"rows": [{"item": "...", "quantity": "...", "estimated_cost": "...", "vendor": "", "status": "Pending"}]}`,
			"Draft a procurement plan table. Provide 3-5 rows. \"quantity\" and \"estimated_cost\" are plain " +
				"numeric strings with no symbol or commas. Leave \"vendor\" as an empty string — it hasn't been " +
				"selected yet. \"status\" must be exactly \"Pending\" for every new item."

	// ── Local-plan chapter types (2/3/6/7) ─────────────────────────────────
	//
	// These back the "Draft with AI" buttons in LocalPlanChapters.tsx.
	// Unlike the types above, none of these are Activity content — each
	// local-plan chapter stores its own list of rows (CoreValue,
	// Stakeholder, PESTELItem, OrgStructureRole, MEItem — see
	// models_local_sections.go), so the frontend fans the accepted draft
	// out into individual POST .../create calls per item rather than
	// writing it into a single activity's `content`. "swot" above is
	// reused as-is for the local SWOT sub-section since its shape already
	// matches SwotEditor's four-string content — the frontend splits each
	// string's "- " bullet lines into individual SWOTItem rows on accept.

	case "local_pillars":
		// Pillars only — objectives are a deliberately separate generation
		// (see "local_pillar_objectives" below), requested only once the
		// person has reviewed/saved the pillars they want. Generating both
		// in one shot meant accepting a pillar silently bulk-created 2-4
		// objectives under it the person never got to review individually,
		// and regenerating "just the objectives" for one pillar meant
		// regenerating (and re-approving) every other pillar's objectives
		// too. This schema deliberately has no "objectives" field.
		return `{"pillars": [{"title": "..."}]}`,
			"Draft the Strategic Pillars for this plan (e.g. \"Leadership & Governance\", \"Financial " +
				"Stability\", \"Member Services\"). Provide 3-5 pillars, each a short, specific pillar name. " +
				"Do not draft Strategic Objectives (KPAs) here — those are generated separately, per pillar, " +
				"once each pillar has been saved."

	// Backs LocalPlanBoard.tsx's per-pillar "Suggest objectives" trigger,
	// which only appears on an already-saved pillar (see PillarSection) —
	// so unlike local_pillars above, this always has a real pillar to
	// ground against. PillarID is required (see the pillarTitle lookup in
	// Draft(), which hard-fails the request rather than drafting
	// ungrounded objectives if it's missing or doesn't resolve).
	case "local_pillar_objectives":
		return `{"objectives": ["...", "..."]}`,
			"Draft 2-4 Strategic Objectives (KPAs) for the Strategic Pillar named above (see \"Strategic " +
				"Pillar\" in the context). Each entry in \"objectives\" is a short, specific KPA title that " +
				"clearly belongs under that one pillar specifically — not a generic objective that could sit " +
				"under any pillar, and not an objective for a different pillar."

	// Backs LocalPlanBoard.tsx's per-objective "Suggest activities"
	// trigger (ObjectiveRow), which only appears on an already-saved
	// objective — so, like local_pillar_objectives above, this always has
	// a real objective (and its pillar) to ground against. ObjectiveID is
	// required (see the objectiveTitle/pillarTitle lookup in Draft(),
	// which hard-fails rather than drafting ungrounded activities if it's
	// missing or doesn't resolve). Every activity created from this draft
	// is an ordinary objective-nested activity (LOCAL_ACTIVITY_TYPE /
	// "strategic_action" — see CreateActivityModal.tsx), so this only
	// ever needs to produce titles, never a type.
	case "local_objective_activities":
		return `{"activities": ["...", "..."]}`,
			"Draft 2-4 concrete activities (action steps) that would deliver the Strategic Objective (KPA) " +
				"named above, under the Strategic Pillar named above. Each entry in \"activities\" is a short, " +
				"specific, actionable activity title — something a team could actually be assigned to carry " +
				"out — not a restatement of the objective itself, and not a duplicate of another entry."

	case "local_core_values":
		return `{"values": ["...", "..."]}`,
			"Suggest 3-6 organisational core values appropriate for this plan. Each entry in \"values\" must " +
				"be a short one-to-three-word name (e.g. \"Integrity\", \"Member-first service\") — not a " +
				"sentence or a definition."

	case "local_stakeholders":
		return `{"stakeholders": [{"name": "...", "influence": "high", "interest": "high"}]}`,
			"Identify 4-8 real stakeholder groups relevant to this organisation (e.g. members, regulators, " +
				"funders, staff, partner organisations, government bodies). \"influence\" and \"interest\" " +
				"must each be exactly \"high\" or \"low\" (lowercase, no other values), reflecting where that " +
				"stakeholder sits on a power/interest grid."

	case "local_pestel":
		return `{"items": [{"factor": "political", "implication": "...", "positive": "...", "negative": "..."}]}`,
			"Draft a PESTEL analysis. Return exactly six entries in \"items\", one per factor — " +
				"\"political\", \"economic\", \"social\", \"technological\", \"environmental\", and \"legal\" " +
				"(each \"factor\" value must be exactly one of those six, lowercase, one entry per factor, no " +
				"duplicates). \"implication\" is a short note on what this factor means for the organisation; " +
				"\"positive\" and \"negative\" are the upside and downside angles it creates."

	case "local_org_structure":
		return `{"roles": [{"title": "...", "reports_to": ""}]}`,
			"Draft an organisational structure of 5-8 roles appropriate for this organisation, ordered from " +
				"the top of the chart down. \"reports_to\" must be an empty string for the single top role " +
				"(e.g. \"General Membership\" or \"Board\"), and for every other role must exactly match the " +
				"\"title\" of another role that appears earlier in the list."

	case "local_me":
		return `{"items": [{"category": "objective", "text": "..."}]}`,
			"Draft a Monitoring & Evaluation section. Provide 2-4 entries for each of these four categories " +
				"in \"items\" — \"category\" must be exactly one of \"objective\", " +
				"\"critical_success_factor\", \"review_note\", or \"conclusion_measure\" (lowercase, exactly " +
				"as written). \"text\" is a single concise sentence."

	// ── Local-plan activity KPIs ────────────────────────────────────────
	//
	// Backs the "Suggest KPIs" button in LocalActivityEditor.tsx (an
	// existing activity, activity_id set — activityTitle above is
	// populated and grounds the draft) and CreateActivityModal.tsx (no
	// activity yet, activity_id omitted — drafted from keywords/plan
	// context alone). Matches the frontend's KPI shape in types/index.ts
	// exactly so LocalActivityEditor's/CreateActivityModal's
	// acceptAiKpis (via the shared parseKpiDraft in AiChapterAssist.tsx)
	// can drop each row straight into Activity.kpis with no reshaping.
	// Unlike kpi_framework/okr_balanced_scorecard above, these KPIs
	// already track the local-plan Strategic Objective the activity
	// itself belongs to (activities.objective_id) — there's no separate
	// objective-tagging step here.
	//
	// budget/responsibility/target_period (migration 013 — these used to
	// live on the activity, now on each KPI) are asked for but explicitly
	// optional: unlike target_value, which is a plan figure the model can
	// reasonably estimate from the indicator itself, a real budget number
	// or a named owner isn't something the model actually knows — telling
	// it to guess one anyway would just fabricate a number a planner
	// could mistake for a real estimate. Better to leave the field
	// editable-but-empty than to seed it with a plausible-looking fake.
	case "local_activity_kpis":
		return `{"kpis": [{"indicator": "...", "target": "...", "target_value": 0, "direction": "increase", ` +
				`"budget": 0, "responsibility": "...", "target_period": "monthly"}]}`,
			"Draft 2-4 Key Performance Indicators for this specific activity. \"indicator\" is a short name " +
				"for what's being measured (e.g. \"Membership growth rate\"). \"target\" is a short free-text " +
				"description of the goal (e.g. \"20% increase by Year 1\"). \"target_value\" is the same goal " +
				"expressed as a plain number only, with no units, currency symbol, percent sign, or commas " +
				"(e.g. 20, not \"20%\") — use your best numeric estimate of the target even if the activity " +
				"title/keywords don't state one explicitly. \"direction\" must be exactly \"increase\" if a " +
				"higher actual value is better (e.g. revenue, membership) or \"decrease\" if a lower actual " +
				"value is better (e.g. defect rate, dropout rate). \"budget\", \"responsibility\", and " +
				"\"target_period\" are optional — omit the key entirely (do not guess a number, name, or team " +
				"you have no basis for) unless the activity title, keywords, or org context actually implies " +
				"one. If you do include them: \"budget\" is a plain number with no currency symbol or commas; " +
				"\"responsibility\" is a short role or department (e.g. \"Finance Committee\"), never a " +
				"person's name; \"target_period\" must be exactly one of \"monthly\", \"quarterly\", or " +
				"\"annual\" (lowercase)."

	default:
		sections, ok := genericSectionKeys[activityType]
		if !ok {
			sections = []string{"content", "notes"}
		}
		fields := make([]string, len(sections))
		for i, key := range sections {
			fields[i] = fmt.Sprintf(`"%s": "..."`, key)
		}
		return "{" + strings.Join(fields, ", ") + "}",
			"Draft this section. Each value should be a few sentences of plain, specific prose (not further nested JSON) — write as if filling in a real planning document, not a template."
	}
}

// genericSectionKeys mirrors the `genericSections` map inside
// ActivityEditorPage.tsx (frontend/src/pages/ActivityEditorPage.tsx). Keep
// these two lists in sync — if the frontend adds/renames a section key for
// a type, GenericEditor will silently show an extra/empty field until this
// map is updated too.
//
// action_items is deliberately NOT listed here (it used to be, as
// {actions, owners, blockers}) — that never matched its real content shape
// (TableEditor's {rows: [...]}, see draftSchemaFor's explicit case for it)
// and would have gone on being dead code silently.
var genericSectionKeys = map[string][]string{
	"vision_mission":       {"vision", "mission", "values"},
	"strategic_objectives": {"objectives", "rationale"},
	"pestle":               {"political", "economic", "social", "technological", "legal", "environmental"},
	"stakeholder_map":      {"internal", "external", "strategy"},
	"competitive_analysis": {"competitors", "positioning", "differentiators"},
	"value_proposition":    {"customer", "problem", "solution", "differentiator"},
	"operational_roadmap":  {"q1", "q2", "q3", "q4"},
}
