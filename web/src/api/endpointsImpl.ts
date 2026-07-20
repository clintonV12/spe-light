/**
 * api/endpointsImpl.ts — single source of truth for all API calls.
 *
 * VITE_MOCK=true  → delegates to in-memory mock handlers (no network needed).
 * VITE_MOCK unset → delegates to realEndpoints (live Go backend via Axios).
 *
 * The `IS_MOCK` constant is evaluated at build time by Vite's dead-code
 * removal, so neither path leaks into the other production bundle.
 *
 * Adding a new endpoint:
 *   1. Add the backend route to internal/handlers/router.go
 *   2. Add the typed wrapper to realEndpoints.ts
 *   3. Add a mock implementation to mocks/handlers.ts
 *   4. Re-export it here
 */

import type {
  AuthTokens, LoginPayload,
  Plan, PlanProgress,
  Activity, ActivityLink,
  AiDraftRequest, AiSummaryRequest,
  Invitation, Organisation,
  Report, ReportType, ReportFormat, ReportJobStatus, ReportSectionConfig,
  User, UserRole,
  AuditListResponse,
  Milestone, MilestoneStatus,
  SSOConfig,
} from '../types'

const IS_MOCK = import.meta.env.VITE_MOCK === 'true'

// ── Lazy singletons — loaded once, then cached ────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _real: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mock: any = null

async function real() {
  if (!_real) _real = await import('./realEndpoints')
  return _real
}
async function mock() {
  if (!_mock) _mock = await import('../mocks/mockEndpoints')
  return _mock
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (): Promise<any> => (IS_MOCK ? mock() : real())

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login:                (p: LoginPayload) => api().then((m) => m.authApi.login(p))                    as Promise<AuthTokens>,
  refresh:              (token: string)   => api().then((m) => m.authApi.refresh(token))               as Promise<AuthTokens>,
  logout:               (token: string)   => api().then((m) => m.authApi.logout(token))                as Promise<void>,
  requestPasswordReset: (email: string)   => api().then((m) => m.authApi.requestPasswordReset(email))  as Promise<void>,
  confirmPasswordReset: (token: string, password: string) =>
    api().then((m) => m.authApi.confirmPasswordReset(token, password)) as Promise<void>,
}

// ── Invitations (public) ──────────────────────────────────────────────────────

export const invitationsApi = {
  accept: (p: { token: string; name: string; password: string }) =>
    api().then((m) => m.invitationsApi.accept(p)) as Promise<AuthTokens>,
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export const plansApi = {
  list:         ()                          => api().then((m) => m.plansApi.list())              as Promise<Plan[]>,
  get:          (id: string)                => api().then((m) => m.plansApi.get(id))             as Promise<Plan>,
  create:       (p: Partial<Plan>)          => api().then((m) => m.plansApi.create(p))           as Promise<Plan>,
  update:       (id: string, p: Partial<Plan>) => api().then((m) => m.plansApi.update(id, p))   as Promise<Plan>,
  delete:       (id: string)                => api().then((m) => m.plansApi.delete(id))          as Promise<void>,
  duplicate:    (id: string)                => api().then((m) => m.plansApi.duplicate(id))       as Promise<Plan>,
  progress:     (id: string)                => api().then((m) => m.plansApi.progress(id))        as Promise<PlanProgress>,
  grantViewer:  (planId: string, userId: string) => api().then((m) => m.plansApi.grantViewer(planId, userId))  as Promise<void>,
  revokeViewer: (planId: string, userId: string) => api().then((m) => m.plansApi.revokeViewer(planId, userId)) as Promise<void>,
}

// ── Activities ────────────────────────────────────────────────────────────────

export const activitiesApi = {
  list:              (planId: string, params?: { phase?: string; status?: string }) =>
                       api().then((m) => m.activitiesApi.list(planId, params))                   as Promise<Activity[]>,
  get:               (planId: string, activityId: string) =>
                       api().then((m) => m.activitiesApi.get(planId, activityId))                as Promise<Activity>,
  create:            (planId: string, p: Partial<Activity>) =>
                       api().then((m) => m.activitiesApi.create(planId, p))                      as Promise<Activity>,
  update:            (id: string, p: Partial<Activity>) =>
                       api().then((m) => m.activitiesApi.update(id, p))                          as Promise<Activity>,
  delete:            (id: string) => api().then((m) => m.activitiesApi.delete(id))               as Promise<void>,
  createLink:        (id: string, p: Partial<ActivityLink>) =>
                       api().then((m) => m.activitiesApi.createLink(id, p))                      as Promise<ActivityLink>,
  listActivityLinks: (activityId: string) =>
                       api().then((m) => m.activitiesApi.listActivityLinks(activityId))          as Promise<ActivityLink[]>,
  listLinks:         (planId: string) =>
                       api().then((m) => m.activitiesApi.listLinks(planId))                      as Promise<ActivityLink[]>,
  listAutoLinks:     (planId: string) =>
                       api().then((m) => m.activitiesApi.listAutoLinks(planId))                  as Promise<ActivityLink[]>,
  deleteLink:        (actId: string, linkId: string) =>
                       api().then((m) => m.activitiesApi.deleteLink(actId, linkId))              as Promise<void>,
}

// ── Milestones ────────────────────────────────────────────────────────────────

export const milestonesApi = {
  list:   (planId: string)                        => api().then((m) => m.milestonesApi.list(planId))            as Promise<Milestone[]>,
  create: (planId: string, p: Partial<Milestone>) => api().then((m) => m.milestonesApi.create(planId, p))      as Promise<Milestone>,
  update: (id: string, p: Partial<Milestone>)     => api().then((m) => m.milestonesApi.update(id, p))          as Promise<Milestone>,
  delete: (id: string)                            => api().then((m) => m.milestonesApi.delete(id))              as Promise<void>,
}

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsApi = {
  generate: (planId: string, p: {
              type: ReportType
              format: ReportFormat
              date_range?: { from: string; to: string }
              /** Required (and only used) when type === 'custom' */
              sections?: ReportSectionConfig
            }) =>
              api().then((m) => m.reportsApi.generate(planId, p))  as Promise<{ job_id: string }>,
  poll:     (jobId: string)  => api().then((m) => m.reportsApi.poll(jobId))     as Promise<ReportJobStatus>,
  history:  (planId: string) => api().then((m) => m.reportsApi.history(planId)) as Promise<Report[]>,
  download: (jobId: string)  => api().then((m) => m.reportsApi.download(jobId)) as Promise<Blob>,
}

// ── AI ────────────────────────────────────────────────────────────────────────

export const aiApi = {
  draft:   (p: AiDraftRequest)   => api().then((m) => m.aiApi.draft(p))   as Promise<{ draft: Record<string, unknown>; model: string }>,
  summary: (p: AiSummaryRequest) => api().then((m) => m.aiApi.summary(p)) as Promise<{ summary: string; model: string }>,
}

// ── Org / Users ───────────────────────────────────────────────────────────────

export const orgApi = {
  listUsers:        ()                                              => api().then((m) => m.orgApi.listUsers())                as Promise<User[]>,
  updateUser:       (id: string, p: { role?: UserRole; is_active?: boolean }) =>
                      api().then((m) => m.orgApi.updateUser(id, p))                                                           as Promise<User>,
  listInvitations:  ()                                              => api().then((m) => m.orgApi.listInvitations())          as Promise<Invitation[]>,
  sendInvitation:   (p: { email: string; role: UserRole; plan_ids?: string[] }) =>
                      api().then((m) => m.orgApi.sendInvitation(p))                                                           as Promise<Invitation>,
  cancelInvitation: (id: string)                                    => api().then((m) => m.orgApi.cancelInvitation(id))       as Promise<void>,
  resendInvitation: (id: string)                                    => api().then((m) => m.orgApi.resendInvitation(id))       as Promise<void>,
}

// ── SSO ───────────────────────────────────────────────────────────────────────

export const ssoApi = {
  getConfig:    ()                         => api().then((m) => m.ssoApi.getConfig())           as Promise<SSOConfig>,
  upsertConfig: (p: Partial<SSOConfig>)    => api().then((m) => m.ssoApi.upsertConfig(p))       as Promise<SSOConfig>,
  deleteConfig: ()                         => api().then((m) => m.ssoApi.deleteConfig())         as Promise<void>,
  samlMetadataUrl: (slug: string): string  => `/auth/saml/${slug}/metadata`,
  oidcLoginUrl:    (slug: string): string  => `/auth/oidc/${slug}/login`,
}

// ── Super Admin ───────────────────────────────────────────────────────────────

export const adminApi = {
  listOrgs:          (p?: { active_only?: boolean; limit?: number; offset?: number }) =>
                       api().then((m) => m.adminApi.listOrgs(p))                                 as Promise<Organisation[]>,
  createOrg:         (p: Partial<Organisation> & { admin_email?: string })            =>
                       api().then((m) => m.adminApi.createOrg(p))                                as Promise<Organisation>,
  updateOrg:         (id: string, p: { is_active: boolean }) =>
                       api().then((m) => m.adminApi.updateOrg(id, p))                            as Promise<Organisation>,
  sendOrgInvitation: (p: { email: string; org_id: string }) =>
                       api().then((m) => m.adminApi.sendOrgInvitation(p))                    as Promise<Invitation>,
  listAuditLog: (p?: { org_id?: string; user_id?: string; action?: string; table_name?: string; from?: string; to?: string; limit?: number; offset?: number }) =>
  api().then((m) => m.adminApi.listAuditLog(p)) as Promise<AuditListResponse>,
  listPlatformUsers:        () => api().then((m) => m.adminApi.listPlatformUsers())                as Promise<User[]>,
  listPlatformInvitations:  () => api().then((m) => m.adminApi.listPlatformInvitations())           as Promise<Invitation[]>,
  invitePlatformUser:       (p: { email: string; role: UserRole }) =>
                              api().then((m) => m.adminApi.invitePlatformUser(p))                    as Promise<Invitation>,
  cancelPlatformInvitation: (id: string) => api().then((m) => m.adminApi.cancelPlatformInvitation(id)) as Promise<void>,
  resendPlatformInvitation: (id: string) => api().then((m) => m.adminApi.resendPlatformInvitation(id)) as Promise<void>,
  updatePlatformUser:       (id: string, p: { role?: UserRole; is_active?: boolean }) =>
                              api().then((m) => m.adminApi.updatePlatformUser(id, p))                 as Promise<User>,
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export const auditApi = {
  list: (params?: {
    user_id?: string; action?: string; table_name?: string
    from?: string; to?: string; limit?: number; offset?: number
  }) => api().then((m) => m.auditApi.list(params)) as Promise<AuditListResponse>,
}