/**
 * Drop-in replacement for src/api/endpoints.ts when VITE_MOCK=true.
 * Import from this file instead of the real endpoints file — or let
 * the mock bootstrap (src/mocks/index.ts) monkey-patch automatically.
 */

import {
  mockAuth, mockPlans, mockActivities, mockOrg,
  mockReports, mockAi,
} from './handlers'
import type {
  LoginPayload, Plan, Activity, UserRole,
  ReportType, ReportFormat,
  AiDraftRequest, AiSummaryRequest,
} from '../types'

export const authApi = {
  login: (p: LoginPayload) => mockAuth.login(p.email, p.password),
  refresh: async () => ({ access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_in: 900 }),
  logout: async () => {},
}

export const plansApi = {
  list:      ()                          => mockPlans.list(),
  get:       (id: string)                => mockPlans.get(id),
  create:    (p: Partial<Plan>)          => mockPlans.create(p),
  update:    (id: string, p: Partial<Plan>) => mockPlans.update(id, p),
  delete:    (id: string)                => mockPlans.delete(id),
  duplicate: (id: string)                => mockPlans.duplicate(id),
  progress:  (id: string)                => mockPlans.progress(id),
}

export const activitiesApi = {
  list:   (planId: string)                         => mockActivities.list(planId),
  get:    (id: string)                             => mockActivities.get(id),
  create: (planId: string, p: Partial<Activity>)   => mockActivities.create(planId, p),
  update: (id: string, p: Partial<Activity>)       => mockActivities.update(id, p),
  delete: (id: string)                             => mockActivities.delete(id),
  createLink: async () => {},
  deleteLink: async () => {},
}

export const reportsApi = {
  generate: (planId: string, _p: { type: ReportType; format: ReportFormat }) =>
    mockReports.generate(planId),
  poll:    (jobId: string)   => mockReports.poll(jobId),
  history: (planId: string)  => mockReports.history(planId),
}

export const aiApi = {
  draft:   (p: AiDraftRequest)   => mockAi.draft(p.activity_type),
  summary: (_p: AiSummaryRequest) => mockAi.summary(),
}

export const orgApi = {
  listUsers:       ()                                          => mockOrg.listUsers(),
  updateUser:      (id: string, p: { role?: UserRole; is_active?: boolean }) => mockOrg.updateUser(id, p),
  listInvitations: ()                                          => mockOrg.listInvitations(),
  sendInvitation:  (p: { email: string; role: UserRole })      => mockOrg.sendInvitation(p),
  cancelInvitation:(id: string)                                => mockOrg.cancelInvitation(id),
  resendInvitation:(id: string)                                => mockOrg.resendInvitation(id),
}

export const invitationsApi = {
  accept: async () => ({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 900,
  }),
}

export const adminApi = {
  listOrgs:          async () => [],
  createOrg:         async () => {},
  updateOrg:         async () => {},
  sendOrgInvitation: async () => {},
}
