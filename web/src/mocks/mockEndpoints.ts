/**
 * mocks/mockEndpoints.ts — drop-in replacement for realEndpoints when VITE_MOCK=true.
 *
 * Delegates every call to the in-memory handlers in mocks/handlers.ts.
 * The signatures here must exactly match realEndpoints.ts — TypeScript will
 * catch any drift at build time via endpointsImpl.ts's Promise<T> casts.
 */

import {
  mockAuth,
  mockPlans,
  mockActivities,
  mockOrg,
  mockReports,
  mockAi,
  mockAuditLog,
} from './handlers'

import type {
  LoginPayload, Plan, Activity, ActivityLink,
  UserRole, ReportType, ReportFormat,
  AiDraftRequest, AiSummaryRequest,
  Milestone, MilestoneStatus, SSOConfig,
} from '../types'

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login:                (p: LoginPayload)                    => mockAuth.login(p.email, p.password),
  refresh:              async ()                             => ({ access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 900 }),
  logout:               async ()                             => {},
  requestPasswordReset: async (_email: string)               => {},
  confirmPasswordReset: async (_t: string, _p: string)       => {},
}

// ── Invitations (public) ──────────────────────────────────────────────────────

export const invitationsApi = {
  accept: async (_p: { token: string; name: string; password: string }) => ({
    access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 900,
  }),
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export const plansApi = {
  list:         ()                              => mockPlans.list(),
  get:          (id: string)                    => mockPlans.get(id),
  create:       (p: Partial<Plan>)              => mockPlans.create(p),
  update:       (id: string, p: Partial<Plan>)  => mockPlans.update(id, p),
  delete:       (id: string)                    => mockPlans.delete(id),
  duplicate:    (id: string)                    => mockPlans.duplicate(id),
  progress:     (id: string)                    => mockPlans.progress(id),
  grantViewer:  async (_planId: string, _userId: string) => {},
  revokeViewer: async (_planId: string, _userId: string) => {},
}

// ── Activities ────────────────────────────────────────────────────────────────

export const activitiesApi = {
  // mockActivities.list only accepts planId — phase/status filtering is done
  // client-side here to mirror the real backend's ?phase= and ?status= params.
  list: (planId: string, params?: { phase?: string; status?: string }) =>
    mockActivities.list(planId).then((acts) => {
      let result = acts
      if (params?.phase)  result = result.filter((a) => a.phase  === params.phase)
      if (params?.status) result = result.filter((a) => a.status === params.status)
      return result
    }),

  get: (planId: string, activityId: string) =>
    mockActivities.list(planId).then((acts) => {
      const a = acts.find((x) => x.id === activityId)
      if (!a) throw new Error(`Activity ${activityId} not found`)
      return a
    }),

  create:            (planId: string, p: Partial<Activity>)   => mockActivities.create(planId, p),
  update:            (id: string, p: Partial<Activity>)        => mockActivities.update(id, p),
  delete:            (id: string)                              => mockActivities.delete(id),
  createLink:        (id: string, p: Partial<ActivityLink>)    => mockActivities.createLink(id, p),
  listActivityLinks: (activityId: string)                      => mockActivities.listLinks(activityId),
  listLinks:         (planId: string)                          => mockActivities.listLinks(planId),
  listAutoLinks:     async (_planId: string): Promise<ActivityLink[]> => [],
  deleteLink:        (actId: string, linkId: string)           => mockActivities.deleteLink(actId, linkId),
}

// ── Milestones (stub — not in original mock handlers) ────────────────────────

const _milestones: Milestone[] = []

export const milestonesApi = {
  list: async (_planId: string): Promise<Milestone[]> => _milestones,

  create: async (planId: string, p: Partial<Milestone>): Promise<Milestone> => ({
    id:                  crypto.randomUUID(),
    plan_id:             planId,
    title:               p.title    ?? '',
    due_date:            p.due_date ?? new Date().toISOString(),
    status:              (p.status  ?? 'pending') as MilestoneStatus,
    linked_activity_id:  p.linked_activity_id,
    created_at:          new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  }),

  update: async (id: string, p: Partial<Milestone>): Promise<Milestone> => ({
    id,
    plan_id:  '',
    title:    p.title    ?? '',
    due_date: p.due_date ?? '',
    status:   (p.status  ?? 'pending') as MilestoneStatus,
    created_at: '',
    updated_at: new Date().toISOString(),
  }),

  delete: async (_id: string): Promise<void> => {},
}

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsApi = {
  generate: (planId: string, _p: { type: ReportType; format: ReportFormat }) =>
              mockReports.generate(planId),
  poll:     (jobId: string)  => mockReports.poll(jobId),
  history:  (planId: string) => mockReports.history(planId),
}

// ── AI ────────────────────────────────────────────────────────────────────────

export const aiApi = {
  draft:   (p: AiDraftRequest)    => mockAi.draft(p.activity_type),
  summary: (_p: AiSummaryRequest) => mockAi.summary(),
}

// ── Org / Users ───────────────────────────────────────────────────────────────

export const orgApi = {
  listUsers:        ()                                                         => mockOrg.listUsers(),
  updateUser:       (id: string, p: { role?: UserRole; is_active?: boolean })  => mockOrg.updateUser(id, p),
  listInvitations:  ()                                                         => mockOrg.listInvitations(),
  sendInvitation:   (p: { email: string; role: UserRole; plan_ids?: string[] }) => mockOrg.sendInvitation(p),
  cancelInvitation: (id: string)                                               => mockOrg.cancelInvitation(id),
  resendInvitation: (id: string)                                               => mockOrg.resendInvitation(id),
}

// ── SSO (stub) ────────────────────────────────────────────────────────────────

export const ssoApi = {
  getConfig:       async (): Promise<SSOConfig> => {
    throw Object.assign(new Error('No SSO configured'), { response: { status: 404 } })
  },
  upsertConfig:    async (p: Partial<SSOConfig>): Promise<SSOConfig> => p as SSOConfig,
  deleteConfig:    async (): Promise<void>                             => {},
  samlMetadataUrl: (slug: string): string => `/auth/saml/${slug}/metadata`,
  oidcLoginUrl:    (slug: string): string => `/auth/oidc/${slug}/login`,
}

// ── Super Admin ───────────────────────────────────────────────────────────────

export const adminApi = {
  listOrgs:          async () => [],
  createOrg:         async () => ({} as never),
  updateOrg:         async () => ({} as never),
  sendOrgInvitation: async () => ({} as never),
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export const auditApi = {
  list: (params?: Parameters<typeof mockAuditLog.list>[0]) => mockAuditLog.list(params),
}