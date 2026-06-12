import apiClient from './client'
import type {
  AuthTokens,
  LoginPayload,
  Plan,
  Activity,
  ActivityLink,
  AiDraftRequest,
  AiDraftResponse,
  AiSummaryRequest,
  AiSummaryResponse,
  Invitation,
  Organisation,
  PlanProgress,
  Report,
  ReportFormat,
  ReportType,
  User,
  UserRole,
} from '../types'

// ─── Auth ───────────────────────────────────────────────────────────────────

export const authApi = {
  login: (payload: LoginPayload) =>
    apiClient.post<AuthTokens>('/auth/login', payload).then((r) => r.data), // NOTE: /auth is outside /api/v1

  refresh: (refreshToken: string) =>
    apiClient
      .post<AuthTokens>('/auth/refresh', { refresh_token: refreshToken })
      .then((r) => r.data),

  logout: () => apiClient.post('/auth/logout'),
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export const plansApi = {
  list: () => apiClient.get<Plan[]>('/plans').then((r) => r.data),

  get: (id: string) => apiClient.get<Plan>(`/plans/${id}`).then((r) => r.data),

  create: (payload: Partial<Plan>) =>
    apiClient.post<Plan>('/plans', payload).then((r) => r.data),

  update: (id: string, payload: Partial<Plan>) =>
    apiClient.put<Plan>(`/plans/${id}`, payload).then((r) => r.data),

  delete: (id: string) => apiClient.delete(`/plans/${id}`),

  progress: (id: string) =>
    apiClient.get<PlanProgress>(`/plans/${id}/progress`).then((r) => r.data),

  duplicate: (id: string) =>
    apiClient.post<Plan>(`/plans/${id}/duplicate`).then((r) => r.data),
}

// ─── Activities ─────────────────────────────────────────────────────────────

export const activitiesApi = {
  list: (planId: string, params?: { phase?: string; status?: string }) =>
    apiClient
      .get<Activity[]>(`/plans/${planId}/activities`, { params })
      .then((r) => r.data),

  get: (id: string) =>
    apiClient.get<Activity>(`/activities/${id}`).then((r) => r.data),

  create: (planId: string, payload: Partial<Activity>) =>
    apiClient
      .post<Activity>(`/plans/${planId}/activities`, payload)
      .then((r) => r.data),

  update: (id: string, payload: Partial<Activity>) =>
    apiClient.put<Activity>(`/activities/${id}`, payload).then((r) => r.data),

  delete: (id: string) => apiClient.delete(`/activities/${id}`),

  createLink: (id: string, payload: Partial<ActivityLink>) =>
    apiClient
      .post<ActivityLink>(`/activities/${id}/links`, payload)
      .then((r) => r.data),

  deleteLink: (activityId: string, linkId: string) =>
    apiClient.delete(`/activities/${activityId}/links/${linkId}`),
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export const reportsApi = {
  generate: (
    planId: string,
    payload: { type: ReportType; format: ReportFormat; date_range?: { from: string; to: string } },
  ) =>
    apiClient
      .post<{ job_id: string }>(`/plans/${planId}/reports`, payload)
      .then((r) => r.data),

  poll: (jobId: string) =>
    apiClient
      .get<{ status: string; file_url?: string; report?: Report }>(`/reports/${jobId}`)
      .then((r) => r.data),

  history: (planId: string) =>
    apiClient.get<Report[]>(`/plans/${planId}/reports`).then((r) => r.data),
}

// ─── AI ──────────────────────────────────────────────────────────────────────

export const aiApi = {
  draft: (payload: AiDraftRequest) =>
    apiClient.post<AiDraftResponse>('/ai/draft', payload).then((r) => r.data),

  summary: (payload: AiSummaryRequest) =>
    apiClient.post<AiSummaryResponse>('/ai/summary', payload).then((r) => r.data),
}

// ─── Org / Users ─────────────────────────────────────────────────────────────

export const orgApi = {
  listUsers: () => apiClient.get<User[]>('/org/users').then((r) => r.data),

  updateUser: (id: string, payload: { role?: UserRole; is_active?: boolean }) =>
    apiClient.patch<User>(`/org/users/${id}`, payload).then((r) => r.data),

  listInvitations: () =>
    apiClient.get<Invitation[]>('/org/invitations').then((r) => r.data),

  sendInvitation: (payload: { email: string; role: UserRole }) =>
    apiClient.post<Invitation>('/org/invitations', payload).then((r) => r.data),

  cancelInvitation: (id: string) =>
    apiClient.delete(`/org/invitations/${id}`),

  resendInvitation: (id: string) =>
    apiClient.post(`/org/invitations/${id}/resend`),
}

// ─── Invitations (public) ─────────────────────────────────────────────────────

export const invitationsApi = {
  accept: (payload: { token: string; name: string; password: string }) =>
    apiClient
      .post<AuthTokens>('/invitations/accept', payload)
      .then((r) => r.data),
}

// ─── Super Admin ──────────────────────────────────────────────────────────────

export const adminApi = {
  listOrgs: () =>
    apiClient.get<Organisation[]>('/admin/orgs').then((r) => r.data),

  createOrg: (payload: Partial<Organisation>) =>
    apiClient.post<Organisation>('/admin/orgs', payload).then((r) => r.data),

  updateOrg: (id: string, payload: { is_active: boolean }) =>
    apiClient.patch<Organisation>(`/admin/orgs/${id}`, payload).then((r) => r.data),

  sendOrgInvitation: (payload: { email: string }) =>
    apiClient
      .post<Invitation>('/admin/org-invitations', payload)
      .then((r) => r.data),
}
