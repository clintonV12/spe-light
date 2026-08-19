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
	OrgStructure        bool `json:"org_structure"`
	ProgressStatus      bool `json:"progress_status"`
	MonitoringEval      bool `json:"monitoring_evaluation"`
	Milestones          bool `json:"milestones"`
	AISummary           bool `json:"ai_summary"`
}

func (s SectionConfig) hasContent() bool {
	return s.ExecutiveSummary || s.VisionMission || s.SituationalAnalysis ||
		s.ObjectiveActivities || s.AdvancedResearch ||
		s.OrgStructure ||
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
			OrgStructure:   true,
			ProgressStatus: true, MonitoringEval: true,
			Milestones: true, AISummary: true,
		}
	case models.ReportExecutiveSummary:
		return SectionConfig{ExecutiveSummary: true, VisionMission: true, ProgressStatus: true}
	case models.ReportPerPhase:
		// Report type name kept as-is (see models.ReportType / the reports
		// table's CHECK constraint, both untouched by 014) even though
		// "phase" no longer means anything — this now just means "activity
		// breakdown", same as ReportActivityDetail minus milestones.
		return SectionConfig{ObjectiveActivities: true, AdvancedResearch: true}
	case models.ReportProgressStatus:
		return SectionConfig{ProgressStatus: true, Milestones: true}
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
	// PESTEL, the Business Model Canvas, Competitive Analysis, the
	// Operational Roadmap) so the report shows the same shape a reader
	// who has seen the plan in the app would recognise, alongside (not
	// instead of) the plain data table. A rendering path that can't draw
	// diagrams (XLSX) simply ignores this field — the Table on the same
	// section already carries the same data.
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
// every current use case (risk score, revenue, allocation %, progress %) is
// exactly that shape. ColorHint on each bar optionally drives red/yellow/
// green thresholding — see riskRegisterChart's score bands for the one
// current user of it; charts that don't set it (financial/resource/budget)
// just get the brand default colour on every bar.
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

// competitiveAnalysisDiagram lays a Competitive Analysis activity's content
// out on the same left-to-right flow CompetitiveAnalysisEditor.tsx shows on
// screen (competitors -> market positioning -> differentiators), one wide
// cell per stage. Returns nil if none of the three fields have been filled
// in yet.
func competitiveAnalysisDiagram(content map[string]any) *contentDiagram {
	get := func(k string) string {
		if v, ok := content[k].(string); ok {
			return v
		}
		return ""
	}
	if get("competitors") == "" && get("positioning") == "" && get("differentiators") == "" {
		return nil
	}
	mk := func(key, label string, col int, hint string) diagramCell {
		return diagramCell{Label: label, Text: get(key), Col: col, Row: 0, ColorHint: hint}
	}
	return &contentDiagram{
		Kind: "competitive_analysis", Cols: 3, Rows: 1,
		Cells: []diagramCell{
			mk("competitors", "Competitors", 0, "neutral"),
			mk("positioning", "Market Positioning", 1, "blue"),
			mk("differentiators", "Differentiators", 2, "gold"),
		},
	}
}

// roadmapDiagram lays an Operational Roadmap activity's content out on the
// same four-quarter timeline RoadmapEditor.tsx shows on screen, one cell per
// quarter in the same left-to-right order. Returns nil if every quarter is
// empty.
func roadmapDiagram(content map[string]any) *contentDiagram {
	get := func(k string) string {
		if v, ok := content[k].(string); ok {
			return v
		}
		return ""
	}
	quarters := []string{"q1", "q2", "q3", "q4"}
	hints := []string{"blue", "green", "purple", "gold"}
	hasContent := false
	for _, q := range quarters {
		if get(q) != "" {
			hasContent = true
			break
		}
	}
	if !hasContent {
		return nil
	}
	cells := make([]diagramCell, len(quarters))
	for i, q := range quarters {
		cells[i] = diagramCell{Label: "Q" + fmt.Sprint(i+1), Text: get(q), Col: i, Row: 0, ColorHint: hints[i]}
	}
	return &contentDiagram{Kind: "roadmap", Cols: len(quarters), Rows: 1, Cells: cells}
}

// riskRegisterChart mirrors the "Bar" view RiskRegisterEditor.tsx offers on
// screen — one bar per named risk, highest score first, coloured with the
// same thresholds as the editor's scoreColor/scoreHex (>=15 red, >=8 amber,
// else green). Capped to the 10 highest-scoring risks so the chart stays
// readable in a report; the full list is still in the activity's own table.
// Returns nil if there are no named risks to chart.
func riskRegisterChart(content map[string]any) *contentChart {
	rows, _ := content["rows"].([]any)
	type namedRisk struct {
		label string
		score float64
	}
	var risks []namedRisk
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name, _ := row["risk"].(string)
		if name == "" {
			continue
		}
		score, _ := row["score"].(float64)
		risks = append(risks, namedRisk{label: name, score: score})
	}
	if len(risks) == 0 {
		return nil
	}
	sort.Slice(risks, func(i, j int) bool { return risks[i].score > risks[j].score })
	if len(risks) > 10 {
		risks = risks[:10]
	}
	bars := make([]chartBar, len(risks))
	for i, r := range risks {
		hint := "good"
		switch {
		case r.score >= 15:
			hint = "bad"
		case r.score >= 8:
			hint = "warn"
		}
		bars[i] = chartBar{Label: r.label, Value: r.score, ColorHint: hint}
	}
	return &contentChart{Title: "Risk Score (Likelihood x Impact)", Max: 25, Bars: bars}
}

// numFromAny reads a float64 out of a decoded-JSON value that might be a
// number or a numeric string — activity content round-trips through
// map[string]any, and a couple of frontend editors (FinancialProjections'
// line-item cells) store amounts as raw strings rather than JSON numbers.
func numFromAny(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case string:
		var f float64
		fmt.Sscanf(n, "%f", &f)
		return f
	default:
		return 0
	}
}

// riskMatrixDiagram lays named risks out on the same 5x5 likelihood/impact
// grid RiskRegisterEditor.tsx's "Matrix" view plots them on — likelihood
// increasing left-to-right, impact increasing bottom-to-top, so the report
// reads in the same orientation as the on-screen scatter chart. Risks that
// land on the same likelihood/impact cell share it, newline-joined, and
// each cell is coloured with the same red/amber/green score thresholds as
// riskRegisterChart. Only cells with at least one named risk are drawn — a
// full 25-cell grid mostly reading "N/A" would be worse than no diagram.
// Returns nil if there are no named risks to plot.
func riskMatrixDiagram(content map[string]any) *contentDiagram {
	rows, _ := content["rows"].([]any)
	type cellKey struct{ likelihood, impact int }
	byCell := map[cellKey][]string{}
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name, _ := row["risk"].(string)
		if name == "" {
			continue
		}
		l := int(numFromAny(row["likelihood"]))
		i := int(numFromAny(row["impact"]))
		if l < 1 || l > 5 || i < 1 || i > 5 {
			continue
		}
		key := cellKey{l, i}
		byCell[key] = append(byCell[key], name)
	}
	if len(byCell) == 0 {
		return nil
	}
	cells := make([]diagramCell, 0, len(byCell))
	for key, names := range byCell {
		score := key.likelihood * key.impact
		hint := "green"
		switch {
		case score >= 15:
			hint = "red"
		case score >= 8:
			hint = "gold"
		}
		cells = append(cells, diagramCell{
			Label:     fmt.Sprintf("L%d x I%d", key.likelihood, key.impact),
			Text:      strings.Join(names, "\n"),
			Col:       key.likelihood - 1,
			Row:       5 - key.impact,
			ColorHint: hint,
		})
	}
	// Map iteration order is random — sort so repeated generation for the
	// same plan produces byte-identical report output.
	sort.Slice(cells, func(i, j int) bool {
		if cells[i].Row != cells[j].Row {
			return cells[i].Row < cells[j].Row
		}
		return cells[i].Col < cells[j].Col
	})
	return &contentDiagram{Kind: "risk_matrix", Cols: 5, Rows: 5, Cells: cells}
}

// riskRegisterTable renders a Risk Register activity's rows with Risk as
// the first column — the same order RiskRegisterEditor.tsx's own table uses
// (Risk, Likelihood, Impact, Score, Mitigation, Owner) — rather than
// buildGenericContentSection's alphabetical column order, which would sort
// "Risk" in among the other columns instead of leading with it.
func riskRegisterTable(content map[string]any) *contentTable {
	rows, _ := content["rows"].([]any)
	if len(rows) == 0 {
		return nil
	}
	t := &contentTable{Headers: []string{"Risk", "Likelihood", "Impact", "Score", "Mitigation", "Owner"}}
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		str := func(k string) string {
			v, _ := row[k].(string)
			return v
		}
		num := func(k string) string { return fmt.Sprintf("%.0f", numFromAny(row[k])) }
		t.Rows = append(t.Rows, []string{str("risk"), num("likelihood"), num("impact"), num("score"), str("mitigation"), str("owner")})
	}
	if len(t.Rows) == 0 {
		return nil
	}
	return t
}

// financialProjectionsChart mirrors the revenue bars in
// FinancialProjectionsEditor.tsx's chart view — one bar per period, valued
// at that period's total revenue (summed across every revenue line item,
// the same as the editor's sumSection). Returns nil if there are no periods
// with any revenue entered yet.
func financialProjectionsChart(content map[string]any) *contentChart {
	periodsRaw, _ := content["periods"].([]any)
	if len(periodsRaw) == 0 {
		return nil
	}
	lineItems, _ := content["lineItems"].(map[string]any)
	revenueRaw, _ := lineItems["revenue"].([]any)

	var bars []chartBar
	maxVal := 0.0
	for _, praw := range periodsRaw {
		p, ok := praw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := p["id"].(string)
		label, _ := p["label"].(string)
		if label == "" {
			label = id
		}
		var total float64
		for _, iraw := range revenueRaw {
			item, ok := iraw.(map[string]any)
			if !ok {
				continue
			}
			values, _ := item["values"].(map[string]any)
			if values == nil {
				continue
			}
			total += numFromAny(values[id])
		}
		bars = append(bars, chartBar{Label: label, Value: total})
		if total > maxVal {
			maxVal = total
		}
	}
	if maxVal <= 0 {
		return nil
	}
	return &contentChart{Title: "Revenue by Period", Max: maxVal, Bars: bars}
}

// tableRowsChart builds a simple bar chart from a "rows" array where each
// row has both a text label field and a numeric value field — the shape
// resource_plan (resource/allocation_pct) and budget_allocation
// (category/amount) store via TableEditor.tsx, which offers the same kind
// of bar chart as a frontend-only view over those rows. Returns nil if
// there's nothing chartable yet.
func tableRowsChart(content map[string]any, labelKey, valueKey, title, unit string) *contentChart {
	rows, _ := content["rows"].([]any)
	var bars []chartBar
	maxVal := 0.0
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		label, _ := row[labelKey].(string)
		if label == "" {
			continue
		}
		val := numFromAny(row[valueKey])
		bars = append(bars, chartBar{Label: label, Value: val})
		if val > maxVal {
			maxVal = val
		}
	}
	if len(bars) == 0 || maxVal <= 0 {
		return nil
	}
	return &contentChart{Title: title, Unit: unit, Max: maxVal, Bars: bars}
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
	// overallKPICompletion below). False means no KPI has been scored yet
	// for this plan — OverallPercent is then just the zero value, not a
	// real "0%", and is not meant to be displayed. render.go's cover badge
	// and this file's Executive Summary both branch on this flag rather
	// than reading OverallPercent unconditionally, showing "—" / a plain
	// sentence instead of substituting a different metric (activity-status
	// completion) the way this used to — that substitution meant the cover
	// badge could show a number Tracking Module's own "Overall" gauge
	// never shows for the same plan.
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
	//
	// No fallback to the activity-status percentage when nothing's been
	// scored yet — that used to happen here (mirroring an old frontend
	// rule), but it meant this cover badge could show a number
	// (e.g. "12% ACTIVITIES COMPLETE") that the Tracking module's own
	// "Overall" gauge doesn't show for that same plan (it shows "—" — see
	// TrackingModule.tsx's overallKpiCompletion / DashboardPage.tsx's
	// PlanCard, which both stopped substituting a different metric for the
	// same reason). IsKPIAchievement staying false is exactly that "—"
	// state; buildCover renders it accordingly instead of a stray percent.
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
	}
	// else: leave OverallPercent at its zero value and IsKPIAchievement
	// false — "no KPIs scored yet," not "0% achieved." buildCover and the
	// Executive Summary both branch on IsKPIAchievement rather than reading
	// OverallPercent directly, so this zero value is never displayed as if
	// it meant something.

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
		// branch in render.go) — stats.OverallPercent/IsKPIAchievement, not
		// a re-derived activity-status percentage. When nothing's been
		// scored yet, stats.OverallPercent is just the zero value (not a
		// real "0%"), so that branch says so in words instead of printing
		// a fabricated percentage — matching the cover badge's "—".
		var summaryLine string
		if stats.IsKPIAchievement {
			summaryLine = fmt.Sprintf(
				"%s is currently %s. %.0f%% overall KPI achievement across its %d total activities, with %d overdue.",
				plan.Title, plan.Status, stats.OverallPercent, progress.Overall.Total, progress.Overall.Overdue,
			)
		} else {
			summaryLine = fmt.Sprintf(
				"%s is currently %s, with %d total activities and %d overdue. No KPI achievement has been scored yet for this plan.",
				plan.Title, plan.Status, progress.Overall.Total, progress.Overall.Overdue,
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
			// know each editor's exact shape. Every type that has its own
			// dedicated visual on screen (rather than plain free-text
			// fields) additionally gets a matching Diagram or Chart here,
			// drawn alongside — not instead of — the generic
			// paragraph/table rendering of the same fields, so a reader
			// who has seen the plan in the app recognises the same shape
			// in the report.
			for _, a := range activities {
				detail := buildGenericContentSection(a.Title, a.Content)
				var dg *contentDiagram
				var ch *contentChart
				switch a.Type {
				case string(models.ARTypeBusinessModelCanvas):
					dg = bmcDiagram(a.Content)
				case string(models.ARTypeCompetitiveAnalysis):
					dg = competitiveAnalysisDiagram(a.Content)
				case string(models.ARTypeOperationalRoadmap):
					dg = roadmapDiagram(a.Content)
				case string(models.ARTypeRiskRegister):
					// Risk Register gets both a diagram (the likelihood x
					// impact matrix) and a chart (score by risk), plus its
					// own Risk-first column order overriding the Table
					// buildGenericContentSection already built (which
					// would otherwise sort "Risk" alphabetically among
					// the other columns instead of leading with it).
					dg = riskMatrixDiagram(a.Content)
					ch = riskRegisterChart(a.Content)
					if t := riskRegisterTable(a.Content); t != nil {
						if detail == nil {
							detail = &contentSection{Heading: a.Title}
						}
						detail.Table = t
					}
				case string(models.ARTypeFinancialProjections):
					ch = financialProjectionsChart(a.Content)
				case string(models.ARTypeResourcePlan):
					ch = tableRowsChart(a.Content, "resource", "allocation_pct", "Resource Allocation", "%")
				case string(models.ARTypeBudgetAllocation):
					ch = tableRowsChart(a.Content, "category", "amount", "Budget Allocation", "")
				}
				if dg != nil || ch != nil {
					if detail == nil {
						detail = &contentSection{Heading: a.Title}
					}
					detail.Diagram = dg
					detail.Chart = ch
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
