/**
 * api/realEndpoints.ts — typed wrappers around every live backend route.
 *
 * Route map (from internal/handlers/router.go):
 *
 * PUBLIC (no Bearer token)
 *   POST  /auth/login                           → authApi.login
 *   POST  /auth/refresh                         → authApi.refresh
 *   POST  /auth/logout                          → authApi.logout
 *   POST  /auth/password-reset/request          → authApi.requestPasswordReset
 *   POST  /auth/password-reset/confirm          → authApi.confirmPasswordReset
 *   GET   /auth/saml/{orgSlug}/metadata         → ssoApi.samlMetadata (redirect only)
 *   POST  /auth/saml/{orgSlug}/acs              → handled by browser redirect
 *   GET   /auth/oidc/{orgSlug}/login            → ssoApi.oidcLogin (redirect only)
 *   GET   /auth/oidc/{orgSlug}/callback         → handled by browser redirect
 *
 * PUBLIC — under /api/v1 (no Bearer token, but namespaced to avoid
 * colliding with the SPA's own page routes — see /invitations/accept below)
 *   POST  /api/v1/invitations/accept            → invitationsApi.accept
 *
 * AUTHENTICATED — Org admin
 *   GET   /api/v1/org                            → orgApi.getOrg
 *   PATCH /api/v1/org                            → orgApi.updateOrg
 *   GET   /api/v1/org/users                     → orgApi.listUsers
 *   PATCH /api/v1/org/users/{userID}            → orgApi.updateUser
 *   GET   /api/v1/org/invitations               → orgApi.listInvitations
 *   POST  /api/v1/org/invitations               → orgApi.sendInvitation
 *   DELETE /api/v1/org/invitations/{id}         → orgApi.cancelInvitation
 *   POST  /api/v1/org/invitations/{id}/resend   → orgApi.resendInvitation
 *   GET   /api/v1/org/sso                       → ssoApi.getConfig
 *   PUT   /api/v1/org/sso                       → ssoApi.upsertConfig
 *   DELETE /api/v1/org/sso                      → ssoApi.deleteConfig
 *
 * AUTHENTICATED — Super admin / Platform support
 *   GET   /api/v1/admin/orgs                    → adminApi.listOrgs
 *   POST  /api/v1/admin/orgs                    → adminApi.createOrg
 *   PATCH /api/v1/admin/orgs/{orgID}            → adminApi.updateOrg
 *   POST  /api/v1/admin/org-invitations         → adminApi.sendOrgInvitation
 *
 * AUTHENTICATED — Plans (role-gated per route)
 *   GET   /api/v1/plans                         → plansApi.list
 *   POST  /api/v1/plans                         → plansApi.create  (planner+)
 *   GET   /api/v1/plans/{planID}                → plansApi.get
 *   PUT   /api/v1/plans/{planID}                → plansApi.update  (planner+)
 *   DELETE /api/v1/plans/{planID}               → plansApi.delete  (org_admin)
 *   POST  /api/v1/plans/{planID}/duplicate      → plansApi.duplicate (planner+)
 *   GET   /api/v1/plans/{planID}/progress       → plansApi.progress
 *   GET   /api/v1/plans/{planID}/activities     → activitiesApi.list
 *   POST  /api/v1/plans/{planID}/activities     → activitiesApi.create (planner+)
 *   GET   /api/v1/plans/{planID}/links          → activitiesApi.listLinks
 *   GET   /api/v1/plans/{planID}/auto-links     → activitiesApi.listAutoLinks
 *   POST  /api/v1/plans/{planID}/viewers        → plansApi.grantViewer (org_admin)
 *   DELETE /api/v1/plans/{planID}/viewers/{uid} → plansApi.revokeViewer (org_admin)
 *   GET   /api/v1/plans/{planID}/milestones     → milestonesApi.list
 *   POST  /api/v1/plans/{planID}/milestones     → milestonesApi.create (planner+)
 *   POST  /api/v1/plans/{planID}/reports        → reportsApi.generate  (planner+)
 *
 * AUTHENTICATED — Activities
 *   GET   /api/v1/activities/{activityID}             (via list, no standalone GET)
 *   PUT   /api/v1/activities/{activityID}             → activitiesApi.update
 *   DELETE /api/v1/activities/{activityID}            → activitiesApi.delete (planner+)
 *   POST  /api/v1/activities/{activityID}/links       → activitiesApi.createLink
 *   GET   /api/v1/activities/{activityID}/links       → activitiesApi.listActivityLinks
 *   DELETE /api/v1/activities/{activityID}/links/{linkID} → activitiesApi.deleteLink (planner+)
 *
 * AUTHENTICATED — Milestones
 *   PUT   /api/v1/milestones/{milestoneID}            → milestonesApi.update (planner+)
 *   DELETE /api/v1/milestones/{milestoneID}           → milestonesApi.delete (org_admin)
 *
 * AUTHENTICATED — AI (Sprint C, Ollama-backed)
 *   POST  /api/v1/ai/draft                      → aiApi.draft
 *   POST  /api/v1/ai/summary                    → aiApi.summary
 *   POST  /api/v1/ai/suggest-links               → aiApi.suggestLinks
 *
 * AUTHENTICATED — Reports (polling)
 *   GET   /api/v1/reports/{jobID}               → reportsApi.poll
 *   GET   /api/v1/plans/{planID}/reports        → reportsApi.history
 *
 * AUTHENTICATED — Org audit log
 *   GET   /api/v1/org/audit-log                 → auditApi.list
 */

import apiClient from './client'
import type {
  AuthTokens, LoginPayload,
  Plan, PlanProgress, PlanType,
  Activity, ActivityLink,
  StrategicPillar, StrategicObjective, KPI,
  AiDraftRequest, AiDraftResponse, AiSummaryRequest, AiSummaryResponse,
  AiSuggestLinksRequest, AiSuggestLinksResponse,
  Invitation, Organisation, OrgProfileUpdate,
  Report, ReportType, ReportFormat, ReportJobStatus, ReportSectionConfig,
  User, UserRole,
  AuditLog, AuditListResponse,
  Milestone, MilestoneStatus,
  SSOConfig,
} from '../types'

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  /** POST /auth/login — public, no Bearer token */
  login: (payload: LoginPayload) =>
    apiClient.post<AuthTokens>('/auth/login', payload, { baseURL: '/' }).then((r) => r.data),

  /** POST /auth/refresh — public. Uses plain axios via the interceptor. */
  refresh: (refreshToken: string) =>
    apiClient.post<AuthTokens>('/auth/refresh', { refresh_token: refreshToken }, { baseURL: '/' }).then((r) => r.data),

  /** POST /auth/logout */
  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refresh_token: refreshToken }, { baseURL: '/' }).then(() => undefined as void),

  /** POST /auth/password-reset/request */
  requestPasswordReset: (email: string) =>
    apiClient.post('/auth/password-reset/request', { email }, { baseURL: '/' }).then(() => undefined as void),

  /** POST /auth/password-reset/confirm */
  confirmPasswordReset: (token: string, password: string) =>
    apiClient.post('/auth/password-reset/confirm', { token, password }, { baseURL: '/' }).then(() => undefined as void),
}

// ── Invitations (public) ──────────────────────────────────────────────────────

export const invitationsApi = {
  /**
   * POST /api/v1/invitations/accept — public, no Bearer required.
   * Namespaced under /api/v1 (apiClient's default baseURL, so no override
   * needed here) to avoid colliding with the SPA's own /invitations/accept
   * page route — a bare /invitations/accept proxy rule can't tell "GET the
   * page" apart from "POST to the API" at the same path.
   */
  accept: (payload: { token: string; name: string; password: string }) =>
    apiClient.post<AuthTokens>('/invitations/accept', payload).then((r) => r.data),
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export const plansApi = {
  /** GET /api/v1/plans — returns plans with progress already embedded via JOIN */
  list: () =>
    apiClient.get<Plan[]>('/plans').then((r) => r.data),

  /** GET /api/v1/plans/{planID} */
  get: (id: string) =>
    apiClient.get<Plan>(`/plans/${id}`).then((r) => r.data),

  /**
   * POST /api/v1/plans — requires planner or org_admin.
   * plan_type is optional and defaults server-side to 'international' —
   * omit it entirely to get the pre-existing (fixed P1/P2/P3) behaviour.
   */
  create: (payload: {
    title:        string
    description?: string
    plan_type?:   PlanType
    start_date?:  string
    end_date?:    string
  }) => apiClient.post<Plan>('/plans', payload).then((r) => r.data),

  /** PUT /api/v1/plans/{planID} — requires planner or org_admin */
  update: (id: string, payload: Partial<Pick<Plan,
    'title' | 'description' | 'status' | 'start_date' | 'end_date'
  >>) => apiClient.put<Plan>(`/plans/${id}`, payload).then((r) => r.data),

  /** DELETE /api/v1/plans/{planID} — soft delete, requires org_admin */
  delete: (id: string) =>
    apiClient.delete(`/plans/${id}`).then(() => undefined as void),

  /**
   * POST /api/v1/plans/{planID}/duplicate — requires planner or org_admin.
   * NOTE: not yet wired in router.go (marked notImplemented). Will return 501
   * until Sprint C. The frontend should handle 501 gracefully.
   */
  duplicate: (id: string) =>
    apiClient.post<Plan>(`/plans/${id}/duplicate`).then((r) => r.data),

  /** GET /api/v1/plans/{planID}/progress */
  progress: (id: string) =>
    apiClient.get<PlanProgress>(`/plans/${id}/progress`).then((r) => r.data),

  /** POST /api/v1/plans/{planID}/viewers — requires org_admin */
  grantViewer: (planId: string, userId: string) =>
    apiClient.post(`/plans/${planId}/viewers`, { user_id: userId }).then(() => undefined as void),

  /** DELETE /api/v1/plans/{planID}/viewers/{userID} — requires org_admin */
  revokeViewer: (planId: string, userId: string) =>
    apiClient.delete(`/plans/${planId}/viewers/${userId}`).then(() => undefined as void),
}

// ── Activities ────────────────────────────────────────────────────────────────

export const activitiesApi = {
  /**
   * GET /api/v1/plans/{planID}/activities
   * Optional filters: phase=P1|P2|P3 (international plans),
   * objective_id=<uuid> (local plans), status=not_started|in_progress|…
   */
  list: (planId: string, params?: { phase?: string; objective_id?: string; status?: string }) =>
    apiClient.get<Activity[]>(`/plans/${planId}/activities`, { params }).then((r) => r.data),

  /**
   * No standalone GET /activities/{id} in the router.
   * Fetch by calling list() and filtering client-side, or add a dedicated
   * backend route in a future sprint.
   */
  get: (planId: string, activityId: string) =>
    activitiesApi.list(planId).then((acts) => {
      const found = acts.find((a) => a.id === activityId)
      if (!found) throw new Error(`Activity ${activityId} not found in plan ${planId}`)
      return found
    }),

  /**
   * POST /api/v1/plans/{planID}/activities — requires planner or org_admin.
   * Exactly one of phase / objective_id must be sent, matching the target
   * plan's plan_type: phase for 'international', objective_id for 'local'.
   * budget/responsibility/target_period/kpis are only meaningful (and only
   * accepted by the backend) for local-plan activities.
   */
  create: (planId: string, payload: {
    phase?:          string
    objective_id?:   string
    type:            string
    title:           string
    status?:         string
    content?:        Record<string, unknown>
    assigned_to?:    string[]
    due_date?:       string
    budget?:         number
    responsibility?: string
    target_period?:  string
    kpis?:           KPI[]
  }) => apiClient.post<Activity>(`/plans/${planId}/activities`, payload).then((r) => r.data),

  /**
   * PUT /api/v1/activities/{activityID}
   * Contributors may only update activities assigned to them (enforced server-side).
   */
  update: (activityId: string, payload: Partial<Pick<Activity,
    'title' | 'status' | 'content' | 'assigned_to' | 'due_date' | 'user_order'
    | 'budget' | 'responsibility' | 'target_period' | 'kpis'
  >>) => apiClient.put<Activity>(`/activities/${activityId}`, payload).then((r) => r.data),

  /**
   * DELETE /api/v1/activities/{activityID} — requires planner or org_admin.
   * Soft-deletes the activity and cascades cleanup of any activity_links
   * that reference it (handled server-side — see plansvc.DeleteActivity).
   */
  delete: (activityId: string): Promise<void> =>
    apiClient.delete(`/activities/${activityId}`).then(() => undefined),

  /** POST /api/v1/activities/{activityID}/links */
  createLink: (activityId: string, payload: {
    target_id:  string
    link_type?: ActivityLink['link_type']
  }) => apiClient.post<ActivityLink>(`/activities/${activityId}/links`, payload).then((r) => r.data),

  /** GET /api/v1/activities/{activityID}/links */
  listActivityLinks: (activityId: string) =>
    apiClient.get<ActivityLink[]>(`/activities/${activityId}/links`).then((r) => r.data),

  /** GET /api/v1/plans/{planID}/links — all links for a plan */
  listLinks: (planId: string) =>
    apiClient.get<ActivityLink[]>(`/plans/${planId}/links`).then((r) => r.data),

  /**
   * GET /api/v1/plans/{planID}/auto-links
   * Returns candidate links suggested by the server but not yet created.
   */
  listAutoLinks: (planId: string) =>
    apiClient.get<ActivityLink[]>(`/plans/${planId}/auto-links`).then((r) => r.data),

  /** DELETE /api/v1/activities/{activityID}/links/{linkID} — requires planner or org_admin */
  deleteLink: (activityId: string, linkId: string): Promise<void> =>
    apiClient.delete(`/activities/${activityId}/links/${linkId}`).then(() => undefined),
}

// ── Strategic pillars / objectives (local plans only) ──────────────────────

export const pillarsApi = {
  /** GET /api/v1/plans/{planID}/pillars */
  list: (planId: string) =>
    apiClient.get<StrategicPillar[]>(`/plans/${planId}/pillars`).then((r) => r.data),

  /** POST /api/v1/plans/{planID}/pillars — requires planner or org_admin */
  create: (planId: string, payload: { title: string }) =>
    apiClient.post<StrategicPillar>(`/plans/${planId}/pillars`, payload).then((r) => r.data),

  /** PUT /api/v1/pillars/{pillarID} — requires planner or org_admin */
  update: (pillarId: string, payload: Partial<Pick<StrategicPillar, 'title' | 'user_order'>>) =>
    apiClient.put<StrategicPillar>(`/pillars/${pillarId}`, payload).then((r) => r.data),

  /** DELETE /api/v1/pillars/{pillarID} — requires planner or org_admin. Fails if it still has objectives. */
  delete: (pillarId: string) =>
    apiClient.delete(`/pillars/${pillarId}`).then(() => undefined as void),

  /** GET /api/v1/plans/{planID}/objectives — all objectives across all pillars in the plan */
  listObjectives: (planId: string) =>
    apiClient.get<StrategicObjective[]>(`/plans/${planId}/objectives`).then((r) => r.data),

  /** POST /api/v1/pillars/{pillarID}/objectives — requires planner or org_admin */
  createObjective: (pillarId: string, payload: { title: string }) =>
    apiClient.post<StrategicObjective>(`/pillars/${pillarId}/objectives`, payload).then((r) => r.data),

  /** PUT /api/v1/objectives/{objectiveID} — requires planner or org_admin */
  updateObjective: (objectiveId: string, payload: Partial<Pick<StrategicObjective, 'title' | 'user_order'>>) =>
    apiClient.put<StrategicObjective>(`/objectives/${objectiveId}`, payload).then((r) => r.data),

  /** DELETE /api/v1/objectives/{objectiveID} — requires planner or org_admin. Fails if it still has activities. */
  deleteObjective: (objectiveId: string) =>
    apiClient.delete(`/objectives/${objectiveId}`).then(() => undefined as void),
}

// ── Milestones ────────────────────────────────────────────────────────────────

export const milestonesApi = {
  /** GET /api/v1/plans/{planID}/milestones */
  list: (planId: string) =>
    apiClient.get<Milestone[]>(`/plans/${planId}/milestones`).then((r) => r.data),

  /** POST /api/v1/plans/{planID}/milestones — requires planner or org_admin */
  create: (planId: string, payload: {
    title:               string
    due_date:            string
    status?:             MilestoneStatus
    linked_activity_id?: string
  }) => apiClient.post<Milestone>(`/plans/${planId}/milestones`, payload).then((r) => r.data),

  /** PUT /api/v1/milestones/{milestoneID} — requires planner or org_admin */
  update: (milestoneId: string, payload: Partial<Pick<Milestone,
    'title' | 'due_date' | 'status' | 'linked_activity_id'
  >>) => apiClient.put<Milestone>(`/milestones/${milestoneId}`, payload).then((r) => r.data),

  /** DELETE /api/v1/milestones/{milestoneID} — requires org_admin */
  delete: (milestoneId: string) =>
    apiClient.delete(`/milestones/${milestoneId}`).then(() => undefined as void),
}

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsApi = {
  /**
   * POST /api/v1/plans/{planID}/reports — requires planner or org_admin.
   * Starts an async job; poll reportsApi.poll(jobId) for completion.
   */
  generate: (planId: string, payload: {
    type:         ReportType
    format:       ReportFormat
    date_range?:  { from: string; to: string }
    /** Required (and only used) when type === 'custom' */
    sections?:    ReportSectionConfig
  }) => apiClient.post<{ job_id: string }>(`/plans/${planId}/reports`, payload).then((r) => r.data),

  /**
   * GET /api/v1/reports/{jobID}
   * Returns { status, file_url?, report? }. Poll until status === 'complete'.
   */
  poll: (jobId: string) =>
    apiClient.get<ReportJobStatus>(`/reports/${jobId}`, { baseURL: '/api/v1' }).then((r) => r.data),

  /** GET /api/v1/plans/{planID}/reports — history of completed reports */
  history: (planId: string) =>
    apiClient.get<Report[]>(`/plans/${planId}/reports`).then((r) => r.data),

  /**
   * GET /api/v1/reports/{jobID}/download
   * Fetched as a blob (rather than a plain <a href>) so the request goes
   * through apiClient and carries the Authorization header — the download
   * route is behind the same auth middleware as everything else, and a
   * bare anchor tag has no way to attach a Bearer token.
   */
  download: (jobId: string) =>
    apiClient.get<Blob>(`/reports/${jobId}/download`, { baseURL: '/api/v1', responseType: 'blob' }).then((r) => r.data),
}

// ── AI ────────────────────────────────────────────────────────────────────────
// Both routes return 501 until Sprint C implements them.
// The frontend should catch errors and display "AI unavailable" gracefully.

export const aiApi = {
  /** POST /api/v1/ai/draft — requires planner or org_admin */
  draft: (payload: AiDraftRequest) =>
    apiClient.post<AiDraftResponse>('/ai/draft', payload).then((r) => r.data),

  /** POST /api/v1/ai/summary — requires planner or org_admin */
  summary: (payload: AiSummaryRequest) =>
    apiClient.post<AiSummaryResponse>('/ai/summary', payload).then((r) => r.data),

  /**
   * POST /api/v1/ai/suggest-links — requires planner or org_admin.
   * Read-only: returns candidate links for the caller to review. Accepting
   * one is a separate activitiesApi.createLink(..., { link_type:
   * 'ai_suggested' }) call — this endpoint never writes to activity_links.
   */
  suggestLinks: (payload: AiSuggestLinksRequest) =>
    apiClient.post<AiSuggestLinksResponse>('/ai/suggest-links', payload).then((r) => r.data),
}

// ── Org / Users ───────────────────────────────────────────────────────────────

export const orgApi = {
  /** GET /api/v1/org — the caller's own organisation, no role gate */
  getOrg: () =>
    apiClient.get<Organisation>('/org').then((r) => r.data),

  /**
   * PATCH /api/v1/org — requires org_admin. Self-service profile fields
   * (address, country, contact info, industry, org structure, member
   * count) — folded into AI draft/summary/suggest-links prompts on the
   * backend so results are grounded in what the org actually is.
   */
  updateOrg: (payload: OrgProfileUpdate) =>
    apiClient.patch<Organisation>('/org', payload).then((r) => r.data),

  /** GET /api/v1/org/users — requires org_admin */
  listUsers: () =>
    apiClient.get<User[]>('/org/users').then((r) => r.data),

  /** PATCH /api/v1/org/users/{userID} — requires org_admin */
  updateUser: (userId: string, payload: { role?: UserRole; is_active?: boolean }) =>
    apiClient.patch<User>(`/org/users/${userId}`, payload).then((r) => r.data),

  /** GET /api/v1/org/invitations — requires org_admin */
  listInvitations: () =>
    apiClient.get<Invitation[]>('/org/invitations').then((r) => r.data),

  /** POST /api/v1/org/invitations — requires org_admin */
  sendInvitation: (payload: {
    email:     string
    role:      UserRole
    plan_ids?: string[]  // for plan-scoped viewer invites
  }) => apiClient.post<Invitation>('/org/invitations', payload).then((r) => r.data),

  /** DELETE /api/v1/org/invitations/{invitationID} — requires org_admin */
  cancelInvitation: (invitationId: string) =>
    apiClient.delete(`/org/invitations/${invitationId}`).then(() => undefined as void),

  /** POST /api/v1/org/invitations/{invitationID}/resend — requires org_admin */
  resendInvitation: (invitationId: string) =>
    apiClient.post(`/org/invitations/${invitationId}/resend`).then(() => undefined as void),
}

// ── SSO config ────────────────────────────────────────────────────────────────

export const ssoApi = {
  /** GET /api/v1/org/sso — requires org_admin. 404 if no SSO configured. */
  getConfig: () =>
    apiClient.get<SSOConfig>('/org/sso').then((r) => r.data),

  /** PUT /api/v1/org/sso — upsert, requires org_admin */
  upsertConfig: (payload: Partial<SSOConfig>) =>
    apiClient.put<SSOConfig>('/org/sso', payload).then((r) => r.data),

  /** DELETE /api/v1/org/sso — removes SSO, re-enables local login */
  deleteConfig: () =>
    apiClient.delete('/org/sso').then(() => undefined as void),

  /**
   * SSO login entry points — these are plain browser redirects, not Axios calls.
   * Call window.location.href = ssoApi.samlLoginUrl(slug) to initiate.
   */
  samlMetadataUrl:  (orgSlug: string) => `/auth/saml/${orgSlug}/metadata`,
  oidcLoginUrl:     (orgSlug: string) => `/auth/oidc/${orgSlug}/login`,
}

// ── Super Admin ───────────────────────────────────────────────────────────────

export const adminApi = {
  /** GET /api/v1/admin/orgs — super_admin or platform_support */
  listOrgs: (params?: { active_only?: boolean; limit?: number; offset?: number }) =>
    apiClient.get<Organisation[]>('/admin/orgs', { params }).then((r) => r.data),

  /**
   * POST /api/v1/admin/orgs — super_admin only.
   * admin_email is optional — if set, invites that org's first admin in the
   * same call instead of requiring a separate sendOrgInvitation call.
   */
  createOrg: (payload: { name: string; locale?: string; industry?: string; admin_email?: string }) =>
    apiClient.post<Organisation>('/admin/orgs', payload).then((r) => r.data),

  // add — cross-org audit log
  listAuditLog: (params?: {
    org_id?: string; user_id?: string; action?: string; table_name?: string
    from?: string; to?: string; limit?: number; offset?: number
  }) => apiClient.get<AuditListResponse>('/admin/audit-log', { params }).then((r) => r.data),

  /** PATCH /api/v1/admin/orgs/{orgID} — super_admin only */
  updateOrg: (orgId: string, payload: { is_active: boolean }) =>
    apiClient.patch<Organisation>(`/admin/orgs/${orgId}`, payload).then((r) => r.data),

  /**
   * POST /api/v1/admin/org-invitations — super_admin only.
   * Invites an org_admin for an *existing* organisation — org_id must
   * reference a real org (create one first via createOrg). This no longer
   * creates an organisation from typed text.
   */
  sendOrgInvitation: (payload: { email: string; org_id: string }) =>
    apiClient.post<Invitation>('/admin/org-invitations', payload).then((r) => r.data),

  listPlatformUsers: () =>
    apiClient.get<User[]>('/admin/platform-users').then((r) => r.data),
  listPlatformInvitations: () =>
    apiClient.get<Invitation[]>('/admin/platform-users/invitations').then((r) => r.data),
  invitePlatformUser: (payload: { email: string; role: UserRole }) =>
    apiClient.post<Invitation>('/admin/platform-users/invitations', payload).then((r) => r.data),
  cancelPlatformInvitation: (id: string) =>
    apiClient.delete(`/admin/platform-users/invitations/${id}`).then(() => undefined),
  resendPlatformInvitation: (id: string) =>
    apiClient.post(`/admin/platform-users/invitations/${id}/resend`).then(() => undefined),
  updatePlatformUser: (id: string, payload: { role?: UserRole; is_active?: boolean }) =>
    apiClient.patch<User>(`/admin/platform-users/${id}`, payload).then((r) => r.data),
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export const auditApi = {
  /**
   * GET /api/v1/org/audit-log — requires org_admin.
   *
   * NOTE: this route is NOT in the current router.go. It needs to be added to
   * the /api/v1/org group in the backend. Until then, calls will return 404.
   * Tracked as: TODO — add GET /api/v1/org/audit-log to router.go.
   */
  list: (params?: {
    user_id?:    string
    action?:     string
    table_name?: string
    from?:       string
    to?:         string
    limit?:      number
    offset?:     number
  }) => apiClient.get<AuditListResponse>('/org/audit-log', { params }).then((r) => r.data),
}