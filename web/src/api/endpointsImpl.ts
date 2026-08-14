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
  StrategicPillar, StrategicObjective,
  AiDraftRequest, AiSummaryRequest, AiSuggestLinksRequest, AiLinkSuggestion,
  Invitation, Organisation, OrgProfileUpdate,
  Report, ReportType, ReportFormat, ReportJobStatus, ReportSectionConfig,
  User, UserRole,
  ProfileUpdate, ChangePasswordPayload, Session,
  AuditListResponse,
  Milestone, MilestoneStatus,
  SSOConfig, CoreValue, Stakeholder, StakeholderLevel, SWOTItem, SWOTCategory,
  PESTELItem, PESTELFactor, OrgStructureRole, MEItem, MECategory
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

// ── Self-service account (Me) ───────────────────────────────────────────────

export const meApi = {
  getProfile:        ()                             => api().then((m) => m.meApi.getProfile())        as Promise<User>,
  updateProfile:     (p: ProfileUpdate)              => api().then((m) => m.meApi.updateProfile(p))    as Promise<User>,
  changePassword:    (p: ChangePasswordPayload)      => api().then((m) => m.meApi.changePassword(p))   as Promise<{ message: string }>,
  listSessions:      ()                              => api().then((m) => m.meApi.listSessions())      as Promise<Session[]>,
  revokeAllSessions: ()                              => api().then((m) => m.meApi.revokeAllSessions()) as Promise<{ message: string }>,
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
  list:              (planId: string, params?: { category?: string; objective_id?: string; status?: string }) =>
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

// ── Strategic pillars / objectives (local plans only) ──────────────────────

export const pillarsApi = {
  list:             (planId: string)                          => api().then((m) => m.pillarsApi.list(planId))                    as Promise<StrategicPillar[]>,
  create:           (planId: string, p: { title: string })     => api().then((m) => m.pillarsApi.create(planId, p))               as Promise<StrategicPillar>,
  update:           (id: string, p: Partial<StrategicPillar>)  => api().then((m) => m.pillarsApi.update(id, p))                   as Promise<StrategicPillar>,
  delete:           (id: string)                               => api().then((m) => m.pillarsApi.delete(id))                     as Promise<void>,
  listObjectives:   (planId: string)                          => api().then((m) => m.pillarsApi.listObjectives(planId))           as Promise<StrategicObjective[]>,
  createObjective:  (pillarId: string, p: { title: string })   => api().then((m) => m.pillarsApi.createObjective(pillarId, p))    as Promise<StrategicObjective>,
  updateObjective:  (id: string, p: Partial<StrategicObjective>) => api().then((m) => m.pillarsApi.updateObjective(id, p))        as Promise<StrategicObjective>,
  deleteObjective:  (id: string)                               => api().then((m) => m.pillarsApi.deleteObjective(id))            as Promise<void>,
}

// ── Chapter 2: Strategic Focus ──────────────────────────────────────────────
 
export const strategicFocusApi = {
  update: (planId: string, p: { vision?: string; mission?: string }) =>
    api().then((m) => m.strategicFocusApi.update(planId, p)) as Promise<Plan>,
}
 
export const coreValuesApi = {
  list:   (planId: string)                     => api().then((m) => m.coreValuesApi.list(planId))       as Promise<CoreValue[]>,
  create: (planId: string, p: { name: string; description?: string }) =>
    api().then((m) => m.coreValuesApi.create(planId, p)) as Promise<CoreValue>,
  update: (id: string, p: Partial<CoreValue>)  => api().then((m) => m.coreValuesApi.update(id, p))       as Promise<CoreValue>,
  delete: (id: string)                         => api().then((m) => m.coreValuesApi.delete(id))          as Promise<void>,
}
 
// ── Chapter 3: Situational Analysis ─────────────────────────────────────────
 
export const stakeholdersApi = {
  list:   (planId: string) => api().then((m) => m.stakeholdersApi.list(planId)) as Promise<Stakeholder[]>,
  create: (planId: string, p: { name: string; influence: StakeholderLevel; interest: StakeholderLevel; notes?: string }) =>
    api().then((m) => m.stakeholdersApi.create(planId, p)) as Promise<Stakeholder>,
  update: (id: string, p: Partial<Stakeholder>) => api().then((m) => m.stakeholdersApi.update(id, p))    as Promise<Stakeholder>,
  delete: (id: string)                          => api().then((m) => m.stakeholdersApi.delete(id))       as Promise<void>,
}
 
export const swotApi = {
  list:   (planId: string) => api().then((m) => m.swotApi.list(planId)) as Promise<SWOTItem[]>,
  create: (planId: string, p: { category: SWOTCategory; text: string }) =>
    api().then((m) => m.swotApi.create(planId, p)) as Promise<SWOTItem>,
  update: (id: string, p: Partial<SWOTItem>) => api().then((m) => m.swotApi.update(id, p)) as Promise<SWOTItem>,
  delete: (id: string)                       => api().then((m) => m.swotApi.delete(id))    as Promise<void>,
}
 
export const pestelApi = {
  list:   (planId: string) => api().then((m) => m.pestelApi.list(planId)) as Promise<PESTELItem[]>,
  create: (planId: string, p: { factor: PESTELFactor; implication?: string; positive?: string; negative?: string }) =>
    api().then((m) => m.pestelApi.create(planId, p)) as Promise<PESTELItem>,
  update: (id: string, p: Partial<PESTELItem>) => api().then((m) => m.pestelApi.update(id, p)) as Promise<PESTELItem>,
  delete: (id: string)                         => api().then((m) => m.pestelApi.delete(id))    as Promise<void>,
}
 
// ── Chapter 6: Organisational Structure ─────────────────────────────────────
 
export const orgStructureApi = {
  list:   (planId: string) => api().then((m) => m.orgStructureApi.list(planId)) as Promise<OrgStructureRole[]>,
  create: (planId: string, p: { title: string; description?: string; reports_to_id?: string }) =>
    api().then((m) => m.orgStructureApi.create(planId, p)) as Promise<OrgStructureRole>,
  update: (id: string, p: Partial<OrgStructureRole>) => api().then((m) => m.orgStructureApi.update(id, p)) as Promise<OrgStructureRole>,
  delete: (id: string)                               => api().then((m) => m.orgStructureApi.delete(id))    as Promise<void>,
}
 
// ── Chapter 7: Monitoring & Evaluation ──────────────────────────────────────
 
export const meItemsApi = {
  list:   (planId: string, category?: MECategory) => api().then((m) => m.meItemsApi.list(planId, category)) as Promise<MEItem[]>,
  create: (planId: string, p: { category: MECategory; text: string }) =>
    api().then((m) => m.meItemsApi.create(planId, p)) as Promise<MEItem>,
  update: (id: string, p: Partial<MEItem>) => api().then((m) => m.meItemsApi.update(id, p)) as Promise<MEItem>,
  delete: (id: string)                     => api().then((m) => m.meItemsApi.delete(id))    as Promise<void>,
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
  suggestLinks: (p: AiSuggestLinksRequest) =>
    api().then((m) => m.aiApi.suggestLinks(p)) as Promise<{ suggestions: AiLinkSuggestion[]; model: string }>,
}

// ── Org / Users ───────────────────────────────────────────────────────────────

export const orgApi = {
  /** GET /api/v1/org — the caller's own organisation, including profile fields */
  getOrg:           ()                                              => api().then((m) => m.orgApi.getOrg())                   as Promise<Organisation>,
  /** PATCH /api/v1/org — org_admin self-service profile update (address, country,
   *  contact info, industry, org structure, member count). Used as AI context. */
  updateOrg:        (p: OrgProfileUpdate)                           => api().then((m) => m.orgApi.updateOrg(p))               as Promise<Organisation>,
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

// Cross-organisation snapshot for the platform admin console's overview
// cards — see adminsvc.PlatformStats (Go) for the source of truth. Defined
// here (rather than in ../types) since it's only ever consumed by
// PlatformAdminPage; duplicated in realEndpoints.ts's own request layer for
// the same reason auditApi/reportsApi's inline shapes are — keep the two in
// sync if you add a field.
export interface PlatformStats {
  orgs_total: number
  orgs_active: number
  orgs_new_last_30_days: number
  org_users_total: number
  platform_team_total: number
  plans_total: number
  plans_active: number
  activities_total: number
  reports_generated_total: number
  pending_org_invitations: number
  pending_platform_invitations: number
}

// Platform admin's full view of a single organisation — the same
// Organisation shape plus summary counts. See adminsvc.OrgDetail (Go) for
// the source of truth; duplicated in realEndpoints.ts for the same reason
// as PlatformStats above.
export interface OrgDetail extends Organisation {
  user_count: number
  plan_count: number
  active_plan_count: number
}

export const adminApi = {
  /** GET /api/v1/admin/stats — cross-org counts for the overview cards */
  getStats:          ()                                              => api().then((m) => m.adminApi.getStats())                              as Promise<PlatformStats>,
  listOrgs:          (p?: { active_only?: boolean; limit?: number; offset?: number }) =>
                       api().then((m) => m.adminApi.listOrgs(p))                                 as Promise<Organisation[]>,
  /** GET /api/v1/admin/orgs/{orgID} — full profile + user/plan counts */
  getOrgDetail:      (id: string)                                     => api().then((m) => m.adminApi.getOrgDetail(id))                        as Promise<OrgDetail>,
  createOrg:         (p: Partial<Organisation> & { admin_email?: string })            =>
                       api().then((m) => m.adminApi.createOrg(p))                                as Promise<Organisation>,
  updateOrg:         (id: string, p: { is_active: boolean }) =>
                       api().then((m) => m.adminApi.updateOrg(id, p))                            as Promise<Organisation>,
  /**
   * DELETE /api/v1/admin/orgs/{orgID} — super_admin only. Backend requires
   * the org to already be deactivated (is_active: false) first — deleting
   * a still-active org in one step is rejected with a clear error rather
   * than silently refused, so surface err.message to the user rather than
   * swallowing it.
   */
  deleteOrg:         (id: string)                                     => api().then((m) => m.adminApi.deleteOrg(id))                            as Promise<void>,
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