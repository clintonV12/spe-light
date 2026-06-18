// ─── Enums ─────────────────────────────────────────────────────────────────

export type Phase = 'P1' | 'P2' | 'P3'

export type UserRole =
  | 'super_admin'
  | 'platform_support'
  | 'org_admin'
  | 'planner'
  | 'contributor'
  | 'viewer'

export type PlanStatus = 'draft' | 'active' | 'review' | 'completed' | 'archived'

export type ActivityStatus = 'not_started' | 'in_progress' | 'under_review' | 'complete'

export type ActivityType =
  // P1
  | 'swot'
  | 'pestle'
  | 'business_model_canvas'
  | 'stakeholder_map'
  | 'competitive_analysis'
  | 'risk_register'
  | 'market_analysis'
  // P2
  | 'vision_mission'
  | 'strategic_objectives'
  | 'kpi_framework'
  | 'okr_balanced_scorecard'
  | 'theory_of_change'
  | 'value_proposition'
  | 'strategic_initiatives'
  // P3
  | 'financial_projections'
  | 'budget_allocation'
  | 'operational_roadmap'
  | 'resource_plan'
  | 'action_items'
  | 'implementation_timeline'
  | 'procurement_plan'
  // Fallback for custom types
  | string

export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired'

export type LinkType = 'auto' | 'manual' | 'ai_suggested'

export type ReportType =
  | 'full_plan'
  | 'per_phase'
  | 'executive_summary'
  | 'progress_status'
  | 'activity_detail'

export type ReportFormat = 'pdf' | 'docx' | 'xlsx'

// ─── Entities ──────────────────────────────────────────────────────────────

export interface Organisation {
  id: string
  name: string
  slug: string
  logo_url?: string
  locale: string
  industry?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  org_id: string
  email: string
  name: string
  role: UserRole
  locale?: string
  is_active: boolean
  /**
   * Plan-scoped access grant — mirrors the `plan_viewers` table.
   * - `undefined` or empty array: role-based default (org_admin/planner/
   *   contributor see all org plans they're otherwise permitted to see).
   * - Non-empty array: this user can ONLY see these specific plan IDs,
   *   regardless of role. Primarily used for `viewer` accounts invited
   *   with `plan_ids` set, but the field is generic so any role can be
   *   scoped this way (e.g. a contractor contributor restricted to one
   *   engagement).
   * This must be enforced server-side once real auth lands (Postgres RLS
   * per the SRS) — the frontend never filters by this itself, it only
   * ever renders what the API returns.
   */
  plan_ids?: string[]
  created_at: string
  updated_at: string
}

export interface Invitation {
  id: string
  org_id?: string
  email: string
  role: UserRole
  invited_by: string
  expires_at: string
  accepted_at?: string
  status: InvitationStatus
  created_at: string
}

export interface Plan {
  id: string
  org_id: string
  title: string
  description?: string
  status: PlanStatus
  owner_id: string
  start_date?: string
  end_date?: string
  created_at: string
  updated_at: string
  // Computed / joined
  progress?: PlanProgress
}

export interface Activity {
  id: string
  plan_id: string
  org_id: string
  phase: Phase
  type: ActivityType
  title: string
  user_order: number
  status: ActivityStatus
  content: Record<string, unknown>
  ai_draft?: Record<string, unknown>
  assigned_to?: string[]
  due_date?: string
  created_at: string
  updated_at: string
}

export interface ActivityLink {
  id: string
  plan_id: string
  source_id: string
  target_id: string
  link_type: LinkType
  created_by: string
  created_at: string
}

export interface Milestone {
  id: string
  plan_id: string
  title: string
  due_date: string
  status: ActivityStatus
  linked_activity_id?: string
}

export interface Report {
  id: string
  plan_id: string
  org_id: string
  type: ReportType
  format: ReportFormat
  file_path?: string
  generated_by: string
  generated_at: string
}

export interface SyncQueueItem {
  id: string
  user_id: string
  operation: string
  payload: Record<string, unknown>
  created_at: string
  synced_at?: string
}

// ─── Progress ──────────────────────────────────────────────────────────────

export interface PhaseProgress {
  phase: Phase
  total: number
  complete: number
  in_progress: number
  overdue: number
  percent: number
}

export interface PlanProgress {
  overall_percent: number
  phases: PhaseProgress[]
  overdue_count: number
  completeness_score?: number
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface AuthTokens {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface LoginPayload {
  email: string
  password: string
}

// ─── AI ────────────────────────────────────────────────────────────────────

export interface AiDraftRequest {
  plan_id: string
  activity_type: ActivityType
  keywords: string[]
  phase: Phase
}

export interface AiDraftResponse {
  draft: Record<string, unknown>
  model: string
}

export interface AiSummaryRequest {
  plan_id: string
  phase?: Phase
}

export interface AiSummaryResponse {
  summary: string
  model: string
}

// ─── API helpers ───────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
}

export interface ApiError {
  error: string
  code?: string
  details?: Record<string, string>
}
