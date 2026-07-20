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
}

type DraftResponse struct {
	Draft map[string]any `json:"draft"`
	Model string         `json:"model"`
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

	schema, instructions := draftSchemaFor(req.ActivityType)

	var sb strings.Builder
	sb.WriteString("You are a strategic planning assistant helping draft content for one section of a company's strategic plan.\n\n")
	fmt.Fprintf(&sb, "Plan title: %s\n", planTitle)
	if planDesc != nil && *planDesc != "" {
		fmt.Fprintf(&sb, "Plan description: %s\n", *planDesc)
	}
	fmt.Fprintf(&sb, "Phase: %s\n", req.Phase)
	fmt.Fprintf(&sb, "Activity type: %s\n", req.ActivityType)
	if activityTitle != "" {
		fmt.Fprintf(&sb, "Activity title: %s\n", activityTitle)
	}
	if len(req.Keywords) > 0 {
		fmt.Fprintf(&sb, "Keywords/focus areas to incorporate: %s\n", strings.Join(req.Keywords, ", "))
	}
	sb.WriteString("\n" + instructions + "\n\n")
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
	}

	return &DraftResponse{Draft: draft, Model: s.model}, nil
}

// postProcessDraft fixes up fields the model can't be trusted to produce
// itself, so the draft drops straight into KpiEditor/RiskRegisterEditor
// without the user hitting broken rows:
//
//   - KpiRow/RiskRow both require a stable `id` (KpiEditor/RiskRegisterEditor
//     match rows by `r.id === id` when editing) — an LLM asked to invent IDs
//     tends to reuse or omit them, which would make editing one row silently
//     edit every row sharing that id. We always generate real UUIDs instead
//     of asking the model for them.
//   - RiskRow.score is a derived value (likelihood × impact) that
//     RiskRegisterEditor only recomputes on edit, not on initial load — so a
//     freshly-accepted draft needs it pre-computed or the score badge shows
//     nothing until the user touches the row.
//   - likelihood/impact are coerced to the 1-5 int scale RiskRow requires,
//     tolerating a model that ignores the numeric-scale instruction and
//     answers "Low"/"Medium"/"High" instead.
func postProcessDraft(activityType string, draft map[string]any) {
	switch activityType {
	case "kpi_framework", "okr_balanced_scorecard":
		forEachRow(draft, func(row map[string]any) {
			row["id"] = uuid.New().String()
		})
	case "risk_register":
		forEachRow(draft, func(row map[string]any) {
			row["id"] = uuid.New().String()
			likelihood := coerceRiskScale(row["likelihood"])
			impact := coerceRiskScale(row["impact"])
			row["likelihood"] = likelihood
			row["impact"] = impact
			row["score"] = likelihood * impact
			if _, ok := row["owner"]; !ok {
				row["owner"] = ""
			}
		})
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

	query := `SELECT phase, type, title, status FROM activities
	          WHERE plan_id = $1 AND org_id = $2 AND deleted_at IS NULL`
	args := []any{req.PlanID, orgID}
	if req.Phase != "" {
		query += ` AND phase = $3`
		args = append(args, req.Phase)
	}
	query += ` ORDER BY phase, user_order`

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

	var sb strings.Builder
	sb.WriteString("You are a strategic planning assistant. Write a concise, plain-language progress summary ")
	sb.WriteString("(3-6 sentences, no bullet points, no markdown headers) for a stakeholder who has not been ")
	sb.WriteString("closely following the day-to-day work. Mention overall status, what's complete, what's still ")
	sb.WriteString("outstanding, and any notable risk if activity statuses suggest one.\n\n")
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
var genericSectionKeys = map[string][]string{
	"vision_mission":       {"vision", "mission", "values"},
	"strategic_objectives": {"objectives", "rationale"},
	"pestle":               {"political", "economic", "social", "technological", "legal", "environmental"},
	"stakeholder_map":      {"internal", "external", "strategy"},
	"competitive_analysis": {"competitors", "positioning", "differentiators"},
	"value_proposition":    {"customer", "problem", "solution", "differentiator"},
	"operational_roadmap":  {"q1", "q2", "q3", "q4"},
	"action_items":         {"actions", "owners", "blockers"},
}
