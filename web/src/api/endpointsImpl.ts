/**
 * Single source of truth for all API calls.
 * VITE_MOCK=true  → delegates to in-memory mock handlers (no network).
 * VITE_MOCK unset → delegates to Axios (real backend).
 *
 * The `if (IS_MOCK)` branches are eliminated at build time by Vite's
 * dead-code removal, so neither path leaks into the other bundle.
 */

import type {
  AuthTokens, LoginPayload, Plan, Activity, ActivityLink,
  AiDraftRequest, AiSummaryRequest,
  Invitation, Organisation, PlanProgress, Report,
  ReportFormat, ReportType, User, UserRole, AuditLog,
} from '../types'

const IS_MOCK = import.meta.env.VITE_MOCK === 'true'

// ─── Lazy singletons ─────────────────────────────────────────────────────────

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
const api = (): Promise<any> => IS_MOCK ? mock() : real()

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login:   (p: LoginPayload)  => api().then((m) => m.authApi.login(p))   as Promise<AuthTokens>,
  refresh: (token: string)    => api().then((m) => m.authApi.refresh(token)) as Promise<AuthTokens>,
  logout:  ()                 => api().then((m) => m.authApi.logout())   as Promise<void>,
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export const plansApi = {
  list:      ()                              => api().then((m) => m.plansApi.list())            as Promise<Plan[]>,
  get:       (id: string)                    => api().then((m) => m.plansApi.get(id))           as Promise<Plan>,
  create:    (p: Partial<Plan>)              => api().then((m) => m.plansApi.create(p))         as Promise<Plan>,
  update:    (id: string, p: Partial<Plan>)  => api().then((m) => m.plansApi.update(id, p))    as Promise<Plan>,
  delete:    (id: string)                    => api().then((m) => m.plansApi.delete(id))        as Promise<void>,
  duplicate: (id: string)                    => api().then((m) => m.plansApi.duplicate(id))     as Promise<Plan>,
  progress:  (id: string)                    => api().then((m) => m.plansApi.progress(id))      as Promise<PlanProgress>,
}

// ─── Activities ──────────────────────────────────────────────────────────────

export const activitiesApi = {
  list:       (planId: string, params?: { phase?: string; status?: string }) =>
                api().then((m) => m.activitiesApi.list(planId, params))           as Promise<Activity[]>,
  get:        (id: string)                           => api().then((m) => m.activitiesApi.get(id))              as Promise<Activity>,
  create:     (planId: string, p: Partial<Activity>) => api().then((m) => m.activitiesApi.create(planId, p))   as Promise<Activity>,
  update:     (id: string, p: Partial<Activity>)     => api().then((m) => m.activitiesApi.update(id, p))       as Promise<Activity>,
  delete:     (id: string)                           => api().then((m) => m.activitiesApi.delete(id))          as Promise<void>,
  createLink: (id: string, p: Partial<ActivityLink>) => api().then((m) => m.activitiesApi.createLink(id, p))   as Promise<ActivityLink>,
  deleteLink: (actId: string, linkId: string)        => api().then((m) => m.activitiesApi.deleteLink(actId, linkId)) as Promise<void>,
  listLinks:  (planId: string)                       => api().then((m) => m.activitiesApi.listLinks(planId))   as Promise<ActivityLink[]>,
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export const reportsApi = {
  generate: (planId: string, p: { type: ReportType; format: ReportFormat; date_range?: { from: string; to: string } }) =>
              api().then((m) => m.reportsApi.generate(planId, p)) as Promise<{ job_id: string }>,
  poll:    (jobId: string)  => api().then((m) => m.reportsApi.poll(jobId))     as Promise<{ status: string; file_url?: string; report?: Report }>,
  history: (planId: string) => api().then((m) => m.reportsApi.history(planId)) as Promise<Report[]>,
}

// ─── AI ──────────────────────────────────────────────────────────────────────

export const aiApi = {
  draft:   (p: AiDraftRequest)   => api().then((m) => m.aiApi.draft(p))   as Promise<{ draft: Record<string, unknown>; model: string }>,
  summary: (p: AiSummaryRequest) => api().then((m) => m.aiApi.summary(p)) as Promise<{ summary: string; model: string }>,
}

// ─── Org / Users ─────────────────────────────────────────────────────────────

export const orgApi = {
  listUsers:        ()                                              => api().then((m) => m.orgApi.listUsers())              as Promise<User[]>,
  updateUser:       (id: string, p: { role?: UserRole; is_active?: boolean }) =>
                      api().then((m) => m.orgApi.updateUser(id, p))                                                          as Promise<User>,
  listInvitations:  ()                                              => api().then((m) => m.orgApi.listInvitations())        as Promise<Invitation[]>,
  sendInvitation:   (p: { email: string; role: UserRole })          => api().then((m) => m.orgApi.sendInvitation(p))        as Promise<Invitation>,
  cancelInvitation: (id: string)                                    => api().then((m) => m.orgApi.cancelInvitation(id))     as Promise<void>,
  resendInvitation: (id: string)                                    => api().then((m) => m.orgApi.resendInvitation(id))     as Promise<void>,
}

// ─── Invitations (public) ─────────────────────────────────────────────────────

export const invitationsApi = {
  accept: (p: { token: string; name: string; password: string }) =>
            api().then((m) => m.invitationsApi.accept(p)) as Promise<AuthTokens>,
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export const auditApi = {
  list: (params?: {
    user_id?: string; action?: string; table_name?: string
    from?: string; to?: string; limit?: number; offset?: number
  }): Promise<{ logs: AuditLog[]; total: number; offset: number; limit: number }> =>
    api().then((m) => m.auditApi.list(params)),
}

// ─── Super Admin ──────────────────────────────────────────────────────────────

export const adminApi = {
  listOrgs:          ()                                        => api().then((m) => m.adminApi.listOrgs())              as Promise<Organisation[]>,
  createOrg:         (p: Partial<Organisation>)                => api().then((m) => m.adminApi.createOrg(p))            as Promise<Organisation>,
  updateOrg:         (id: string, p: { is_active: boolean })   => api().then((m) => m.adminApi.updateOrg(id, p))        as Promise<Organisation>,
  sendOrgInvitation: (p: { email: string })                    => api().then((m) => m.adminApi.sendOrgInvitation(p))    as Promise<Invitation>,
}
