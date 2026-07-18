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

export type Phase = 'P1' | 'P2' | 'P3'

export type ActivityStatus = 'not_started' | 'in_progress' | 'under_review' | 'complete'

export type ActivityLinkType = 'auto' | 'manual' | 'ai_suggested'

export type InviteStatus = 'pending' | 'accepted' | 'cancelled' | 'expired'

export type SSOProtocol = 'saml' | 'oidc'

export type MilestoneStatus = 'pending' | 'reached' | 'missed'

export type ReportType =
  | 'full_plan'
  | 'executive_summary'
  | 'per_phase'
  | 'progress_status'
  | 'activity_detail'

export type ReportFormat = 'pdf' | 'docx' | 'xlsx'

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
  created_at:  string
  updated_at:  string
  deleted_at?: string
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
}

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
}

// ── Plan progress ─────────────────────────────────────────────────────────────

export interface PhaseProgress {
  phase:       Phase
  total:       number
  complete:    number
  in_progress: number
  overdue:     number
  percent:     number
}

export interface PlanProgress {
  plan_id:         string
  overall_percent: number
  overdue_count:   number
  phases:          PhaseProgress[]
}

// ── Activity ──────────────────────────────────────────────────────────────────

export interface Activity {
  id:           string
  plan_id:      string
  org_id:       string
  phase:        Phase
  type:         string
  title:        string
  user_order:   number
  status:       ActivityStatus
  content:      Record<string, unknown>
  ai_draft?:    Record<string, unknown>
  assigned_to?: string[]
  due_date?:    string
  created_at:   string
  updated_at:   string
  deleted_at?:  string
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
}

// ── AI ────────────────────────────────────────────────────────────────────────

export interface AiDraftRequest {
  plan_id:       string
  activity_id:   string
  activity_type: string
  phase:         Phase
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
  user_name:    string     // denormalised by the Go service for display
  user_email:   string
  action:       AuditAction
  table_name:   string
  record_id:    string
  record_label: string     // denormalised for display
  diff:         Record<string, { from: unknown; to: unknown }>
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