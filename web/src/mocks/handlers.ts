/**
 * Mock API layer — replaces all real API calls when VITE_MOCK=true.
 * Simulates network delay, mutates in-memory state, and returns
 * the same shapes the real backend would return.
 */

import type {
  Plan, Activity, User, Invitation, Organisation,
  AuthTokens, UserRole, ActivityStatus, ActivityLink,
} from '../types'
import {
  MOCK_ME, MOCK_ORG, MOCK_USERS, MOCK_INVITATIONS,
  MOCK_PLANS, MOCK_ACTIVITIES, MOCK_REPORTS, MOCK_ACTIVITY_LINKS,
} from './seed'

// ─── In-memory mutable state ────────────────────────────────────────────────

let plans: Plan[]        = structuredClone(MOCK_PLANS)
let activities: Activity[] = structuredClone(MOCK_ACTIVITIES)
let users: User[]        = structuredClone(MOCK_USERS)
let invitations: Invitation[] = structuredClone(MOCK_INVITATIONS)
let activityLinks: ActivityLink[] = structuredClone(MOCK_ACTIVITY_LINKS)

// ─── Helpers ────────────────────────────────────────────────────────────────

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms))
const now   = () => new Date().toISOString()
const uuid  = () => crypto.randomUUID()

function recomputeProgress(planId: string): Plan['progress'] {
  const acts = activities.filter((a) => a.plan_id === planId)
  const phases = (['P1', 'P2', 'P3'] as const).map((phase) => {
    const pa = acts.filter((a) => a.phase === phase)
    const total = pa.length
    const complete = pa.filter((a) => a.status === 'complete').length
    const in_progress = pa.filter((a) => a.status === 'in_progress').length
    const overdue = pa.filter((a) =>
      a.due_date && a.status !== 'complete' && new Date(a.due_date) < new Date()
    ).length
    return { phase, total, complete, in_progress, overdue, percent: total ? Math.round((complete / total) * 100) : 0 }
  })
  const overall = phases.length ? Math.round(phases.reduce((s, p) => s + p.percent, 0) / phases.length) : 0
  return {
    overall_percent: overall,
    overdue_count: phases.reduce((s, p) => s + p.overdue, 0),
    phases,
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const mockAuth = {
  login: async (_email: string, _password: string): Promise<AuthTokens> => {
    await delay(600)
    // Accept any credentials in mock mode
    return { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_in: 900 }
  },

  me: async (): Promise<User> => {
    await delay(200)
    return structuredClone(MOCK_ME)
  },

  org: async (): Promise<Organisation> => {
    await delay(200)
    return structuredClone(MOCK_ORG)
  },
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export const mockPlans = {
  list: async (): Promise<Plan[]> => {
    await delay()
    return plans.map((p) => ({ ...p, progress: recomputeProgress(p.id) }))
  },

  get: async (id: string): Promise<Plan> => {
    await delay(200)
    const plan = plans.find((p) => p.id === id)
    if (!plan) throw new Error('Plan not found')
    return { ...structuredClone(plan), progress: recomputeProgress(id) }
  },

  create: async (payload: Partial<Plan>): Promise<Plan> => {
    await delay(500)
    const plan: Plan = {
      id: `plan-${uuid().slice(0, 8)}`,
      org_id: MOCK_ORG.id,
      owner_id: MOCK_ME.id,
      title: payload.title ?? 'Untitled plan',
      description: payload.description,
      status: payload.status ?? 'draft',
      start_date: payload.start_date,
      end_date: payload.end_date,
      created_at: now(),
      updated_at: now(),
    }
    plans = [...plans, plan]
    return { ...plan, progress: recomputeProgress(plan.id) }
  },

  update: async (id: string, payload: Partial<Plan>): Promise<Plan> => {
    await delay(400)
    plans = plans.map((p) =>
      p.id === id ? { ...p, ...payload, updated_at: now() } : p
    )
    const updated = plans.find((p) => p.id === id)!
    return { ...updated, progress: recomputeProgress(id) }
  },

  delete: async (id: string): Promise<void> => {
    await delay(400)
    plans = plans.filter((p) => p.id !== id)
    activities = activities.filter((a) => a.plan_id !== id)
  },

  duplicate: async (id: string): Promise<Plan> => {
    await delay(600)
    const source = plans.find((p) => p.id === id)
    if (!source) throw new Error('Plan not found')
    const newId = `plan-${uuid().slice(0, 8)}`
    const copy: Plan = {
      ...structuredClone(source),
      id: newId,
      title: `${source.title} (copy)`,
      status: 'draft',
      created_at: now(),
      updated_at: now(),
    }
    // Duplicate activities too
    const srcActs = activities.filter((a) => a.plan_id === id)
    const copyActs = srcActs.map((a) => ({
      ...structuredClone(a),
      id: `act-${uuid().slice(0, 8)}`,
      plan_id: newId,
      status: 'not_started' as ActivityStatus,
      created_at: now(),
      updated_at: now(),
    }))
    plans = [...plans, copy]
    activities = [...activities, ...copyActs]
    return { ...copy, progress: recomputeProgress(newId) }
  },

  progress: async (id: string) => {
    await delay(200)
    return recomputeProgress(id)
  },
}

// ─── Activities ──────────────────────────────────────────────────────────────

export const mockActivities = {
  list: async (planId: string): Promise<Activity[]> => {
    await delay()
    return structuredClone(activities.filter((a) => a.plan_id === planId))
  },

  get: async (id: string): Promise<Activity> => {
    await delay(200)
    const a = activities.find((a) => a.id === id)
    if (!a) throw new Error('Activity not found')
    return structuredClone(a)
  },

  create: async (planId: string, payload: Partial<Activity>): Promise<Activity> => {
    await delay(400)
    const maxOrder = activities
      .filter((a) => a.plan_id === planId && a.phase === payload.phase)
      .reduce((m, a) => Math.max(m, a.user_order), 0)
    const activity: Activity = {
      id: `act-${uuid().slice(0, 8)}`,
      plan_id: planId,
      org_id: MOCK_ORG.id,
      phase: payload.phase ?? 'P1',
      type: payload.type ?? 'swot',
      title: payload.title ?? 'Untitled activity',
      user_order: maxOrder + 1,
      status: 'not_started',
      content: payload.content ?? {},
      due_date: payload.due_date,
      assigned_to: payload.assigned_to,
      created_at: now(),
      updated_at: now(),
    }
    activities = [...activities, activity]
    return structuredClone(activity)
  },

  update: async (id: string, payload: Partial<Activity>): Promise<Activity> => {
    await delay(350)
    activities = activities.map((a) =>
      a.id === id ? { ...a, ...payload, updated_at: now() } : a
    )
    return structuredClone(activities.find((a) => a.id === id)!)
  },

  delete: async (id: string): Promise<void> => {
    await delay(300)
    activities = activities.filter((a) => a.id !== id)
    activityLinks = activityLinks.filter((l) => l.source_id !== id && l.target_id !== id)
  },

  listLinks: async (planId: string): Promise<ActivityLink[]> => {
    await delay(250)
    return structuredClone(activityLinks.filter((l) => l.plan_id === planId))
  },

  createLink: async (sourceId: string, payload: Partial<ActivityLink>): Promise<ActivityLink> => {
    await delay(350)
    const targetId = payload.target_id
    if (!targetId) throw new Error('target_id is required')
    const sourceAct = activities.find((a) => a.id === sourceId)
    if (!sourceAct) throw new Error('Source activity not found')
    const link: ActivityLink = {
      id: `link-${uuid().slice(0, 8)}`,
      plan_id: sourceAct.plan_id,
      source_id: sourceId,
      target_id: targetId,
      link_type: payload.link_type ?? 'manual',
      created_by: MOCK_ME.id,
      created_at: now(),
    }
    activityLinks = [...activityLinks, link]
    return structuredClone(link)
  },

  deleteLink: async (_activityId: string, linkId: string): Promise<void> => {
    await delay(250)
    activityLinks = activityLinks.filter((l) => l.id !== linkId)
  },
}

// ─── Org / Users ─────────────────────────────────────────────────────────────

export const mockOrg = {
  listUsers: async (): Promise<User[]> => {
    await delay()
    return structuredClone(users)
  },

  updateUser: async (id: string, payload: { role?: UserRole; is_active?: boolean }): Promise<User> => {
    await delay(400)
    users = users.map((u) =>
      u.id === id ? { ...u, ...payload, updated_at: now() } : u
    )
    return structuredClone(users.find((u) => u.id === id)!)
  },

  listInvitations: async (): Promise<Invitation[]> => {
    await delay()
    return structuredClone(invitations)
  },

  sendInvitation: async (payload: { email: string; role: UserRole }): Promise<Invitation> => {
    await delay(500)
    const inv: Invitation = {
      id: `inv-${uuid().slice(0, 8)}`,
      org_id: MOCK_ORG.id,
      email: payload.email,
      role: payload.role,
      invited_by: MOCK_ME.id,
      expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      status: 'pending',
      created_at: now(),
    }
    invitations = [...invitations, inv]
    return structuredClone(inv)
  },

  cancelInvitation: async (id: string): Promise<void> => {
    await delay(300)
    invitations = invitations.map((i) =>
      i.id === id ? { ...i, status: 'cancelled' as const } : i
    )
  },

  resendInvitation: async (id: string): Promise<void> => {
    await delay(400)
    invitations = invitations.map((i) =>
      i.id === id
        ? { ...i, expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() }
        : i
    )
  },
}

// ─── Reports ─────────────────────────────────────────────────────────────────

let pendingJobs: Record<string, { resolveAt: number; planId: string }> = {}

export const mockReports = {
  generate: async (planId: string): Promise<{ job_id: string }> => {
    await delay(400)
    const jobId = `job-${uuid().slice(0, 8)}`
    pendingJobs[jobId] = { resolveAt: Date.now() + 3000, planId }
    return { job_id: jobId }
  },

  poll: async (jobId: string) => {
    await delay(200)
    const job = pendingJobs[jobId]
    if (!job) return { status: 'unknown' }
    if (Date.now() < job.resolveAt) return { status: 'processing' }
    delete pendingJobs[jobId]
    return {
      status: 'complete',
      file_url: `/mock-reports/${jobId}.pdf`,
      report: {
        id: `rpt-${uuid().slice(0, 8)}`,
        plan_id: job.planId,
        org_id: MOCK_ORG.id,
        type: 'full_plan' as const,
        format: 'pdf' as const,
        file_path: `/mock-reports/${jobId}.pdf`,
        generated_by: MOCK_ME.id,
        generated_at: now(),
      },
    }
  },

  history: async (planId: string) => {
    await delay(250)
    return MOCK_REPORTS.filter((r) => r.plan_id === planId)
  },
}

// ─── AI ──────────────────────────────────────────────────────────────────────

const AI_DRAFTS: Record<string, Record<string, unknown>> = {
  swot: {
    strengths: 'Strong leadership commitment to reform\nExisting policy framework\nTrained civil service',
    weaknesses: 'Limited data infrastructure\nSlow procurement cycles\nInsufficient M&E capacity',
    opportunities: 'Digital service delivery\nRegional integration\nYouth demographic dividend',
    threats: 'Fiscal constraints\nClimate risk\nPolitical economy of reform',
  },
  pestle: {
    political: 'Stable governance environment; reform appetite at cabinet level',
    economic: 'Moderate growth; high informality; SACU dependency',
    social: 'Young population; urbanisation trend; gender gap in formal employment',
    technological: 'High mobile penetration; lagging broadband; fintech opportunity',
    legal: 'Regulatory modernisation in progress; PPP framework under development',
    environmental: 'Semi-arid climate risk; land degradation; water scarcity emerging',
  },
  kpi_framework: {
    rows: [
      { id: uuid(), name: 'Primary KPI 1', unit: '%', baseline: '0', target: '25', current: '0' },
      { id: uuid(), name: 'Primary KPI 2', unit: 'count', baseline: '0', target: '1000', current: '0' },
      { id: uuid(), name: 'Efficiency ratio', unit: '%', baseline: '60', target: '85', current: '60' },
    ],
  },
  risk_register: {
    rows: [
      { id: uuid(), risk: 'Implementation capacity gap', likelihood: 3, impact: 4, score: 12, mitigation: 'Capacity building programme', owner: 'Programme Director' },
      { id: uuid(), risk: 'Stakeholder resistance', likelihood: 2, impact: 3, score: 6, mitigation: 'Engagement and communication plan', owner: 'Communications Lead' },
    ],
  },
  vision_mission: {
    vision: 'A thriving, equitable and competitive economy by 2030.',
    mission: 'To drive sustainable development through strategic investment, innovation, and inclusive growth.',
    values: 'Transparency · Accountability · Excellence · Innovation · Inclusion',
  },
}

export const mockAi = {
  draft: async (activityType: string): Promise<{ draft: Record<string, unknown>; model: string }> => {
    await delay(1800) // simulate LLM latency
    const draft = AI_DRAFTS[activityType] ?? {
      content: `AI-generated draft for ${activityType.replace(/_/g, ' ')}.\n\nThis is placeholder content. In production, Ollama (llama3) will generate contextual content based on your keywords and organisation profile.`,
      notes: 'Review and edit before saving.',
    }
    return { draft, model: 'llama3 (mock)' }
  },

  summary: async (): Promise<{ summary: string; model: string }> => {
    await delay(2000)
    return {
      summary: `This strategic plan demonstrates strong progress at the analysis phase, with a comprehensive evidence base established across SWOT, PESTLE, and risk dimensions. The strategy phase has defined clear objectives and a robust KPI framework. Operational planning is underway with budget allocation confirmed. Key risks include procurement delays and stakeholder alignment on SOE reform. Overall trajectory is positive; attention is needed on two overdue deliverables in P1 and P2.`,
      model: 'llama3 (mock)',
    }
  },
}
