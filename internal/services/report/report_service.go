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

// DateRange is accepted on the request for API-shape compatibility with the
// frontend but is not yet applied as a filter — every section currently
// reports the plan's full current state rather than a windowed slice.
type DateRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// SectionConfig mirrors the frontend's ReportSectionConfig exactly — field
// names must match its JSON keys.
type SectionConfig struct {
	ExecutiveSummary    bool           `json:"executive_summary"`
	VisionMission       bool           `json:"vision_mission"`
	SituationalAnalysis bool           `json:"situational_analysis"`
	PhaseActivities     bool           `json:"phase_activities"`
	Phases              []models.Phase `json:"phases"`
	Scorecard           bool           `json:"scorecard"`
	OrgStructure        bool           `json:"org_structure"`
	ProgressStatus      bool           `json:"progress_status"`
	MonitoringEval      bool           `json:"monitoring_evaluation"`
	Milestones          bool           `json:"milestones"`
	DependencyLinks     bool           `json:"dependency_links"`
	AISummary           bool           `json:"ai_summary"`
}

func (s SectionConfig) hasContent() bool {
	return s.ExecutiveSummary || s.VisionMission || s.SituationalAnalysis ||
		(s.PhaseActivities && len(s.Phases) > 0) ||
		s.Scorecard || s.OrgStructure ||
		s.ProgressStatus || s.MonitoringEval ||
		s.Milestones || s.DependencyLinks || s.AISummary
}

// defaultSections maps the five fixed report types onto an equivalent
// SectionConfig, so the content-building code only has to know about
// sections, not report types.
func defaultSections(t models.ReportType) SectionConfig {
	allPhases := []models.Phase{models.PhaseP1, models.PhaseP2, models.PhaseP3}
	switch t {
	case models.ReportFullPlan:
		return SectionConfig{
			ExecutiveSummary: true, VisionMission: true, SituationalAnalysis: true,
			PhaseActivities: true, Phases: allPhases,
			Scorecard: true, OrgStructure: true,
			ProgressStatus: true, MonitoringEval: true,
			Milestones: true, DependencyLinks: true, AISummary: true,
		}
	case models.ReportExecutiveSummary:
		return SectionConfig{ExecutiveSummary: true, VisionMission: true, Scorecard: true, ProgressStatus: true}
	case models.ReportPerPhase:
		return SectionConfig{PhaseActivities: true, Phases: allPhases}
	case models.ReportProgressStatus:
		return SectionConfig{ProgressStatus: true, Scorecard: true, Milestones: true}
	case models.ReportActivityDetail:
		return SectionConfig{PhaseActivities: true, Phases: allPhases, Milestones: true}
	default:
		return SectionConfig{}
	}
}

// GenerateRequest is the decoded POST /api/v1/plans/{planID}/reports body.
type GenerateRequest struct {
	Type      models.ReportType   `json:"type"`
	Format    models.ReportFormat `json:"format"`
	DateRange *DateRange          `json:"date_range,omitempty"`
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

	content, err := s.buildContent(ctx, plan, orgID, sections)
	if err != nil {
		return nil, fmt.Errorf("build report content: %w", err)
	}

	meta := s.buildMeta(ctx, plan, orgID, userID, req.Type)

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
func (s *Service) buildMeta(ctx context.Context, plan *models.Plan, orgID, userID uuid.UUID, reportType models.ReportType) reportMeta {
	meta := reportMeta{
		ReportTitle:     plan.Title,
		ReportTypeLabel: reportTypeLabel(string(reportType)),
		PlanTitle:       plan.Title,
		PlanStatus:      string(plan.Status),
		PlanFramework:   planFrameworkLabel(plan.PlanType),
		OrgName:         "Your Organisation",
		GeneratedBy:     "System",
		GeneratedAt:     time.Now(),
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

// planFrameworkLabel gives a human-readable name for the plan's activity
// hierarchy, shown on the cover page so it's immediately clear which of the
// two supported plan types (see models.PlanType) a given report is for.
func planFrameworkLabel(pt models.PlanType) string {
	if pt == models.PlanTypeLocal {
		return "Local (Eswatini Standard)"
	}
	return "International"
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
// enterprise strategic plans — Vision, Mission, and Core Values. Local
// plans store these directly (Plan.Vision/Plan.Mission plus the
// core_values table — see models_local_sections.go); international plans
// have no equivalent fields, so this falls back to a 'vision_mission'
// activity's content if one exists. Returns nil (section omitted) if
// neither source has anything — a plan that hasn't filled this in yet
// shouldn't get an empty heading in its report.
func (s *Service) buildVisionMissionSection(ctx context.Context, plan *models.Plan, orgID uuid.UUID) *contentSection {
	if plan.PlanType == models.PlanTypeLocal {
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

	activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, nil, nil, nil)
	if err != nil {
		return nil
	}
	for _, a := range activities {
		if a.Type == "vision_mission" {
			return buildGenericContentSection("Vision, Mission & Core Values", a.Content)
		}
	}
	return nil
}

// buildSituationalAnalysisSections covers Stakeholder/SWOT/PESTEL analysis.
// Local plans have dedicated tables for each (see models_local_sections.go)
// and get one properly-columned table per sub-section; international plans
// fall back to whatever 'swot'/'pestle'/'stakeholder_map' activities exist,
// rendered generically since this package doesn't own those editors' JSON
// shapes. Returns an empty slice (not nil-vs-empty sensitive — callers just
// append) if nothing is available for either path.
func (s *Service) buildSituationalAnalysisSections(ctx context.Context, plan *models.Plan, orgID uuid.UUID) []contentSection {
	if plan.PlanType != models.PlanTypeLocal {
		var out []contentSection
		activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, nil, nil, nil)
		if err != nil {
			return nil
		}
		headings := map[string]string{
			"swot": "SWOT Analysis", "pestle": "PESTEL Analysis", "stakeholder_map": "Stakeholder Analysis",
		}
		for _, a := range activities {
			heading, ok := headings[a.Type]
			if !ok {
				continue
			}
			if sec := buildGenericContentSection(heading, a.Content); sec != nil {
				out = append(out, *sec)
			}
		}
		return out
	}

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
		out = append(out, contentSection{Heading: "SWOT Analysis", Table: t})
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
		out = append(out, contentSection{Heading: "PESTEL Analysis", Table: t})
	}

	return out
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

// buildScorecardSections returns the KPI detail table and, if any KPI has
// a reporting period set, an achievement-by-period bar chart — the same
// capped-at-100-per-KPI averaging TrackingModule.tsx's periodCompletion
// uses, so one overachieving KPI can't skew a period's bar past what a
// fully-met set of KPIs would show.
//
// This works identically for both plan types: KPIs live on Activity.KPIs
// regardless of PlanType (see models.KPI) — local plans just currently have
// UI (CreateActivityModal / LocalActivityEditor / TrackingModule) to fill
// them in, so in practice this section is richer there today, but nothing
// about it is local-plan-specific.
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
			if a.TargetPeriod != nil {
				period = titleCase(string(*a.TargetPeriod))
			}
			indicator := k.Indicator
			if indicator == "" {
				indicator = naText
			}
			t.Rows = append(t.Rows, []string{a.Title, indicator, target, actual, achievement, period})

			if ok && a.TargetPeriod != nil {
				capped := pct
				if capped > 100 {
					capped = 100
				}
				periodSums[*a.TargetPeriod] += capped
				periodCounts[*a.TargetPeriod]++
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

// buildOrgStructureSection renders a local plan's org chart (see
// org_structure_roles in models_local_sections.go) as a flat Role/Reports-To
// table — enough to reconstruct the hierarchy without needing actual box-
// and-line diagram rendering, which the hand-rolled renderers here aren't
// set up for. International plans have no organisational-structure concept
// in this platform, so this returns nil for them rather than an empty
// section.
func (s *Service) buildOrgStructureSection(ctx context.Context, plan *models.Plan, orgID uuid.UUID) *contentSection {
	if plan.PlanType != models.PlanTypeLocal {
		return nil
	}
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

// buildMESection renders a local plan's Monitoring & Evaluation chapter
// (see me_items in models_local_sections.go) grouped by category.
// International plans use the Progress & Status section (below) as their
// M&E equivalent instead, so this returns nil for them.
func (s *Service) buildMESection(ctx context.Context, plan *models.Plan, orgID uuid.UUID) *contentSection {
	if plan.PlanType != models.PlanTypeLocal {
		return nil
	}
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
// type's exact shape ahead of time — international activities use per-type
// editors (VisionMissionEditor, SwotEditor, TableEditor, GenericEditor...)
// with different JSON shapes, and duplicating that knowledge here would
// mean updating this file every time a frontend editor's content shape
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

func (s *Service) buildContent(ctx context.Context, plan *models.Plan, orgID uuid.UUID, sec SectionConfig) (*reportContent, error) {
	rc := &reportContent{}

	// Progress is cheap and several sections depend on it, so fetch it once
	// up front regardless of which sections were actually requested.
	progress, err := s.planSvc.GetProgress(ctx, plan.ID, orgID)
	if err != nil {
		return nil, err
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
			return "", false
		}
		summary, err := s.aiSummaryFn(ctx, orgID, plan.ID)
		if err != nil || summary == "" {
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
		paragraphs := []string{
			fmt.Sprintf(
				"%s is currently %s. %.0f%% of its %d total activities are complete, with %d overdue.",
				plan.Title, plan.Status, progress.Overall.Percent, progress.Overall.Total, progress.Overall.Overdue,
			),
		}
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
		if plan.PlanType == models.PlanTypeLocal {
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
		} else {
			t := &contentTable{Headers: []string{"Phase", "Total", "Complete", "In Progress", "Overdue", "% Complete"}}
			for _, p := range progress.Phases {
				t.Rows = append(t.Rows, []string{
					string(p.Phase), fmt.Sprint(p.Total), fmt.Sprint(p.Complete),
					fmt.Sprint(p.InProgress), fmt.Sprint(p.Overdue), fmt.Sprintf("%.0f%%", p.Percent),
				})
			}
			t.Rows = append(t.Rows, []string{
				"Overall", fmt.Sprint(progress.Overall.Total), fmt.Sprint(progress.Overall.Complete),
				fmt.Sprint(progress.Overall.InProgress), fmt.Sprint(progress.Overall.Overdue),
				fmt.Sprintf("%.0f%%", progress.Overall.Percent),
			})
			rc.Sections = append(rc.Sections, contentSection{Heading: "Progress & Status", Table: t})
		}
	}

	if sec.PhaseActivities {
		if plan.PlanType == models.PlanTypeLocal {
			// sec.Phases doesn't apply here — a local plan's activities
			// belong to a StrategicObjective (via Activity.ObjectiveID),
			// not a phase. One table per objective instead, headed by its
			// pillar so the report structure mirrors the Pillar > Objective
			// > Activity hierarchy the local-plan UI itself uses.
			pillars, err := s.planSvc.ListPillars(ctx, plan.ID, orgID)
			if err != nil {
				return nil, err
			}
			pillarTitle := make(map[uuid.UUID]string, len(pillars))
			for _, p := range pillars {
				pillarTitle[p.ID] = p.Title
			}

			objectives, err := s.planSvc.ListObjectives(ctx, plan.ID, orgID)
			if err != nil {
				return nil, err
			}
			for _, obj := range objectives {
				objID := obj.ID
				activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, nil, &objID, nil)
				if err != nil {
					return nil, err
				}
				t := &contentTable{Headers: []string{"Activity", "Status", "Target Period", "Responsible", "Budget"}}
				for _, a := range activities {
					period, responsible, budget := naText, naText, naText
					if a.TargetPeriod != nil && *a.TargetPeriod != "" {
						period = string(*a.TargetPeriod)
					}
					if a.Responsibility != nil && *a.Responsibility != "" {
						responsible = *a.Responsibility
					}
					if a.Budget != nil {
						budget = fmt.Sprintf("%.2f", *a.Budget)
					}
					t.Rows = append(t.Rows, []string{a.Title, string(a.Status), period, responsible, budget})
				}
				heading := obj.Title
				if title, ok := pillarTitle[obj.PillarID]; ok {
					heading = fmt.Sprintf("%s \u2014 %s", title, obj.Title)
				}
				rc.Sections = append(rc.Sections, contentSection{Heading: heading, Table: t})
			}
		} else {
			for _, phase := range sec.Phases {
				ph := phase
				activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, &ph, nil, nil)
				if err != nil {
					return nil, err
				}
				t := &contentTable{Headers: []string{"Title", "Type", "Status", "Due Date"}}
				for _, a := range activities {
					due := naText
					if a.DueDate != nil {
						due = a.DueDate.Format("2006-01-02")
					}
					t.Rows = append(t.Rows, []string{a.Title, a.Type, string(a.Status), due})
				}
				rc.Sections = append(rc.Sections, contentSection{
					Heading: fmt.Sprintf("Phase %s Activities", phase),
					Table:   t,
				})
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
			return nil, err
		}
		t := &contentTable{Headers: []string{"Title", "Due Date", "Status"}}
		for _, m := range milestones {
			t.Rows = append(t.Rows, []string{m.Title, m.DueDate.Format("2006-01-02"), string(m.Status)})
		}
		rc.Sections = append(rc.Sections, contentSection{Heading: "Milestones", Table: t})
	}

	if sec.DependencyLinks {
		links, err := s.planSvc.ListLinks(ctx, plan.ID, orgID, nil)
		if err != nil {
			return nil, err
		}
		// Resolve activity IDs to titles for a readable table instead of raw UUIDs.
		titles, err := s.activityTitleIndex(ctx, plan.ID, orgID)
		if err != nil {
			return nil, err
		}
		t := &contentTable{Headers: []string{"Source", "Target", "Type"}}
		for _, l := range links {
			t.Rows = append(t.Rows, []string{
				titleOr(titles, l.SourceID), titleOr(titles, l.TargetID), string(l.LinkType),
			})
		}
		rc.Sections = append(rc.Sections, contentSection{Heading: "Dependency Links", Table: t})
	}

	if sec.AISummary {
		text := "A summary is unavailable — the AI service could not be reached."
		if summary, ok := aiSummary(); ok {
			text = summary
		}
		rc.Sections = append(rc.Sections, contentSection{Heading: "Summary", Paragraphs: []string{text}})
	}

	return rc, nil
}

// activityTitleIndex builds an id -> title lookup for the whole plan, used
// to make the dependency-links table human-readable.
func (s *Service) activityTitleIndex(ctx context.Context, planID, orgID uuid.UUID) (map[uuid.UUID]string, error) {
	activities, err := s.planSvc.ListActivities(ctx, planID, orgID, nil, nil, nil)
	if err != nil {
		return nil, err
	}
	idx := make(map[uuid.UUID]string, len(activities))
	for _, a := range activities {
		idx[a.ID] = a.Title
	}
	return idx, nil
}

func titleOr(idx map[uuid.UUID]string, id uuid.UUID) string {
	if t, ok := idx[id]; ok {
		return t
	}
	return id.String()
}
