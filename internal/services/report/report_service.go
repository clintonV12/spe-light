// Package reportsvc implements report generation for StratPlan (Sprint D).
//
// Design notes:
//
//   - Generation runs synchronously inside Generate() — there's no background
//     job queue. The "job_id" the frontend polls on is just the report's own
//     ID, and by the time the POST returns, the row is already in a terminal
//     state (complete, or an error was returned instead of a row being
//     created). Poll() still exists and returns the {status, file_url,
//     report} shape the frontend expects, so moving to real async generation
//     later (e.g. if reports start taking long enough to want a worker) is a
//     drop-in change on this package's internals only — no API shape change.
//
//   - PDF/DOCX/XLSX are all built by hand with only the standard library
//     (archive/zip, encoding/xml-safe escaping, bytes) — see render.go. No
//     third-party document library dependency is assumed or required.
//
//   - Files are written to disk under storageDir (default ./data/reports,
//     overridable via the REPORTS_STORAGE_DIR env var) and served back via
//     GET /api/v1/reports/{jobID}/download, which streams straight from
//     disk. This is a local-disk implementation; swapping storageDir writes
//     for an object-store client (S3, GCS, etc.) later only touches this
//     file.
package reportsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"spe-light/internal/models"
	milestonesvc "spe-light/internal/services/milestone"
	orgsvc "spe-light/internal/services/org"
	plansvc "spe-light/internal/services/plan"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// naText is shown wherever a field simply has no data yet (an unfilled KPI
// target, an activity with no budget set, an org role with nothing above
// it, ...). Previously this was an em-dash ("—"), which reads fine on
// screen but isn't in render.go's PDF font's printable-ASCII range — every
// blank field in a PDF report came out as a literal "?", and since blanks
// tend to cluster (a whole KPI table before anyone's filled in Actual
// values, say), reports could end up mostly "?" and read as broken rather
// than just incomplete. "N/A" is plain ASCII, so it renders identically in
// PDF, DOCX, and XLSX, and it reads unambiguously as "not available" rather
// than as a stray punctuation mark or a rendering glitch.
const naText = "N/A"

// AISummaryFn adapts to aisvc.Service.Summary without this package needing
// to import the ai service's request/response types directly — router.go
// wires the real implementation in as a closure at construction time.
type AISummaryFn func(ctx context.Context, orgID, planID uuid.UUID) (string, error)

// Service handles report generation, storage, and retrieval.
type Service struct {
	db           *pgxpool.Pool
	planSvc      *plansvc.Service
	milestoneSvc *milestonesvc.Service
	orgSvc       *orgsvc.Service
	aiSummaryFn  AISummaryFn
	storageDir   string
	// logo is the decoded SPE-Lite / DGRV Eswatini letterhead mark, loaded
	// once at startup. It is nil (never a partial asset) if REPORT_LOGO_PATH
	// isn't set / the file can't be found or decoded — reports still render
	// fine without it, just with a text wordmark instead of the mark itself.
	logo *pdfLogo
}

// New creates a report Service. aiSummaryFn may be nil — the AI summary
// section will then just note that AI summaries are unavailable rather than
// erroring the whole report out.
//
// The letterhead logo is loaded from REPORT_LOGO_PATH if set, falling back
// to ./assets/logo.jpg. Point this at a server-side copy of the frontend's
// public/logo.jpg (the Go backend can't read the frontend's static folder
// directly in a typical two-service deployment) — e.g. copy it into the
// backend's assets/ directory as part of your build/deploy step, or set
// REPORT_LOGO_PATH to wherever it ends up.
func New(db *pgxpool.Pool, planSvc *plansvc.Service, milestoneSvc *milestonesvc.Service, orgSvc *orgsvc.Service, aiSummaryFn AISummaryFn) *Service {
	dir := os.Getenv("REPORTS_STORAGE_DIR")
	if dir == "" {
		dir = "./data/reports"
	}
	logoPath := os.Getenv("REPORT_LOGO_PATH")
	if logoPath == "" {
		logoPath = "./assets/logo.jpg"
	}
	logo, _ := loadLogoAsset(logoPath) // nil on any error — see field doc above

	return &Service{
		db: db, planSvc: planSvc, milestoneSvc: milestoneSvc, orgSvc: orgSvc,
		aiSummaryFn: aiSummaryFn, storageDir: dir, logo: logo,
	}
}

// ── Request/response DTOs ────────────────────────────────────────────────

// SectionConfig mirrors the frontend's ReportSectionConfig exactly — field
// names must match its JSON keys.
//
// Since migration 014_collapse_plan_types, every plan uses the pillar/
// objective structure, so there's no more per-phase breakdown to configure
// (ObjectiveActivities replaced the old PhaseActivities+Phases pair — it
// takes no argument because it always covers every pillar/objective in the
// plan, the way the local-plan branch already did before the collapse).
// AdvancedResearch is new: a plan's standalone Advanced Research activities
// (see models.ActivityCategory) get their own optional section since they
// don't belong to any pillar/objective.
type SectionConfig struct {
	ExecutiveSummary    bool `json:"executive_summary"`
	VisionMission       bool `json:"vision_mission"`
	SituationalAnalysis bool `json:"situational_analysis"`
	ObjectiveActivities bool `json:"objective_activities"`
	AdvancedResearch    bool `json:"advanced_research"`
	Scorecard           bool `json:"scorecard"`
	OrgStructure        bool `json:"org_structure"`
	ProgressStatus      bool `json:"progress_status"`
	MonitoringEval      bool `json:"monitoring_evaluation"`
	Milestones          bool `json:"milestones"`
	AISummary           bool `json:"ai_summary"`
}

func (s SectionConfig) hasContent() bool {
	return s.ExecutiveSummary || s.VisionMission || s.SituationalAnalysis ||
		s.ObjectiveActivities || s.AdvancedResearch ||
		s.Scorecard || s.OrgStructure ||
		s.ProgressStatus || s.MonitoringEval ||
		s.Milestones || s.AISummary
}

// defaultSections maps the five fixed report types onto an equivalent
// SectionConfig, so the content-building code only has to know about
// sections, not report types.
func defaultSections(t models.ReportType) SectionConfig {
	switch t {
	case models.ReportFullPlan:
		return SectionConfig{
			ExecutiveSummary: true, VisionMission: true, SituationalAnalysis: true,
			ObjectiveActivities: true, AdvancedResearch: true,
			Scorecard: true, OrgStructure: true,
			ProgressStatus: true, MonitoringEval: true,
			Milestones: true, AISummary: true,
		}
	case models.ReportExecutiveSummary:
		return SectionConfig{ExecutiveSummary: true, VisionMission: true, Scorecard: true, ProgressStatus: true}
	case models.ReportPerPhase:
		// Report type name kept as-is (see models.ReportType / the reports
		// table's CHECK constraint, both untouched by 014) even though
		// "phase" no longer means anything — this now just means "activity
		// breakdown", same as ReportActivityDetail minus milestones.
		return SectionConfig{ObjectiveActivities: true, AdvancedResearch: true}
	case models.ReportProgressStatus:
		return SectionConfig{ProgressStatus: true, Scorecard: true, Milestones: true}
	case models.ReportActivityDetail:
		return SectionConfig{ObjectiveActivities: true, AdvancedResearch: true, Milestones: true}
	default:
		return SectionConfig{}
	}
}

// GenerateRequest is the decoded POST /api/v1/plans/{planID}/reports body.
type GenerateRequest struct {
	Type   models.ReportType   `json:"type"`
	Format models.ReportFormat `json:"format"`
	// Sections is required (and only used) when Type == "custom".
	Sections *SectionConfig `json:"sections,omitempty"`
}

// ReportJobStatus is the GET /api/v1/reports/{jobID} response shape.
type ReportJobStatus struct {
	Status  models.ReportStatus `json:"status"`
	FileURL *string             `json:"file_url,omitempty"`
	Report  *models.Report      `json:"report,omitempty"`
}

// ── Validation ────────────────────────────────────────────────────────────

func validateType(t models.ReportType) error {
	switch t {
	case models.ReportFullPlan, models.ReportExecutiveSummary, models.ReportPerPhase,
		models.ReportProgressStatus, models.ReportActivityDetail, models.ReportCustom:
		return nil
	default:
		return fmt.Errorf("invalid report type %q", t)
	}
}

func validateFormat(f models.ReportFormat) error {
	switch f {
	case models.ReportPDF, models.ReportDOCX, models.ReportXLSX:
		return nil
	default:
		return fmt.Errorf("invalid report format %q", f)
	}
}

// ── Generate ──────────────────────────────────────────────────────────────

// Generate builds the requested report and persists both the file and its
// metadata row. It returns the completed Report (never one still
// "processing" — see the package doc comment on synchronous generation).
func (s *Service) Generate(ctx context.Context, planID, orgID, userID uuid.UUID, req GenerateRequest) (*models.Report, error) {
	if err := validateType(req.Type); err != nil {
		return nil, err
	}
	if err := validateFormat(req.Format); err != nil {
		return nil, err
	}

	var sections SectionConfig
	if req.Type == models.ReportCustom {
		if req.Sections == nil || !req.Sections.hasContent() {
			return nil, fmt.Errorf("at least one section must be selected for a custom report")
		}
		sections = *req.Sections
	} else {
		sections = defaultSections(req.Type)
	}

	plan, err := s.planSvc.GetPlan(ctx, planID, orgID)
	if err != nil {
		return nil, err
	}

	content, stats, err := s.buildContent(ctx, plan, orgID, sections)
	if err != nil {
		return nil, fmt.Errorf("build report content: %w", err)
	}

	meta := s.buildMeta(ctx, plan, orgID, userID, req.Type, stats)

	var fileBytes []byte
	switch req.Format {
	case models.ReportPDF:
		fileBytes, err = renderPDF(meta, content, s.logo)
	case models.ReportDOCX:
		fileBytes, err = renderDOCX(meta, content, s.logo)
	case models.ReportXLSX:
		fileBytes, err = renderXLSX(meta, content)
	}
	if err != nil {
		return nil, fmt.Errorf("render report: %w", err)
	}

	report := &models.Report{
		ID:          uuid.New(),
		PlanID:      planID,
		OrgID:       orgID,
		Type:        req.Type,
		Format:      req.Format,
		Status:      models.ReportComplete,
		GeneratedBy: userID,
	}
	if req.Type == models.ReportCustom {
		asMap := map[string]any{}
		raw, _ := json.Marshal(sections)
		_ = json.Unmarshal(raw, &asMap)
		report.Sections = asMap
	}

	if err := os.MkdirAll(s.storageDir, 0o755); err != nil {
		return nil, fmt.Errorf("create storage dir: %w", err)
	}
	report.FilePath = filepath.Join(s.storageDir, report.ID.String()+"."+string(req.Format))
	if err := os.WriteFile(report.FilePath, fileBytes, 0o644); err != nil {
		return nil, fmt.Errorf("write report file: %w", err)
	}

	sectionsJSON, err := json.Marshal(report.Sections)
	if err != nil {
		return nil, fmt.Errorf("marshal sections: %w", err)
	}

	err = s.db.QueryRow(ctx,
		`INSERT INTO reports (id, plan_id, org_id, type, format, status, sections, file_path, generated_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING generated_at`,
		report.ID, report.PlanID, report.OrgID, report.Type, report.Format,
		report.Status, sectionsJSON, report.FilePath, report.GeneratedBy,
	).Scan(&report.GeneratedAt)
	if err != nil {
		// Best-effort cleanup of the orphaned file if the DB write fails.
		_ = os.Remove(report.FilePath)
		return nil, fmt.Errorf("save report record: %w", err)
	}

	url := fmt.Sprintf("/api/v1/reports/%s/download", report.ID)
	report.FileURL = &url
	return report, nil
}

// ── Poll ──────────────────────────────────────────────────────────────────

// Poll returns the current status of a report job. Since Generate runs
// synchronously, this will only ever observe a terminal state for any job_id
// that Generate successfully returned.
func (s *Service) Poll(ctx context.Context, jobID, orgID uuid.UUID) (*ReportJobStatus, error) {
	report, err := s.get(ctx, jobID, orgID)
	if err != nil {
		return nil, err
	}
	status := &ReportJobStatus{Status: report.Status}
	if report.Status == models.ReportComplete {
		status.FileURL = report.FileURL
		status.Report = report
	}
	return status, nil
}

// ── History ───────────────────────────────────────────────────────────────

// History returns completed reports for a plan, most recent first.
func (s *Service) History(ctx context.Context, planID, orgID uuid.UUID) ([]models.Report, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, plan_id, org_id, type, format, status, sections, file_path, generated_by, generated_at
		 FROM reports
		 WHERE plan_id = $1 AND org_id = $2 AND status = 'complete'
		 ORDER BY generated_at DESC`,
		planID, orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("list reports: %w", err)
	}
	defer rows.Close()

	var reports []models.Report
	for rows.Next() {
		var r models.Report
		if err := rows.Scan(
			&r.ID, &r.PlanID, &r.OrgID, &r.Type, &r.Format, &r.Status,
			&r.Sections, &r.FilePath, &r.GeneratedBy, &r.GeneratedAt,
		); err != nil {
			return nil, err
		}
		url := fmt.Sprintf("/api/v1/reports/%s/download", r.ID)
		r.FileURL = &url
		reports = append(reports, r)
	}
	return reports, rows.Err()
}

// ── Download ──────────────────────────────────────────────────────────────

// FileForDownload resolves a job ID to the on-disk path, a friendly download
// filename, and a content type — used by the download handler.
func (s *Service) FileForDownload(ctx context.Context, jobID, orgID uuid.UUID) (path, filename, contentType string, err error) {
	report, err := s.get(ctx, jobID, orgID)
	if err != nil {
		return "", "", "", err
	}
	if report.Status != models.ReportComplete || report.FilePath == "" {
		return "", "", "", fmt.Errorf("report is not ready")
	}
	filename = fmt.Sprintf("%s-%s.%s", report.Type, report.ID.String()[:8], report.Format)
	return report.FilePath, filename, contentTypeFor(report.Format), nil
}

func contentTypeFor(f models.ReportFormat) string {
	switch f {
	case models.ReportPDF:
		return "application/pdf"
	case models.ReportDOCX:
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case models.ReportXLSX:
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	default:
		return "application/octet-stream"
	}
}

// ── Shared lookup ─────────────────────────────────────────────────────────

func (s *Service) get(ctx context.Context, id, orgID uuid.UUID) (*models.Report, error) {
	var r models.Report
	err := s.db.QueryRow(ctx,
		`SELECT id, plan_id, org_id, type, format, status, sections, file_path, generated_by, generated_at
		 FROM reports WHERE id = $1 AND org_id = $2`,
		id, orgID,
	).Scan(&r.ID, &r.PlanID, &r.OrgID, &r.Type, &r.Format, &r.Status,
		&r.Sections, &r.FilePath, &r.GeneratedBy, &r.GeneratedAt)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("report not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get report: %w", err)
	}
	if r.Status == models.ReportComplete {
		url := fmt.Sprintf("/api/v1/reports/%s/download", r.ID)
		r.FileURL = &url
	}
	return &r, nil
}

// ── Letterhead assembly ──────────────────────────────────────────────────

// buildMeta assembles the report's letterhead — organisation details and
// who/when it was generated. Falls back to safe defaults on any lookup
// failure rather than failing generation outright, since none of this is
// essential to the report's actual data.
func (s *Service) buildMeta(ctx context.Context, plan *models.Plan, orgID, userID uuid.UUID, reportType models.ReportType, stats coverStats) reportMeta {
	meta := reportMeta{
		ReportTitle:     plan.Title,
		ReportTypeLabel: reportTypeLabel(string(reportType)),
		PlanTitle:       plan.Title,
		PlanStatus:      string(plan.Status),
		OrgName:         "Your Organisation",
		GeneratedBy:     "System",
		GeneratedAt:     time.Now(),
		Progress:        stats,
	}
	if s.orgSvc != nil {
		if org, err := s.orgSvc.GetOrgByID(ctx, orgID); err == nil {
			meta.OrgName = org.Name
			if org.Industry != nil {
				meta.OrgIndustry = *org.Industry
			}

			// Pre-join address/country and email/phone into single display
			// lines here (rather than in render.go) so the three renderers
			// don't each have to duplicate "which parts are actually set".
			var loc []string
			if org.Address != nil && *org.Address != "" {
				loc = append(loc, *org.Address)
			}
			if org.Country != nil && *org.Country != "" {
				loc = append(loc, *org.Country)
			}
			meta.OrgLocation = strings.Join(loc, ", ")

			var contact []string
			if org.ContactEmail != nil && *org.ContactEmail != "" {
				contact = append(contact, *org.ContactEmail)
			}
			if org.ContactPhone != nil && *org.ContactPhone != "" {
				contact = append(contact, *org.ContactPhone)
			}
			meta.OrgContact = strings.Join(contact, "  |  ")
		}
		if user, err := s.orgSvc.GetUserByID(ctx, userID); err == nil && user.Name != "" {
			meta.GeneratedBy = user.Name
		}
	}
	return meta
}

// ── Content assembly ──────────────────────────────────────────────────────

// reportContent is the format-agnostic intermediate representation that
// render.go's PDF/DOCX/XLSX writers consume.
type reportContent struct {
	Sections []contentSection
}

type contentSection struct {
	Heading    string
	Paragraphs []string
	Table      *contentTable
	// Chart is optional and independent of Table — a section can have
	// either, both (e.g. the KPI scorecard's detail table plus its
	// achievement-by-period chart), or neither.
	Chart *contentChart
	// Diagram is optional and independent of Table/Chart — set on the
	// sections that have a dedicated visual editor on screen (SWOT,
	// PESTEL, the Business Model Canvas) so the report shows the same
	// shape a reader who has seen the plan in the app would recognise,
	// alongside (not instead of) the plain data table. A rendering path
	// that can't draw diagrams (XLSX) simply ignores this field — the
	// Table on the same section already carries the same data.
	Diagram *contentDiagram
}

// contentDiagram is a labelled grid of colour-coded blocks laid out on a
// Cols x Rows grid — deliberately generic (rather than one struct per
// diagram kind) since a SWOT quadrant, a PESTEL grid, and the nine-block
// Business Model Canvas are all "some cells, some spanning more than one
// grid position, each with a label and body text" once you strip out the
// specific field names. Kind is informational only (renderers don't switch
// on it) — Cols/Rows/Cells fully describe the layout.
type contentDiagram struct {
	Kind  string // "swot" | "pestel" | "bmc" — for callers/tests, not read by renderers
	Cols  int
	Rows  int
	Cells []diagramCell
}

// diagramCell is one block of a contentDiagram. Col/Row are 0-indexed grid
// positions; ColSpan/RowSpan default to 1 when zero. ColorHint keys into
// render.go's diagramPalette (e.g. "green", "red", "blue", "gold",
// "purple", "neutral") and is chosen to echo the corresponding frontend
// editor's Tailwind colour for that block (SwotEditor.tsx,
// PestleEditor.tsx, BusinessModelCanvasEditor.tsx) so the exported version
// reads as "the same diagram", not a reinterpretation of it.
type diagramCell struct {
	Label     string
	Text      string
	Col, Row  int
	ColSpan   int
	RowSpan   int
	ColorHint string
}

type contentTable struct {
	Headers []string
	Rows    [][]string
}

// contentChart is a simple horizontal bar chart — deliberately minimal
// (one value per bar, 0..Max) rather than a general charting grammar, since
// every current use case (KPI achievement %, progress %) is exactly that
// shape. ColorHint on each bar drives red/yellow/green thresholding
// consistent with TrackingModule.tsx's achievementColor (bad <=50, good
// >=75, warn in between) — see kpiColorHint in report_service.go.
type contentChart struct {
	Title string
	Unit  string // appended after the value, e.g. "%"
	Max   float64
	Bars  []chartBar
}

type chartBar struct {
	Label     string
	Value     float64
	ColorHint string // "good" | "warn" | "bad" | "" (brand default)
}

// titleCase capitalises just the first letter — used for the short
// lowercase enum values (SWOT category, PESTEL factor, KPI period) that
// read better capitalised in a report than as raw JSON/DB values.
func titleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// buildVisionMissionSection covers the "Shared Destiny" chapter common to
// enterprise strategic plans — Vision, Mission, and Core Values, stored
// directly on the plan (Plan.Vision/Plan.Mission plus the core_values table
// — see models_local_sections.go). Returns nil (section omitted) if none of
// it has been filled in yet — a plan that hasn't gotten to this chapter
// shouldn't get an empty heading in its report.
func (s *Service) buildVisionMissionSection(ctx context.Context, plan *models.Plan, orgID uuid.UUID) *contentSection {
	var paras []string
	if plan.Vision != nil && *plan.Vision != "" {
		paras = append(paras, "Vision: "+*plan.Vision)
	}
	if plan.Mission != nil && *plan.Mission != "" {
		paras = append(paras, "Mission: "+*plan.Mission)
	}
	if values, err := s.planSvc.ListCoreValues(ctx, plan.ID, orgID); err == nil && len(values) > 0 {
		names := make([]string, len(values))
		for i, v := range values {
			names[i] = v.Name
		}
		paras = append(paras, "Core Values: "+strings.Join(names, ", "))
	}
	if len(paras) == 0 {
		return nil
	}
	return &contentSection{Heading: "Vision, Mission & Core Values", Paragraphs: paras}
}

// buildSituationalAnalysisSections covers Stakeholder/SWOT/PESTEL analysis,
// each backed by its own dedicated table (see models_local_sections.go),
// producing one properly-columned table per sub-section. Returns an empty
// slice (not nil-vs-empty sensitive — callers just append) if a plan hasn't
// filled any of this chapter in yet.
func (s *Service) buildSituationalAnalysisSections(ctx context.Context, plan *models.Plan, orgID uuid.UUID) []contentSection {
	var out []contentSection

	if stakeholders, err := s.planSvc.ListStakeholders(ctx, plan.ID, orgID); err == nil && len(stakeholders) > 0 {
		t := &contentTable{Headers: []string{"Stakeholder", "Influence", "Interest", "Notes"}}
		for _, st := range stakeholders {
			notes := ""
			if st.Notes != nil {
				notes = *st.Notes
			}
			t.Rows = append(t.Rows, []string{st.Name, titleCase(string(st.Influence)), titleCase(string(st.Interest)), notes})
		}
		out = append(out, contentSection{Heading: "Stakeholder Analysis", Table: t})
	}

	if swot, err := s.planSvc.ListSWOTItems(ctx, plan.ID, orgID); err == nil && len(swot) > 0 {
		t := &contentTable{Headers: []string{"Category", "Item"}}
		for _, it := range swot {
			t.Rows = append(t.Rows, []string{titleCase(string(it.Category)), it.Text})
		}
		out = append(out, contentSection{Heading: "SWOT Analysis", Table: t, Diagram: swotDiagram(swot)})
	}

	if pestel, err := s.planSvc.ListPESTELItems(ctx, plan.ID, orgID); err == nil && len(pestel) > 0 {
		t := &contentTable{Headers: []string{"Factor", "Implication", "Positive", "Negative"}}
		for _, it := range pestel {
			imp, pos, neg := "", "", ""
			if it.Implication != nil {
				imp = *it.Implication
			}
			if it.Positive != nil {
				pos = *it.Positive
			}
			if it.Negative != nil {
				neg = *it.Negative
			}
			t.Rows = append(t.Rows, []string{titleCase(string(it.Factor)), imp, pos, neg})
		}
		out = append(out, contentSection{Heading: "PESTEL Analysis", Table: t, Diagram: pestelDiagram(pestel)})
	}

	return out
}

// swotDiagram lays SWOT items out on the same 2x2 quadrant grid
// SwotEditor.tsx shows on screen — strengths/weaknesses on the top row,
// opportunities/threats on the bottom — with every item for a category
// newline-joined into that quadrant's body text. Returns nil (no diagram)
// if every category is empty, which can't currently happen given the
// len(swot) > 0 guard at the call site, but keeps this safe to call
// standalone.
func swotDiagram(items []models.SWOTItem) *contentDiagram {
	byCat := map[models.SWOTCategory][]string{}
	for _, it := range items {
		byCat[it.Category] = append(byCat[it.Category], it.Text)
	}
	cell := func(cat models.SWOTCategory, label string, col, row int, hint string) diagramCell {
		return diagramCell{Label: label, Text: strings.Join(byCat[cat], "\n"), Col: col, Row: row, ColorHint: hint}
	}
	return &contentDiagram{
		Kind: "swot", Cols: 2, Rows: 2,
		Cells: []diagramCell{
			cell(models.SWOTStrength, "Strengths", 0, 0, "green"),
			cell(models.SWOTWeakness, "Weaknesses", 1, 0, "red"),
			cell(models.SWOTOpportunity, "Opportunities", 0, 1, "blue"),
			cell(models.SWOTThreat, "Threats", 1, 1, "gold"),
		},
	}
}

// pestelDiagram lays PESTEL items out on the same 3-column, 2-row grid
// PestleEditor.tsx shows on screen (political/economic/social on the top
// row, technological/legal/environmental on the bottom), one cell per
// factor. A factor's implication/positive/negative fields are folded into
// one body text per cell, since the diagram only has room for one block of
// text per factor — the full breakdown stays in the PESTEL table this
// diagram accompanies.
func pestelDiagram(items []models.PESTELItem) *contentDiagram {
	byFactor := map[models.PESTELFactor][]string{}
	for _, it := range items {
		var parts []string
		if it.Implication != nil && *it.Implication != "" {
			parts = append(parts, *it.Implication)
		}
		if it.Positive != nil && *it.Positive != "" {
			parts = append(parts, "+ "+*it.Positive)
		}
		if it.Negative != nil && *it.Negative != "" {
			parts = append(parts, "- "+*it.Negative)
		}
		if len(parts) > 0 {
			byFactor[it.Factor] = append(byFactor[it.Factor], strings.Join(parts, "; "))
		}
	}
	cell := func(f models.PESTELFactor, label string, col, row int, hint string) diagramCell {
		return diagramCell{Label: label, Text: strings.Join(byFactor[f], "\n"), Col: col, Row: row, ColorHint: hint}
	}
	return &contentDiagram{
		Kind: "pestel", Cols: 3, Rows: 2,
		Cells: []diagramCell{
			cell(models.PESTELPolitical, "Political", 0, 0, "blue"),
			cell(models.PESTELEconomic, "Economic", 1, 0, "green"),
			cell(models.PESTELSocial, "Social", 2, 0, "purple"),
			cell(models.PESTELTechnological, "Technological", 0, 1, "cyan"),
			cell(models.PESTELLegal, "Legal", 1, 1, "gold"),
			cell(models.PESTELEnvironmental, "Environmental", 2, 1, "teal"),
		},
	}
}

// bmcDiagram lays a Business Model Canvas activity's content out on the
// same nine-block Osterwalder grid BusinessModelCanvasEditor.tsx shows on
// screen (partners/activities/resources feeding the value proposition,
// which feeds the customer-facing blocks, with cost/revenue as the
// foundation row) — same Col/Row/Span positions as that component's
// lg:col-start-N / lg:row-span-2 classes. Returns nil if none of the nine
// fields have been filled in yet.
func bmcDiagram(content map[string]any) *contentDiagram {
	get := func(k string) string {
		if v, ok := content[k].(string); ok {
			return v
		}
		return ""
	}
	fields := []string{
		"key_partners", "key_activities", "key_resources", "value_propositions",
		"customer_relationships", "channels", "customer_segments",
		"cost_structure", "revenue_streams",
	}
	hasContent := false
	for _, f := range fields {
		if get(f) != "" {
			hasContent = true
			break
		}
	}
	if !hasContent {
		return nil
	}
	mk := func(key, label string, col, row, colSpan, rowSpan int, hint string) diagramCell {
		return diagramCell{Label: label, Text: get(key), Col: col, Row: row, ColSpan: colSpan, RowSpan: rowSpan, ColorHint: hint}
	}
	return &contentDiagram{
		Kind: "bmc", Cols: 5, Rows: 3,
		Cells: []diagramCell{
			mk("key_partners", "Key Partners", 0, 0, 1, 2, "neutral"),
			mk("key_activities", "Key Activities", 1, 0, 1, 1, "blue"),
			mk("key_resources", "Key Resources", 1, 1, 1, 1, "blue"),
			mk("value_propositions", "Value Propositions", 2, 0, 1, 2, "gold"),
			mk("customer_relationships", "Customer Relationships", 3, 0, 1, 1, "green"),
			mk("channels", "Channels", 3, 1, 1, 1, "green"),
			mk("customer_segments", "Customer Segments", 4, 0, 1, 2, "purple"),
			mk("cost_structure", "Cost Structure", 0, 2, 2, 1, "red"),
			mk("revenue_streams", "Revenue Streams", 2, 2, 3, 1, "green"),
		},
	}
}

// kpiAchievement computes a KPI's achievement percentage from its Target/
// Actual pair, mirroring TrackingModule.tsx's computeAchievement exactly
// (see models.KPI's doc comment for the two formulas) so this report's
// numbers can never disagree with what the Tracking Module shows on screen.
func kpiAchievement(k models.KPI) (float64, bool) {
	if k.TargetValue == nil || k.ActualValue == nil {
		return 0, false
	}
	target, actual := *k.TargetValue, *k.ActualValue
	if k.Direction == models.KPIDirectionDecrease {
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

// kpiColorHint maps an achievement percentage onto the same red/yellow/
// green thresholds as TrackingModule.tsx's achievementColor (bad <=50%,
// good >=75%, warn in between), so a report's chart colours mean the same
// thing the in-app gauges do.
func kpiColorHint(pct float64) string {
	switch {
	case pct >= 75:
		return "good"
	case pct <= 50:
		return "bad"
	default:
		return "warn"
	}
}

// periodKPICompletion mirrors TrackingModule.tsx's periodCompletion
// exactly: average achievement (via kpiAchievement) across every KPI whose
// TargetPeriod matches, each individually capped at 100 first so one
// overachieving KPI can't drag a period's average past what a fully-met
// set of KPIs would show. Returns ok=false if no KPI for that period has
// both a target and an actual value set (nothing to average).
func periodKPICompletion(kpis []models.KPI, period models.KPIPeriod) (float64, bool) {
	var sum float64
	var n int
	for _, k := range kpis {
		if k.TargetPeriod == nil || *k.TargetPeriod != period {
			continue
		}
		pct, ok := kpiAchievement(k)
		if !ok {
			continue
		}
		if pct > 100 {
			pct = 100
		}
		sum += pct
		n++
	}
	if n == 0 {
		return 0, false
	}
	return sum / float64(n), true
}

// overallKPICompletion mirrors TrackingModule.tsx's overallKpiCompletion
// exactly — the same figure the Tracking page's "Overall" gauge shows —
// so the report's cover badge (see buildCover in render.go) can never
// disagree with what the Tracking module displays on screen for the same
// plan. It's the average of whichever of monthly/quarterly/annual actually
// have at least one scored KPI; returns ok=false (not 0) if none do, so
// callers know to fall back to activity-status progress rather than
// showing a misleading 0%.
func overallKPICompletion(kpis []models.KPI) (float64, bool) {
	var sum float64
	var n int
	for _, period := range models.ValidKPIPeriods {
		pct, ok := periodKPICompletion(kpis, period)
		if !ok {
			continue
		}
		sum += pct
		n++
	}
	if n == 0 {
		return 0, false
	}
	return sum / float64(n), true
}

// buildScorecardSections returns the KPI detail table and, if any KPI has
// a reporting period set, an achievement-by-period bar chart — the same
// capped-at-100-per-KPI averaging TrackingModule.tsx's periodCompletion
// uses, so one overachieving KPI can't skew a period's bar past what a
// fully-met set of KPIs would show.
//
// Period is read from each KPI's own TargetPeriod (migration 013 moved
// Budget/Responsibility/TargetPeriod off Activity and onto models.KPI —
// two KPIs on the same activity can report on different cadences, so the
// grouping has to happen at the KPI level, same as TrackingModule.tsx's
// periodCompletion).
//
// KPIs live on Activity.KPIs (see models.KPI) for any objective-attached
// activity — Advanced Research activities don't carry KPIs (see
// CreateActivity's validation in plan_service.go), so this section is
// scoped to ordinary pillar/objective activities in practice, though
// nothing here specifically filters Advanced Research activities out — an
// activity with no KPIs just never contributes a row.
func (s *Service) buildScorecardSections(ctx context.Context, plan *models.Plan, orgID uuid.UUID) []contentSection {
	activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, nil, nil, nil)
	if err != nil {
		return nil
	}

	t := &contentTable{Headers: []string{"Activity", "Indicator", "Target", "Actual", "Achievement", "Period"}}
	periodSums := map[models.KPIPeriod]float64{}
	periodCounts := map[models.KPIPeriod]int{}
	haveRows := false

	for _, a := range activities {
		for _, k := range a.KPIs {
			haveRows = true
			pct, ok := kpiAchievement(k)
			achievement := naText
			if ok {
				achievement = fmt.Sprintf("%.0f%%", pct)
			}
			target := naText
			if k.TargetValue != nil {
				target = fmt.Sprintf("%.2f", *k.TargetValue)
			} else if k.Target != "" {
				target = k.Target
			}
			actual := naText
			if k.ActualValue != nil {
				actual = fmt.Sprintf("%.2f", *k.ActualValue)
			}
			period := naText
			if k.TargetPeriod != nil {
				period = titleCase(string(*k.TargetPeriod))
			}
			indicator := k.Indicator
			if indicator == "" {
				indicator = naText
			}
			t.Rows = append(t.Rows, []string{a.Title, indicator, target, actual, achievement, period})

			if ok && k.TargetPeriod != nil {
				capped := pct
				if capped > 100 {
					capped = 100
				}
				periodSums[*k.TargetPeriod] += capped
				periodCounts[*k.TargetPeriod]++
			}
		}
	}

	if !haveRows {
		return nil
	}
	sections := []contentSection{{Heading: "Strategic Scorecard", Table: t}}

	var bars []chartBar
	var periodTotal float64
	var periodN float64
	for _, p := range models.ValidKPIPeriods {
		n := periodCounts[p]
		if n == 0 {
			continue
		}
		avg := periodSums[p] / float64(n)
		bars = append(bars, chartBar{Label: titleCase(string(p)), Value: avg, ColorHint: kpiColorHint(avg)})
		periodTotal += avg
		periodN++
	}
	if periodN > 0 {
		overall := periodTotal / periodN
		bars = append(bars, chartBar{Label: "Overall", Value: overall, ColorHint: kpiColorHint(overall)})
	}
	if len(bars) > 0 {
		sections = append(sections, contentSection{
			Heading: "KPI Achievement",
			Chart:   &contentChart{Title: "Achievement by reporting period", Unit: "%", Max: 100, Bars: bars},
		})
	}
	return sections
}

// buildOrgStructureSection renders a plan's org chart (see
// org_structure_roles in models_local_sections.go) as a flat Role/Reports-To
// table — enough to reconstruct the hierarchy without needing actual box-
// and-line diagram rendering, which the hand-rolled renderers here aren't
// set up for. Returns nil (not an empty section) if the plan hasn't filled
// this chapter in yet.
func (s *Service) buildOrgStructureSection(ctx context.Context, plan *models.Plan, orgID uuid.UUID) *contentSection {
	roles, err := s.planSvc.ListOrgStructureRoles(ctx, plan.ID, orgID)
	if err != nil || len(roles) == 0 {
		return nil
	}
	titleByID := make(map[uuid.UUID]string, len(roles))
	for _, r := range roles {
		titleByID[r.ID] = r.Title
	}
	t := &contentTable{Headers: []string{"Role", "Reports To"}}
	for _, r := range roles {
		reportsTo := naText
		if r.ReportsToID != nil {
			if title, ok := titleByID[*r.ReportsToID]; ok {
				reportsTo = title
			}
		}
		t.Rows = append(t.Rows, []string{r.Title, reportsTo})
	}
	return &contentSection{Heading: "Organisational Structure", Table: t}
}

// buildMESection renders a plan's Monitoring & Evaluation chapter (see
// me_items in models_local_sections.go) grouped by category. Returns nil
// (not an empty section) if the plan hasn't filled this chapter in yet.
func (s *Service) buildMESection(ctx context.Context, plan *models.Plan, orgID uuid.UUID) *contentSection {
	items, err := s.planSvc.ListMEItems(ctx, plan.ID, orgID, nil)
	if err != nil || len(items) == 0 {
		return nil
	}
	labels := map[models.MECategory]string{
		models.MEObjective:             "Objective",
		models.MECriticalSuccessFactor: "Critical Success Factor",
		models.MEReviewNote:            "Review Note",
		models.MEConclusionMeasure:     "Conclusion / Rollout Measure",
	}
	t := &contentTable{Headers: []string{"Category", "Detail"}}
	for _, it := range items {
		label, ok := labels[it.Category]
		if !ok {
			label = titleCase(string(it.Category))
		}
		t.Rows = append(t.Rows, []string{label, it.Text})
	}
	return &contentSection{Heading: "Monitoring & Evaluation", Table: t}
}

// buildGenericContentSection turns an arbitrary activity content blob into
// a readable section without this package needing to know that activity
// type's exact shape ahead of time — the 7 Advanced Research activity types
// (see models.AdvancedResearchType) each use their own frontend editor with
// a different JSON content shape, and duplicating that knowledge here would
// mean updating this file every time one of those editors' content shape
// changes. String fields become "Label: value" paragraphs; an array of
// objects (e.g. TableEditor's {"rows": [...]}) becomes a table, columned
// off the first row's keys. Returns nil if the content has nothing
// renderable (e.g. an activity that was created but never filled in).
func buildGenericContentSection(heading string, content map[string]any) *contentSection {
	if len(content) == 0 {
		return nil
	}
	keys := make([]string, 0, len(content))
	for k := range content {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var paras []string
	var table *contentTable
	for _, k := range keys {
		switch v := content[k].(type) {
		case string:
			if v != "" {
				paras = append(paras, titleCase(strings.ReplaceAll(k, "_", " "))+": "+v)
			}
		case []any:
			if table != nil || len(v) == 0 {
				continue
			}
			first, ok := v[0].(map[string]any)
			if !ok {
				continue
			}
			cols := make([]string, 0, len(first))
			for c := range first {
				// "id" is the row's own UUID primary key (every Advanced
				// Research editor's row shape — TableRow, RiskRow, KpiRow,
				// etc. — has one), meaningless to a report reader and not
				// worth a column. Every other key (including things like
				// objective_id, which is a real cross-reference) still
				// comes through.
				if c == "id" {
					continue
				}
				cols = append(cols, c)
			}
			sort.Strings(cols)
			table = &contentTable{Headers: cols}
			for _, rawRow := range v {
				row, ok := rawRow.(map[string]any)
				if !ok {
					continue
				}
				cells := make([]string, len(cols))
				for i, c := range cols {
					cells[i] = fmt.Sprint(row[c])
				}
				table.Rows = append(table.Rows, cells)
			}
		}
	}
	if len(paras) == 0 && table == nil {
		return nil
	}
	return &contentSection{Heading: heading, Paragraphs: paras, Table: table}
}

// coverStats is the small slice of plan-progress numbers shown on the PDF
// cover page's completion badge (see render.go's buildCover) — pulled out
// of the richer progress result buildContent already fetches for the
// report body, rather than querying progress a second time just for the
// cover page.
type coverStats struct {
	OverallPercent    float64
	TotalActivities   int
	OverdueActivities int
	// IsKPIAchievement is true when OverallPercent came from the same KPI
	// achievement math as TrackingModule.tsx's "Overall" gauge (see
	// overallKPICompletion below), false when it's the activity-status
	// completion percentage (progress.Overall.Percent) used as a fallback
	// when the plan has no scored KPIs yet — mirrors the frontend's own
	// fallback rule ("every caller already treats null as 'fall back to
	// activity-status progress'", per TrackingModule.tsx's
	// fetchPlanKpiAchievement doc comment). render.go's cover badge reads
	// this to label the number "OVERALL" vs "ACTIVITIES COMPLETE" so the
	// label always matches what's actually being shown.
	IsKPIAchievement bool
}

func (s *Service) buildContent(ctx context.Context, plan *models.Plan, orgID uuid.UUID, sec SectionConfig) (*reportContent, coverStats, error) {
	rc := &reportContent{}

	// Progress is cheap and several sections depend on it, so fetch it once
	// up front regardless of which sections were actually requested.
	progress, err := s.planSvc.GetProgress(ctx, plan.ID, orgID)
	if err != nil {
		return nil, coverStats{}, err
	}
	stats := coverStats{
		TotalActivities:   progress.Overall.Total,
		OverdueActivities: progress.Overall.Overdue,
	}

	// The cover page's completion badge (see buildCover in render.go) is
	// meant to be the plan's "true tracking metric" — the same figure the
	// Tracking module's "Overall" gauge shows — not a re-derivation of it,
	// so a reader can't see two different completion numbers for the same
	// plan depending on whether they're looking at the app or the export.
	// That means fetching every activity's KPIs (regardless of which
	// sections were requested, since the cover always renders) and running
	// the exact same overallKPICompletion math TrackingModule.tsx uses.
	// Falls back to the activity-status percentage — same rule the
	// frontend itself uses (TrackingModule.tsx's fetchPlanKpiAchievement:
	// "every caller already treats null as 'fall back to activity-status
	// progress'") — for a plan with no scored KPIs yet, so a brand-new
	// plan still shows a meaningful number instead of a blank or a 0%.
	allActivities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, nil, nil, nil)
	if err != nil {
		return nil, coverStats{}, err
	}
	var allKPIs []models.KPI
	for _, a := range allActivities {
		allKPIs = append(allKPIs, a.KPIs...)
	}
	if pct, ok := overallKPICompletion(allKPIs); ok {
		stats.OverallPercent = pct
		stats.IsKPIAchievement = true
	} else {
		stats.OverallPercent = progress.Overall.Percent
	}

	// aiSummary lazily calls aiSummaryFn at most once per report. Both the
	// Executive Summary's "no description on file" fallback (below) and the
	// standalone AI Summary section want the same thing — an AI-written
	// overview of the plan, grounded in the plan/org's other available
	// information (see aisvc's context building) — so if a report requests
	// both and the plan has no description, this reuses the one call
	// instead of hitting the AI service twice for near-identical content.
	// Failure (nil aiSummaryFn, an error, or an empty result) is treated as
	// "AI unavailable" everywhere this is used — callers fall back to their
	// own plain, professional message rather than surfacing an error.
	var aiSummaryText string
	var aiSummaryTried bool
	aiSummary := func() (string, bool) {
		if aiSummaryTried {
			return aiSummaryText, aiSummaryText != ""
		}
		aiSummaryTried = true
		if s.aiSummaryFn == nil {
			slog.WarnContext(ctx, "report AI summary skipped: no aiSummaryFn configured",
				"plan_id", plan.ID, "org_id", orgID)
			return "", false
		}
		summary, err := s.aiSummaryFn(ctx, orgID, plan.ID)
		if err != nil {
			slog.WarnContext(ctx, "report AI summary failed",
				"plan_id", plan.ID, "org_id", orgID, "error", err)
			return "", false
		}
		if summary == "" {
			slog.WarnContext(ctx, "report AI summary returned empty result",
				"plan_id", plan.ID, "org_id", orgID)
			return "", false
		}
		aiSummaryText = summary
		return aiSummaryText, true
	}

	if sec.ExecutiveSummary {
		var desc string
		var aiGenerated bool
		switch {
		case plan.Description != nil && *plan.Description != "":
			desc = *plan.Description
		default:
			if summary, ok := aiSummary(); ok {
				desc = summary
				aiGenerated = true
			} else {
				// Neither an authored description nor a working AI service —
				// fall back to a plain, professional note rather than an
				// error string or leaving the section looking broken.
				desc = "No description was provided for this plan."
			}
		}
		// Same figure the cover badge shows (see buildCover's IsKPIAchievement
		// branch in render.go) — stats.OverallPercent, not the raw
		// activity-status progress.Overall.Percent. Using progress.Overall.Percent
		// here meant this paragraph and the cover badge could show two
		// different completion numbers for the same plan; stats was already
		// computed above specifically to be that one true tracking figure.
		var summaryLine string
		if stats.IsKPIAchievement {
			summaryLine = fmt.Sprintf(
				"%s is currently %s. %.0f%% overall KPI achievement across its %d total activities, with %d overdue.",
				plan.Title, plan.Status, stats.OverallPercent, progress.Overall.Total, progress.Overall.Overdue,
			)
		} else {
			summaryLine = fmt.Sprintf(
				"%s is currently %s. %.0f%% of its %d total activities are complete, with %d overdue.",
				plan.Title, plan.Status, stats.OverallPercent, progress.Overall.Total, progress.Overall.Overdue,
			)
		}
		paragraphs := []string{summaryLine}
		if aiGenerated {
			// Labeled rather than presented as if the org wrote it —
			// consistent with how the frontend labels AI-drafted content
			// (see AiDraftPanel.tsx / AiChapterAssist.tsx's "AI Draft ·
			// {model}" / "review before accepting" treatment) so a reader
			// of the finished report knows this paragraph wasn't authored
			// by the organisation and should be reviewed, not just an
			// unexplained description appearing from nowhere.
			paragraphs = append(paragraphs,
				"This plan has no description on file. The overview below was generated automatically from the plan's available details and should be reviewed for accuracy.",
			)
		}
		paragraphs = append(paragraphs, desc)
		rc.Sections = append(rc.Sections, contentSection{
			Heading:    "Executive Summary",
			Paragraphs: paragraphs,
		})
	}

	if sec.VisionMission {
		if vmSection := s.buildVisionMissionSection(ctx, plan, orgID); vmSection != nil {
			rc.Sections = append(rc.Sections, *vmSection)
		}
	}

	if sec.SituationalAnalysis {
		rc.Sections = append(rc.Sections, s.buildSituationalAnalysisSections(ctx, plan, orgID)...)
	}

	if sec.Scorecard {
		rc.Sections = append(rc.Sections, s.buildScorecardSections(ctx, plan, orgID)...)
	}

	if sec.ProgressStatus {
		t := &contentTable{Headers: []string{"Strategic Pillar", "Total", "Complete", "In Progress", "Overdue", "% Complete"}}
		for _, p := range progress.Pillars {
			t.Rows = append(t.Rows, []string{
				p.Title, fmt.Sprint(p.Total), fmt.Sprint(p.Complete),
				fmt.Sprint(p.InProgress), fmt.Sprint(p.Overdue), fmt.Sprintf("%.0f%%", p.Percent),
			})
		}
		t.Rows = append(t.Rows, []string{
			"Overall", fmt.Sprint(progress.Overall.Total), fmt.Sprint(progress.Overall.Complete),
			fmt.Sprint(progress.Overall.InProgress), fmt.Sprint(progress.Overall.Overdue),
			fmt.Sprintf("%.0f%%", progress.Overall.Percent),
		})
		rc.Sections = append(rc.Sections, contentSection{Heading: "Progress & Status", Table: t})

		// Advanced Research activities aren't under any pillar, so — same
		// as GetProgress's own AdvancedResearch bucket — they get their own
		// row here rather than being silently folded into (or omitted from)
		// the pillar table above.
		if progress.AdvancedResearch != nil {
			ar := progress.AdvancedResearch
			at := &contentTable{Headers: []string{"Total", "Complete", "In Progress", "Overdue", "% Complete"}}
			at.Rows = append(at.Rows, []string{
				fmt.Sprint(ar.Total), fmt.Sprint(ar.Complete),
				fmt.Sprint(ar.InProgress), fmt.Sprint(ar.Overdue), fmt.Sprintf("%.0f%%", ar.Percent),
			})
			rc.Sections = append(rc.Sections, contentSection{Heading: "Advanced Research Progress", Table: at})
		}
	}

	if sec.ObjectiveActivities {
		// One table per objective, headed by its pillar so the report
		// structure mirrors the Pillar > Objective > Activity hierarchy the
		// plan UI itself uses.
		pillars, err := s.planSvc.ListPillars(ctx, plan.ID, orgID)
		if err != nil {
			return nil, coverStats{}, err
		}
		pillarTitle := make(map[uuid.UUID]string, len(pillars))
		for _, p := range pillars {
			pillarTitle[p.ID] = p.Title
		}

		objectives, err := s.planSvc.ListObjectives(ctx, plan.ID, orgID)
		if err != nil {
			return nil, coverStats{}, err
		}
		for _, obj := range objectives {
			objID := obj.ID
			activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, &objID, nil, nil)
			if err != nil {
				return nil, coverStats{}, err
			}
			// One row per (activity, KPI) rather than one row per
			// activity — Target Period/Responsible/Budget moved off
			// Activity and onto each KPI in migration 013, and a single
			// activity can carry several KPIs with different values
			// for all three. An activity with no KPIs still gets one
			// row (KPI column shows naText) so it isn't silently
			// dropped from the report.
			t := &contentTable{Headers: []string{"Activity", "Status", "KPI", "Target Period", "Responsible", "Budget"}}
			for _, a := range activities {
				if len(a.KPIs) == 0 {
					t.Rows = append(t.Rows, []string{a.Title, string(a.Status), naText, naText, naText, naText})
					continue
				}
				for _, k := range a.KPIs {
					indicator, period, responsible, budget := naText, naText, naText, naText
					if k.Indicator != "" {
						indicator = k.Indicator
					}
					if k.TargetPeriod != nil && *k.TargetPeriod != "" {
						period = string(*k.TargetPeriod)
					}
					if k.Responsibility != nil && *k.Responsibility != "" {
						responsible = *k.Responsibility
					}
					if k.Budget != nil {
						budget = fmt.Sprintf("%.2f", *k.Budget)
					}
					t.Rows = append(t.Rows, []string{a.Title, string(a.Status), indicator, period, responsible, budget})
				}
			}
			heading := obj.Title
			if title, ok := pillarTitle[obj.PillarID]; ok {
				heading = fmt.Sprintf("%s \u2014 %s", title, obj.Title)
			}
			rc.Sections = append(rc.Sections, contentSection{Heading: heading, Table: t})
		}
	}

	if sec.AdvancedResearch {
		arCategory := models.ActivityCategoryAdvancedResearch
		activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, nil, &arCategory, nil)
		if err != nil {
			return nil, coverStats{}, err
		}
		if len(activities) > 0 {
			t := &contentTable{Headers: []string{"Type", "Title", "Status"}}
			for _, a := range activities {
				t.Rows = append(t.Rows, []string{titleCase(strings.ReplaceAll(a.Type, "_", " ")), a.Title, string(a.Status)})
			}
			rc.Sections = append(rc.Sections, contentSection{Heading: "Advanced Research", Table: t})

			// Each activity's own content is a free-form blob whose shape
			// depends on which of the 7 Advanced Research types it is (see
			// models.AdvancedResearchType) — buildGenericContentSection
			// renders whatever's there without this package needing to
			// know each editor's exact shape. Business Model Canvas is the
			// one exception: it's the only Advanced Research type with a
			// dedicated grid editor (BusinessModelCanvasEditor.tsx) rather
			// than free text, so it additionally gets a matching diagram —
			// same nine-block layout, drawn alongside (not instead of) the
			// generic paragraph rendering of the same fields.
			for _, a := range activities {
				detail := buildGenericContentSection(a.Title, a.Content)
				if a.Type == string(models.ARTypeBusinessModelCanvas) {
					dg := bmcDiagram(a.Content)
					if dg != nil {
						if detail == nil {
							detail = &contentSection{Heading: a.Title}
						}
						detail.Diagram = dg
					}
				}
				if detail != nil {
					rc.Sections = append(rc.Sections, *detail)
				}
			}
		}
	}

	if sec.OrgStructure {
		if orgStructSection := s.buildOrgStructureSection(ctx, plan, orgID); orgStructSection != nil {
			rc.Sections = append(rc.Sections, *orgStructSection)
		}
	}

	if sec.MonitoringEval {
		if meSection := s.buildMESection(ctx, plan, orgID); meSection != nil {
			rc.Sections = append(rc.Sections, *meSection)
		}
	}

	if sec.Milestones {
		milestones, err := s.milestoneSvc.ListMilestones(ctx, plan.ID, orgID)
		if err != nil {
			return nil, coverStats{}, err
		}
		t := &contentTable{Headers: []string{"Title", "Due Date", "Status"}}
		for _, m := range milestones {
			t.Rows = append(t.Rows, []string{m.Title, m.DueDate.Format("2006-01-02"), string(m.Status)})
		}
		rc.Sections = append(rc.Sections, contentSection{Heading: "Milestones", Table: t})
	}

	if sec.AISummary {
		text := "A summary is unavailable — the AI service could not be reached."
		if summary, ok := aiSummary(); ok {
			text = summary
		}
		rc.Sections = append(rc.Sections, contentSection{Heading: "Summary", Paragraphs: []string{text}})
	}

	return rc, stats, nil
}
