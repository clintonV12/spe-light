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

	"spe-light/internal/models"
	milestonesvc "spe-light/internal/services/milestone"
	plansvc "spe-light/internal/services/plan"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AISummaryFn adapts to aisvc.Service.Summary without this package needing
// to import the ai service's request/response types directly — router.go
// wires the real implementation in as a closure at construction time.
type AISummaryFn func(ctx context.Context, orgID, planID uuid.UUID) (string, error)

// Service handles report generation, storage, and retrieval.
type Service struct {
	db           *pgxpool.Pool
	planSvc      *plansvc.Service
	milestoneSvc *milestonesvc.Service
	aiSummaryFn  AISummaryFn
	storageDir   string
}

// New creates a report Service. aiSummaryFn may be nil — the AI summary
// section will then just note that AI summaries are unavailable rather than
// erroring the whole report out.
func New(db *pgxpool.Pool, planSvc *plansvc.Service, milestoneSvc *milestonesvc.Service, aiSummaryFn AISummaryFn) *Service {
	dir := os.Getenv("REPORTS_STORAGE_DIR")
	if dir == "" {
		dir = "./data/reports"
	}
	return &Service{db: db, planSvc: planSvc, milestoneSvc: milestoneSvc, aiSummaryFn: aiSummaryFn, storageDir: dir}
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
	ExecutiveSummary bool           `json:"executive_summary"`
	PhaseActivities  bool           `json:"phase_activities"`
	Phases           []models.Phase `json:"phases"`
	ProgressStatus   bool           `json:"progress_status"`
	Milestones       bool           `json:"milestones"`
	DependencyLinks  bool           `json:"dependency_links"`
	AISummary        bool           `json:"ai_summary"`
}

func (s SectionConfig) hasContent() bool {
	return s.ExecutiveSummary ||
		(s.PhaseActivities && len(s.Phases) > 0) ||
		s.ProgressStatus || s.Milestones || s.DependencyLinks || s.AISummary
}

// defaultSections maps the five fixed report types onto an equivalent
// SectionConfig, so the content-building code only has to know about
// sections, not report types.
func defaultSections(t models.ReportType) SectionConfig {
	allPhases := []models.Phase{models.PhaseP1, models.PhaseP2, models.PhaseP3}
	switch t {
	case models.ReportFullPlan:
		return SectionConfig{
			ExecutiveSummary: true, PhaseActivities: true, Phases: allPhases,
			ProgressStatus: true, Milestones: true, DependencyLinks: true, AISummary: true,
		}
	case models.ReportExecutiveSummary:
		return SectionConfig{ExecutiveSummary: true, ProgressStatus: true}
	case models.ReportPerPhase:
		return SectionConfig{PhaseActivities: true, Phases: allPhases}
	case models.ReportProgressStatus:
		return SectionConfig{ProgressStatus: true, Milestones: true}
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

	var fileBytes []byte
	switch req.Format {
	case models.ReportPDF:
		fileBytes, err = renderPDF(plan.Title, content)
	case models.ReportDOCX:
		fileBytes, err = renderDOCX(plan.Title, content)
	case models.ReportXLSX:
		fileBytes, err = renderXLSX(plan.Title, content)
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
}

type contentTable struct {
	Headers []string
	Rows    [][]string
}

func (s *Service) buildContent(ctx context.Context, plan *models.Plan, orgID uuid.UUID, sec SectionConfig) (*reportContent, error) {
	rc := &reportContent{}

	// Progress is cheap and several sections depend on it, so fetch it once
	// up front regardless of which sections were actually requested.
	progress, err := s.planSvc.GetProgress(ctx, plan.ID, orgID)
	if err != nil {
		return nil, err
	}

	if sec.ExecutiveSummary {
		desc := "No description was provided for this plan."
		if plan.Description != nil && *plan.Description != "" {
			desc = *plan.Description
		}
		rc.Sections = append(rc.Sections, contentSection{
			Heading: "Executive Summary",
			Paragraphs: []string{
				fmt.Sprintf(
					"%s is currently %s. %.0f%% of its %d total activities are complete, with %d overdue.",
					plan.Title, plan.Status, progress.Overall.Percent, progress.Overall.Total, progress.Overall.Overdue,
				),
				desc,
			},
		})
	}

	if sec.ProgressStatus {
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

	if sec.PhaseActivities {
		for _, phase := range sec.Phases {
			ph := phase
			activities, err := s.planSvc.ListActivities(ctx, plan.ID, orgID, &ph, nil)
			if err != nil {
				return nil, err
			}
			t := &contentTable{Headers: []string{"Title", "Type", "Status", "Due Date"}}
			for _, a := range activities {
				due := "—"
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
		text := "AI summary is unavailable — the AI service could not be reached."
		if s.aiSummaryFn != nil {
			if summary, err := s.aiSummaryFn(ctx, orgID, plan.ID); err == nil && summary != "" {
				text = summary
			}
		}
		rc.Sections = append(rc.Sections, contentSection{Heading: "AI-Generated Summary", Paragraphs: []string{text}})
	}

	return rc, nil
}

// activityTitleIndex builds an id -> title lookup for the whole plan, used
// to make the dependency-links table human-readable.
func (s *Service) activityTitleIndex(ctx context.Context, planID, orgID uuid.UUID) (map[uuid.UUID]string, error) {
	activities, err := s.planSvc.ListActivities(ctx, planID, orgID, nil, nil)
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
