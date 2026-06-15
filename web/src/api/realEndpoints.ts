import apiClient from './client'
import type {
  AuthTokens, LoginPayload, Plan, Activity, ActivityLink,
  AiDraftRequest, AiDraftResponse, AiSummaryRequest, AiSummaryResponse,
  Invitation, Organisation, PlanProgress, Report,
  ReportFormat, ReportType, User, UserRole,
} from '../types'

export const authApi = {
  login: (payload: LoginPayload) =>
    apiClient.post<AuthTokens>('/auth/login', payload).then((r) => r.data),
  refresh: (refreshToken: string) =>
    apiClient.post<AuthTokens>('/auth/refresh', { refresh_token: refreshToken }).then((r) => r.data),
  logout: () => apiClient.post('/auth/logout'),
}

export const plansApi = {
  list:      ()                             => apiClient.get<Plan[]>('/plans').then((r) => r.data),
  get:       (id: string)                   => apiClient.get<Plan>(`/plans/${id}`).then((r) => r.data),
  create:    (p: Partial<Plan>)             => apiClient.post<Plan>('/plans', p).then((r) => r.data),
  update:    (id: string, p: Partial<Plan>) => apiClient.put<Plan>(`/plans/${id}`, p).then((r) => r.data),
  delete:    (id: string)                   => apiClient.delete(`/plans/${id}`),
  duplicate: (id: string)                   => apiClient.post<Plan>(`/plans/${id}/duplicate`).then((r) => r.data),
  progress:  (id: string)                   => apiClient.get<PlanProgress>(`/plans/${id}/progress`).then((r) => r.data),
}

export const activitiesApi = {
  list: (planId: string, params?: { phase?: string; status?: string }) =>
    apiClient.get<Activity[]>(`/plans/${planId}/activities`, { params }).then((r) => r.data),
  get:    (id: string)                          => apiClient.get<Activity>(`/activities/${id}`).then((r) => r.data),
  create: (planId: string, p: Partial<Activity>) => apiClient.post<Activity>(`/plans/${planId}/activities`, p).then((r) => r.data),
  update: (id: string, p: Partial<Activity>)    => apiClient.put<Activity>(`/activities/${id}`, p).then((r) => r.data),
  delete: (id: string)                          => apiClient.delete(`/activities/${id}`),
  createLink: (id: string, p: Partial<ActivityLink>) => apiClient.post<ActivityLink>(`/activities/${id}/links`, p).then((r) => r.data),
  deleteLink: (actId: string, linkId: string)   => apiClient.delete(`/activities/${actId}/links/${linkId}`),
}

export const reportsApi = {
  generate: (planId: string, p: { type: ReportType; format: ReportFormat; date_range?: { from: string; to: string } }) =>
    apiClient.post<{ job_id: string }>(`/plans/${planId}/reports`, p).then((r) => r.data),
  poll:    (jobId: string)  => apiClient.get<{ status: string; file_url?: string; report?: Report }>(`/reports/${jobId}`).then((r) => r.data),
  history: (planId: string) => apiClient.get<Report[]>(`/plans/${planId}/reports`).then((r) => r.data),
}

export const aiApi = {
  draft:   (p: AiDraftRequest)   => apiClient.post<AiDraftResponse>('/ai/draft', p).then((r) => r.data),
  summary: (p: AiSummaryRequest) => apiClient.post<AiSummaryResponse>('/ai/summary', p).then((r) => r.data),
}

export const orgApi = {
  listUsers:        ()                                              => apiClient.get<User[]>('/org/users').then((r) => r.data),
  updateUser:       (id: string, p: { role?: UserRole; is_active?: boolean }) => apiClient.patch<User>(`/org/users/${id}`, p).then((r) => r.data),
  listInvitations:  ()                                              => apiClient.get<Invitation[]>('/org/invitations').then((r) => r.data),
  sendInvitation:   (p: { email: string; role: UserRole })          => apiClient.post<Invitation>('/org/invitations', p).then((r) => r.data),
  cancelInvitation: (id: string)                                    => apiClient.delete(`/org/invitations/${id}`),
  resendInvitation: (id: string)                                    => apiClient.post(`/org/invitations/${id}/resend`),
}

export const invitationsApi = {
  accept: (p: { token: string; name: string; password: string }) =>
    apiClient.post<AuthTokens>('/invitations/accept', p).then((r) => r.data),
}

export const adminApi = {
  listOrgs:          ()                                    => apiClient.get<Organisation[]>('/admin/orgs').then((r) => r.data),
  createOrg:         (p: Partial<Organisation>)            => apiClient.post<Organisation>('/admin/orgs', p).then((r) => r.data),
  updateOrg:         (id: string, p: { is_active: boolean }) => apiClient.patch<Organisation>(`/admin/orgs/${id}`, p).then((r) => r.data),
  sendOrgInvitation: (p: { email: string })                => apiClient.post<Invitation>('/admin/org-invitations', p).then((r) => r.data),
}
