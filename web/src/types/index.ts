/**
 * types/index.ts — canonical TypeScript types for StratPlan.
 *
 * Derived directly from internal/models/models.go JSON tags.
 * Every field name here must match the Go `json:"..."` tag exactly.
 * Pointer fields in Go (e.g. *string, *time.Time) map to optional (?) here.
 *
 * DO NOT add camelCase aliases — the backend sends snake_case throughout.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'super_admin'
  | 'platform_support'
  | 'org_admin'
  | 'planner'
  | 'contributor'
  | 'viewer'

export type PlanStatus = 'draft' | 'active' | 'review' | 'completed' | 'archived'

// Plans no longer choose between a fixed P1/P2/P3 model and the ESWAMCU
// pillar/objective model — every plan is the pillar/objective structure
// (Strategic Pillars → Strategic Objectives (KPAs) → activities, each with
// a budget, responsibility, target period, and one or more KPIs). There is
// no PlanType and no `plan_type` field on Plan any more.

// Retained only because ReportSectionConfig's 'custom' report type still
// lets a person pick P1/P2/P3 sections (ReportType.per_phase / the
// `phases`/`phase_activities` fields below) — that's a reporting-only
// concept now, unrelated to how activities are organised, and hasn't been
// redesigned yet (see the TODO on ReportSectionConfig below). Don't use
// Phase for anything activity-related; Activity has no `phase` field.
export type Phase = 'P1' | 'P2' | 'P3'

export type ActivityStatus = 'not_started' | 'in_progress' | 'review' | 'complete'

// Marks a standalone activity that isn't nested under any Strategic
// Objective — the "Advanced Research" tab. `null`/undefined on every
// ordinary (objective-nested) activity.
export type ActivityCategory = 'advanced_research'

// The fixed set of activity types offered by the "Advanced Research" tab
// (CreateActivityModal, advanced mode). Not a backend-enforced enum —
// internal/models/models.go stores Activity.Type as a plain string — but
// exported here so anything enumerating the options gets proper typing
// instead of falling back to `string`. Deliberately just these 7: the
// other former "international" activity types either moved to their own
// dedicated chapter UI (vision_mission, swot, pestle, strategic_objectives)
// or were dropped as redundant with per-activity KPIs / ordinary objective
// activities (kpi_framework, action_items, and the remaining former P1–P3
// types not listed here).
export type ActivityType =
  | 'business_model_canvas'
  | 'competitive_analysis'
  | 'risk_register'
  | 'okr_balanced_scorecard'
  | 'operational_roadmap'
  | 'resource_plan'
  | 'budget_allocation'

export type ActivityLinkType = 'manual' | 'ai_suggested'

export type InviteStatus = 'pending' | 'accepted' | 'cancelled' | 'expired'

export type SSOProtocol = 'saml' | 'oidc'

export type MilestoneStatus = 'pending' | 'reached' | 'missed'

export type ReportType =
  | 'full_plan'
  | 'executive_summary'
  | 'per_phase'
  | 'progress_status'
  | 'activity_detail'
  | 'custom'

export type ReportFormat = 'pdf' | 'docx' | 'xlsx'

// Only relevant when ReportType === 'custom' — lets the user pick which
// sections of the plan get included instead of using one of the fixed
// report shapes above. `phases` only applies when `phase_activities` is
// true and controls which of P1/P2/P3 are pulled in.
//
// vision_mission / situational_analysis / org_structure / monitoring_evaluation
// draw on their own chapter data (Vision/Mission/Core Values, Stakeholders/
// SWOT/PESTEL, org_structure_roles, me_items) — every plan has these now.
// scorecard (KPI target/actual/achievement, plus an achievement-by-period
// chart) reads KPIs straight off Activity.KPIs.
//
// TODO(backend): `phases` / `phase_activities` / ReportType.per_phase still
// reference the retired P1/P2/P3 phase model, which no longer means
// anything now that activities are pillar/objective-only. Needs a follow-up
// design pass with whoever owns report generation before this ships.
export interface ReportSectionConfig {
  executive_summary:     boolean
  vision_mission:        boolean
  situational_analysis:  boolean
  phase_activities:      boolean
  phases:                Phase[]
  scorecard:              boolean
  org_structure:          boolean
  progress_status:        boolean
  monitoring_evaluation:  boolean
  milestones:             boolean
  dependency_links:       boolean
  ai_summary:             boolean
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  access_token:  string
  refresh_token: string
  expires_in:    number    // seconds
}

export interface LoginPayload {
  email:    string
  password: string
}

// ── Organisation ──────────────────────────────────────────────────────────────

export interface Organisation {
  id:          string
  name:        string
  slug:        string
  logo_url?:   string
  locale:      string
  industry?:   string
  is_active:   boolean

  // ── Org profile (self-service, org_admin editable via orgApi.updateOrg /
  //    PATCH /api/v1/org). Folded into AI draft/summary/suggest-links
  //    prompts on the backend so results are grounded in what the org
  //    actually is, not just the plan text. ──────────────────────────────
  address?:       string
  country?:       string
  contact_email?: string
  contact_phone?: string
  org_structure?: string
  total_members?: number

  created_at:  string
  updated_at:  string
  deleted_at?: string
}

// Fields an org_admin can edit about their own organisation via
// PATCH /api/v1/org (orgApi.updateOrg). Distinct from adminApi.updateOrg's
// payload (name/is_active), which is platform_admin-only.
export interface OrgProfileUpdate {
  industry?:       string
  address?:        string
  country?:        string
  contact_email?:  string
  contact_phone?:  string
  org_structure?:  string
  total_members?:  number
}

// ── User ──────────────────────────────────────────────────────────────────────

export interface User {
  id:             string
  org_id?:        string
  email:          string
  name:           string
  role:           UserRole
  locale?:        string
  is_active:      boolean
  last_login_at?: string
  created_at:     string
  updated_at:     string
  deleted_at?:    string
  /** Non-backend field: used by mock layer for plan-scoped viewer testing */
  plan_ids?:      string[]
  phone?:      string
  avatar_url?: string
}

export interface ProfileUpdate { name?: string; phone?: string; avatar_url?: string; locale?: string }
export interface ChangePasswordPayload { current_password: string; new_password: string; confirm_password: string }
export interface Session { id: string; created_at: string; expires_at: string }

// ── Invitation ────────────────────────────────────────────────────────────────

export interface Invitation {
  id:           string
  org_id?:      string
  email:        string
  role:         UserRole
  invited_by:   string
  expires_at:   string
  accepted_at?: string
  status:       InviteStatus
  plan_ids?:    string[]
  created_at:   string
  updated_at?:  string
}

// ── SSO config ────────────────────────────────────────────────────────────────

export interface SSOConfig {
  id:                   string
  org_id:               string
  protocol:             SSOProtocol
  metadata_url?:        string
  entity_id?:           string
  client_id?:           string
  discovery_url?:       string
  default_role:         UserRole
  jit_enabled:          boolean
  local_login_disabled: boolean
  created_at:           string
  updated_at:           string
}

// ── Plan ──────────────────────────────────────────────────────────────────────

export interface Plan {
  id:          string
  org_id:      string
  title:       string
  description?: string
  status:      PlanStatus
  owner_id:    string
  start_date?: string
  end_date?:   string
  created_at:  string
  updated_at:  string
  deleted_at?: string
  /** Injected by the frontend after a /progress call; not a backend field */
  progress?:   PlanProgress
  vision?: string
  mission?: string
}

// ── Plan progress ─────────────────────────────────────────────────────────────
//
// Matches internal/services/plan/plan_service.go's PlanProgress exactly
// (this is a response DTO, not a persisted model, so it lives in
// plan_service.go rather than models.go — but the same "field names must
// match the Go json tags exactly" rule applies). There is no flat
// `overall_percent`/`overdue_count` on PlanProgress — the backend nests
// overall stats under `overall` (same shape as each pillar) and calls the
// percentage field `percent_complete`.

export interface ProgressStats {
  total:            number
  complete:         number
  in_progress:      number
  overdue:          number
  percent_complete: number
}

// One entry per Strategic Pillar.
export interface PillarProgress extends ProgressStats {
  pillar_id: string
  title:     string
}

export interface MilestoneStats {
  total:   number
  reached: number
  missed:  number
  pending: number
}

// `pillars` is always present now (every plan has pillars). `advanced_research`
// is only present once the plan has at least one Advanced Research activity —
// render it as its own summary card, not folded into the pillar breakdown,
// since it doesn't belong to any pillar. `overall` covers every activity in
// the plan (pillar-attached + Advanced Research combined).
export interface PlanProgress {
  plan_id:            string
  status:             PlanStatus
  pillars:            PillarProgress[]
  advanced_research?: ProgressStats
  overall:            ProgressStats
  milestones:         MilestoneStats
}

// ── Strategic pillars / objectives ──────────────────────────────────────

// Top-level, user-defined grouping for a plan — pillars are named per-plan
// by the planner (there is no fixed P1/P2/P3 any more).
export interface StrategicPillar {
  id:         string
  plan_id:    string
  org_id:     string
  title:      string
  user_order: number
  created_at: string
  updated_at: string
}

// A Strategic Objective / KPA nested under a pillar. Local-plan activities
// attach to an objective (Activity.objective_id) rather than to a phase.
export interface StrategicObjective {
  id:         string
  plan_id:    string
  pillar_id:  string
  org_id:     string
  title:      string
  user_order: number
  created_at: string
  updated_at: string
}

// "increase": higher actual is better (e.g. revenue). "decrease": lower actual is better (e.g. defect rate).
export type KPIDirection = 'increase' | 'decrease'

// The reporting cadence an activity (and therefore all of its KPIs) is
// tracked against — see Activity.target_period below.
export type KPIPeriod = 'monthly' | 'quarterly' | 'annual'

export const KPI_PERIODS: KPIPeriod[] = ['monthly', 'quarterly', 'annual']

// One Key Performance Indicator attached to a local-plan activity. An
// activity commonly carries more than one, hence Activity.kpis being an
// array. This is also the Tracking Module's source of truth: indicator/
// target stay the free-text description entered when the activity was
// created (e.g. "Reduce dropout rate", "20% by Year 1"), while
// target_value/actual_value are the numbers actually used to compute an
// achievement percentage. target_value can be set at creation;
// actual_value is normally filled in later, over time, from the Tracking
// Module as progress comes in.
//
// budget/responsibility/target_period live here rather than on Activity —
// the ESWAMCU "Implementation Framework" table's BUDGET/RESPONSIBILITY/
// TARGET PERIOD columns are answered per-KPI (each KPI can have its own
// cost, owner, and reporting cadence), not once for the whole activity.
// target_period doubles as the Tracking Module's reporting-period bucket
// for this specific KPI — see TrackingModule.tsx's periodCompletion.
export interface KPI {
  indicator:       string
  target:          string
  target_value?:   number
  actual_value?:   number
  direction?:      KPIDirection
  budget?:         number
  responsibility?: string
  target_period?:  KPIPeriod
}

// ── Activity ──────────────────────────────────────────────────────────────────

// Exactly one of objective_id / category is set: objective_id for an
// ordinary activity nested under a Strategic Objective, category:
// 'advanced_research' for a standalone Advanced Research activity attached
// directly to the plan (no objective, no pillar). category is null/absent
// on every ordinary activity. kpis only makes sense — and is only accepted
// by the backend — for objective-nested activities; Advanced Research
// activities never send kpis.
export interface Activity {
  id:            string
  plan_id:       string
  org_id:        string
  objective_id?: string
  category?:     ActivityCategory | null
  type:          string
  title:         string
  user_order:    number
  status:        ActivityStatus
  content:       Record<string, unknown>
  ai_draft?:     Record<string, unknown>
  assigned_to?:  string[]
  due_date?:     string

  // Budget/responsibility/target period used to live here as one set of
  // values for the whole activity — moved onto each KPI instead (see
  // KPI above), since the ESWAMCU table answers those per-indicator, not
  // once per activity. Kept here only as the array itself.
  kpis?: KPI[]

  created_at:    string
  updated_at:    string
  deleted_at?:   string
}

// ── Activity link ─────────────────────────────────────────────────────────────

export interface ActivityLink {
  id:         string
  plan_id:    string
  source_id:  string
  target_id:  string
  link_type:  ActivityLinkType
  created_by: string
  created_at: string
  updated_at: string
}

// ── Milestone ─────────────────────────────────────────────────────────────────

export interface Milestone {
  id:                  string
  plan_id:             string
  title:               string
  due_date:            string
  status:              MilestoneStatus
  linked_activity_id?: string
  created_at:          string
  updated_at:          string
}

// ── Report ────────────────────────────────────────────────────────────────────

export interface Report {
  id:           string
  plan_id:      string
  type:         ReportType
  format:       ReportFormat
  file_url?:    string
  generated_at: string
  generated_by: string
  /** Only present when type === 'custom' */
  sections?:    ReportSectionConfig
}

// ── AI ────────────────────────────────────────────────────────────────────────

export interface AiDraftRequest {
  plan_id:       string
  /** Omitted for local-plan chapter drafts (2/3/6/7), which have no backing Activity. */
  activity_id?:  string
  activity_type: string
  /** Omitted for local-plan chapter drafts, which have no P1/P2/P3 phase. */
  phase?:        Phase
  keywords?:     string[]
}

export interface AiDraftResponse {
  draft: Record<string, unknown>
  model: string
}

export interface AiSummaryRequest {
  plan_id: string
  phase?:  Phase
}

export interface AiSummaryResponse {
  summary: string
  model:   string
}

// AI-generated candidate link (POST /api/v1/ai/suggest-links). Read-only —
// nothing is persisted until the caller separately POSTs to
// /api/v1/activities/{id}/links with link_type: 'ai_suggested' to accept one.
export interface AiSuggestLinksRequest {
  plan_id: string
}

export interface AiLinkSuggestion {
  source_id:    string
  target_id:    string
  source_title: string
  target_title: string
  source_type:  string
  target_type:  string
  reason:       string
}

export interface AiSuggestLinksResponse {
  suggestions: AiLinkSuggestion[]
  model:       string
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'plan.created'    | 'plan.updated'    | 'plan.archived'
  | 'plan.deleted'    | 'plan.duplicated'
  | 'activity.created'| 'activity.updated'| 'activity.deleted'
  | 'activity.status_changed'
  | 'link.created'    | 'link.deleted'
  | 'user.invited'    | 'user.role_changed'
  | 'user.deactivated'| 'user.reactivated'
  | 'invitation.cancelled' | 'invitation.resent' | 'invitation.accepted'
  | 'report.generated'

export interface AuditLog {
  id:           string
  org_id:       string
  user_id:      string
  /** Denormalised by the Go service for display. Not populated for every
   *  action type (e.g. invitation.accepted) — guard before use. */
  user_name?:   string
  user_email?:  string
  action:       AuditAction
  table_name:   string
  record_id:    string
  /** Denormalised for display. Not populated for every action type — guard
   *  before use (see user_name above). */
  record_label?: string
  diff?:        Record<string, { from: unknown; to: unknown }>
  created_at:   string
}

// ── API list responses ────────────────────────────────────────────────────────

export interface AuditListResponse {
  logs:   AuditLog[]
  total:  number
  offset: number
  limit:  number
}

export interface ReportJobStatus {
  status:   'processing' | 'complete' | 'failed'
  file_url?: string
  report?:  Report
}

//Local plan types (from types/localPlanSections.ts) — add these to types/index.ts alongside the existing Plan, StrategicPillar, StrategicObjective types. Plan itself gains two optional fields (vision, mission) — add them to the existing Plan interface rather than here:
export interface CoreValue {
  id: string
  plan_id: string
  org_id: string
  name: string
  description?: string
  user_order: number
  created_at: string
  updated_at: string
}

export type StakeholderLevel = 'high' | 'low'

export interface Stakeholder {
  id: string
  plan_id: string
  org_id: string
  name: string
  influence: StakeholderLevel
  interest: StakeholderLevel
  notes?: string
  user_order: number
  created_at: string
  updated_at: string
}

export type SWOTCategory = 'strength' | 'weakness' | 'opportunity' | 'threat'

export interface SWOTItem {
  id: string
  plan_id: string
  org_id: string
  category: SWOTCategory
  text: string
  user_order: number
  created_at: string
  updated_at: string
}

export type PESTELFactor =
  | 'political' | 'economic' | 'social' | 'technological' | 'environmental' | 'legal'

export interface PESTELItem {
  id: string
  plan_id: string
  org_id: string
  factor: PESTELFactor
  implication?: string
  positive?: string
  negative?: string
  user_order: number
  created_at: string
  updated_at: string
}

export interface OrgStructureRole {
  id: string
  plan_id: string
  org_id: string
  title: string
  description?: string
  reports_to_id?: string
  user_order: number
  created_at: string
  updated_at: string
}

export type MECategory =
  | 'objective' | 'critical_success_factor' | 'review_note' | 'conclusion_measure'

export interface MEItem {
  id: string
  plan_id: string
  org_id: string
  category: MECategory
  text: string
  user_order: number
  created_at: string
  updated_at: string
}