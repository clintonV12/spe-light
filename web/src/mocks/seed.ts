import type {
  Plan, Activity, User, Invitation, Organisation, Report,
} from '../types'

// ─── Org ────────────────────────────────────────────────────────────────────

export const MOCK_ORG: Organisation = {
  id: 'org-001',
  name: 'Eswatini Development Agency',
  slug: 'eda',
  locale: 'en',
  industry: 'Public sector',
  is_active: true,
  created_at: '2024-01-15T08:00:00Z',
  updated_at: '2025-03-01T10:00:00Z',
}

// ─── Users ───────────────────────────────────────────────────────────────────

export const MOCK_ME: User = {
  id: 'user-001',
  org_id: 'org-001',
  email: 'admin@eda.org.sz',
  name: 'Themba Dlamini',
  role: 'org_admin',
  locale: 'en',
  is_active: true,
  created_at: '2024-01-15T08:00:00Z',
  updated_at: '2025-03-01T10:00:00Z',
}

export const MOCK_USERS: User[] = [
  MOCK_ME,
  {
    id: 'user-002',
    org_id: 'org-001',
    email: 'sifiso@eda.org.sz',
    name: 'Sifiso Nkosi',
    role: 'planner',
    is_active: true,
    created_at: '2024-02-01T08:00:00Z',
    updated_at: '2025-02-10T08:00:00Z',
  },
  {
    id: 'user-003',
    org_id: 'org-001',
    email: 'lungile@eda.org.sz',
    name: 'Lungile Shabalala',
    role: 'contributor',
    is_active: true,
    created_at: '2024-03-10T08:00:00Z',
    updated_at: '2025-01-20T08:00:00Z',
  },
  {
    id: 'user-004',
    org_id: 'org-001',
    email: 'nomcebo@eda.org.sz',
    name: 'Nomcebo Mthembu',
    role: 'viewer',
    is_active: false,
    plan_ids: ['plan-001'],
    created_at: '2024-04-01T08:00:00Z',
    updated_at: '2024-11-01T08:00:00Z',
  },
  {
    id: 'user-005',
    org_id: 'org-001',
    email: 'bongani@partner-ngo.org.sz',
    name: 'Bongani Simelane',
    role: 'viewer',
    is_active: true,
    // Plan-scoped: can ONLY see the Youth Employment Initiative (plan-003).
    // Used to verify viewer scoping — see MOCK_SCOPED_VIEWER_ID below.
    plan_ids: ['plan-003'],
    created_at: '2025-05-01T08:00:00Z',
    updated_at: '2025-05-01T08:00:00Z',
  },
]

// Switch which user is "logged in" for mock testing — see mocks/handlers.ts.
// Set to 'user-005' to test viewer plan-scoping (should only see plan-003).
export const MOCK_ACTIVE_USER_ID = 'user-001'

// ─── Invitations ─────────────────────────────────────────────────────────────

export const MOCK_INVITATIONS: Invitation[] = [
  {
    id: 'inv-001',
    org_id: 'org-001',
    email: 'sipho.mamba@gmail.com',
    role: 'planner',
    invited_by: 'user-001',
    expires_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'inv-002',
    org_id: 'org-001',
    email: 'zanele@eda.org.sz',
    role: 'contributor',
    invited_by: 'user-001',
    expires_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'inv-003',
    org_id: 'org-001',
    email: 'old.invite@eda.org.sz',
    role: 'viewer',
    invited_by: 'user-001',
    expires_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'accepted',
    created_at: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

// ─── Plans ───────────────────────────────────────────────────────────────────

export const MOCK_PLANS: Plan[] = [
  {
    id: 'plan-001',
    org_id: 'org-001',
    title: '2025–2027 National Economic Development Strategy',
    description: 'Three-year strategic plan to diversify the economy and reduce unemployment.',
    status: 'active',
    owner_id: 'user-001',
    start_date: '2025-01-01',
    end_date: '2027-12-31',
    created_at: '2025-01-10T08:00:00Z',
    updated_at: '2025-05-20T14:30:00Z',
    progress: {
      overall_percent: 58,
      overdue_count: 2,
      phases: [
        { phase: 'P1', total: 6, complete: 5, in_progress: 1, overdue: 1, percent: 83 },
        { phase: 'P2', total: 5, complete: 3, in_progress: 1, overdue: 1, percent: 60 },
        { phase: 'P3', total: 7, complete: 2, in_progress: 3, overdue: 0, percent: 29 },
      ],
    },
  },
  {
    id: 'plan-002',
    org_id: 'org-001',
    title: 'Digital Transformation Roadmap 2025',
    description: 'Modernising public service delivery through technology.',
    status: 'active',
    owner_id: 'user-002',
    start_date: '2025-03-01',
    end_date: '2025-12-31',
    created_at: '2025-02-15T09:00:00Z',
    updated_at: '2025-06-01T11:00:00Z',
    progress: {
      overall_percent: 34,
      overdue_count: 0,
      phases: [
        { phase: 'P1', total: 4, complete: 4, in_progress: 0, overdue: 0, percent: 100 },
        { phase: 'P2', total: 4, complete: 1, in_progress: 2, overdue: 0, percent: 25 },
        { phase: 'P3', total: 5, complete: 0, in_progress: 1, overdue: 0, percent: 0 },
      ],
    },
  },
  {
    id: 'plan-003',
    org_id: 'org-001',
    title: 'Youth Employment Initiative',
    description: 'Targeted interventions to reduce youth unemployment by 15% over 18 months.',
    status: 'review',
    owner_id: 'user-001',
    start_date: '2024-07-01',
    end_date: '2025-12-31',
    created_at: '2024-06-20T08:00:00Z',
    updated_at: '2025-04-10T16:00:00Z',
    progress: {
      overall_percent: 82,
      overdue_count: 0,
      phases: [
        { phase: 'P1', total: 4, complete: 4, in_progress: 0, overdue: 0, percent: 100 },
        { phase: 'P2', total: 4, complete: 4, in_progress: 0, overdue: 0, percent: 100 },
        { phase: 'P3', total: 6, complete: 3, in_progress: 2, overdue: 0, percent: 50 },
      ],
    },
  },
  {
    id: 'plan-004',
    org_id: 'org-001',
    title: 'Rural Infrastructure Expansion',
    description: 'Draft plan for expanding road and water infrastructure in rural constituencies.',
    status: 'draft',
    owner_id: 'user-002',
    start_date: '2025-09-01',
    end_date: '2028-06-30',
    created_at: '2025-05-30T10:00:00Z',
    updated_at: '2025-06-02T08:00:00Z',
    progress: {
      overall_percent: 5,
      overdue_count: 0,
      phases: [
        { phase: 'P1', total: 3, complete: 0, in_progress: 1, overdue: 0, percent: 10 },
        { phase: 'P2', total: 0, complete: 0, in_progress: 0, overdue: 0, percent: 0 },
        { phase: 'P3', total: 0, complete: 0, in_progress: 0, overdue: 0, percent: 0 },
      ],
    },
  },
]

// ─── Activities ──────────────────────────────────────────────────────────────

const overdueDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const futureDate  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const soonDate    = new Date(Date.now() + 7  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

export const MOCK_ACTIVITIES: Activity[] = [
  // Plan 001 — P1
  {
    id: 'act-001', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P1', type: 'swot', title: 'National SWOT Analysis',
    user_order: 1, status: 'complete',
    content: {
      strengths: 'Strong regional trade position\nNatural resource base\nPolitical stability',
      weaknesses: 'High youth unemployment (38%)\nLimited industrial diversification\nSmall domestic market',
      opportunities: 'AGOA trade preferences\nRegional integration (SACU/SADC)\nDigital economy growth',
      threats: 'Climate change risk to agriculture\nErosion of preferential trade access\nBrain drain to South Africa',
    },
    created_at: '2025-01-12T08:00:00Z', updated_at: '2025-02-01T10:00:00Z',
  },
  {
    id: 'act-002', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P1', type: 'pestle', title: 'PESTLE — Economic Environment',
    user_order: 2, status: 'complete',
    content: {
      political: 'Stable monarchy; Cabinet reform underway',
      economic: 'GDP growth 2.1%; high unemployment; SACU revenue dependency',
      social: 'Young demographic (median age 21); urbanisation accelerating',
      technological: 'Mobile penetration 80%; limited broadband outside Mbabane',
      legal: 'Companies Act 2009 under review; labour law reforms pending',
      environmental: 'Drought cycle risk; deforestation in Highveld',
    },
    created_at: '2025-01-15T08:00:00Z', updated_at: '2025-02-05T10:00:00Z',
  },
  {
    id: 'act-003', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P1', type: 'risk_register', title: 'Strategic Risk Register',
    user_order: 3, status: 'complete',
    content: {
      rows: [
        { id: 'r1', risk: 'SACU revenue decline reduces fiscal space', likelihood: 4, impact: 5, score: 20, mitigation: 'Diversify domestic revenue base; broaden VAT base', owner: 'Ministry of Finance' },
        { id: 'r2', risk: 'Climate shock to sugar sector', likelihood: 3, impact: 4, score: 12, mitigation: 'Crop diversification grants; irrigation infrastructure', owner: 'MoANR' },
        { id: 'r3', risk: 'Political resistance to SOE reform', likelihood: 3, impact: 3, score: 9, mitigation: 'Stakeholder engagement programme; phased approach', owner: 'Cabinet Secretariat' },
      ],
    },
    created_at: '2025-01-20T08:00:00Z', updated_at: '2025-02-10T14:00:00Z',
  },
  {
    id: 'act-004', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P1', type: 'stakeholder_map', title: 'Stakeholder Mapping',
    user_order: 4, status: 'complete',
    content: {
      internal: 'Cabinet; Ministry of Finance; Ministry of Economic Planning; EDA board',
      external: 'IMF; World Bank; SADC Secretariat; Private sector federation; NGO coalitions',
      strategy: 'Quarterly briefings for cabinet. Annual consultation with private sector. Biannual donor coordination meetings.',
    },
    created_at: '2025-01-22T08:00:00Z', updated_at: '2025-02-12T10:00:00Z',
  },
  {
    id: 'act-005', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P1', type: 'competitive_analysis', title: 'Regional Competitiveness Analysis',
    user_order: 5, status: 'complete',
    content: {
      competitors: 'Lesotho (textiles hub)\nBotswana (diamond processing)\nMozambique (port logistics)',
      positioning: 'Landlocked but centrally located within SACU; preferential EU/US trade access',
      differentiators: 'Political stability; skilled English-speaking workforce; low corporate tax rate',
    },
    created_at: '2025-01-25T08:00:00Z', updated_at: '2025-02-15T10:00:00Z',
  },
  {
    id: 'act-006', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P1', type: 'market_analysis', title: 'Sector Market Analysis',
    user_order: 6, status: 'in_progress', due_date: overdueDate,
    content: { content: 'Ongoing: sugar, textiles, tourism, and ICT sectors.' },
    created_at: '2025-02-01T08:00:00Z', updated_at: '2025-06-01T08:00:00Z',
  },
  // Plan 001 — P2
  {
    id: 'act-007', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P2', type: 'vision_mission', title: 'Vision & Mission Statement',
    user_order: 1, status: 'complete',
    content: {
      vision: 'A prosperous, diversified and inclusive Eswatini economy by 2030.',
      mission: 'To coordinate and catalyse sustainable economic development through evidence-based policy, strategic investment, and inclusive partnerships.',
      values: 'Integrity · Innovation · Accountability · Inclusion · Excellence',
    },
    created_at: '2025-02-20T08:00:00Z', updated_at: '2025-03-01T10:00:00Z',
  },
  {
    id: 'act-008', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P2', type: 'strategic_objectives', title: 'Strategic Objectives 2025–2027',
    user_order: 2, status: 'complete',
    content: {
      objectives: '1. Reduce youth unemployment from 38% to 28% by 2027\n2. Increase non-SACU government revenue by 20%\n3. Attract E500M in FDI across priority sectors\n4. Digitise 80% of public service touchpoints',
      rationale: 'Objectives derived from SWOT and PESTLE findings. Aligned to Eswatini National Development Plan 2019–2022 priorities.',
    },
    created_at: '2025-03-01T08:00:00Z', updated_at: '2025-03-15T10:00:00Z',
  },
  {
    id: 'act-009', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P2', type: 'kpi_framework', title: 'KPI Framework',
    user_order: 3, status: 'complete',
    content: {
      rows: [
        { id: 'k1', name: 'Youth unemployment rate', unit: '%', baseline: '38', target: '28', current: '35' },
        { id: 'k2', name: 'Non-SACU revenue growth', unit: '%', baseline: '0', target: '20', current: '7' },
        { id: 'k3', name: 'FDI attracted', unit: 'E million', baseline: '0', target: '500', current: '120' },
        { id: 'k4', name: 'Digitised public services', unit: '%', baseline: '15', target: '80', current: '28' },
        { id: 'k5', name: 'New formal sector jobs', unit: 'count', baseline: '0', target: '15000', current: '3200' },
      ],
    },
    created_at: '2025-03-10T08:00:00Z', updated_at: '2025-04-01T10:00:00Z',
  },
  {
    id: 'act-010', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P2', type: 'strategic_initiatives', title: 'Priority Strategic Initiatives',
    user_order: 4, status: 'in_progress', due_date: soonDate,
    content: {
      content: 'Five priority initiatives identified: textile sector upgrade; agri-processing clusters; e-government platform; tourism corridor; SME financing facility.',
      notes: 'Initiative charters to be completed by Q3 2025.',
    },
    created_at: '2025-03-20T08:00:00Z', updated_at: '2025-05-20T10:00:00Z',
  },
  {
    id: 'act-011', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P2', type: 'value_proposition', title: 'Investor Value Proposition',
    user_order: 5, status: 'under_review', due_date: overdueDate,
    content: {
      customer: 'Foreign and domestic investors in manufacturing, agro-processing, and digital services',
      problem: 'Limited awareness of Eswatini as investment destination; perceived risk',
      solution: 'One-stop investment facilitation; streamlined approvals; incentives package',
      differentiator: 'Political stability, AGOA/EU EPA access, English-speaking skilled workforce, lowest corporate tax in SADC',
    },
    created_at: '2025-04-01T08:00:00Z', updated_at: '2025-05-10T14:00:00Z',
  },
  // Plan 001 — P3
  {
    id: 'act-012', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P3', type: 'operational_roadmap', title: 'Year 1 Operational Roadmap',
    user_order: 1, status: 'complete',
    content: {
      q1: 'Establish PMO; appoint initiative leads; sign MoUs with 3 anchor investors',
      q2: 'Launch SME financing facility; publish investment guide; begin e-gov Phase 1',
      q3: 'Textile upgrade programme operational; tourism corridor launch event',
      q4: 'Mid-term review; Q4 KPI report; Year 2 planning begins',
    },
    created_at: '2025-04-10T08:00:00Z', updated_at: '2025-04-30T10:00:00Z',
  },
  {
    id: 'act-013', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P3', type: 'budget_allocation', title: 'Budget Allocation 2025',
    user_order: 2, status: 'complete',
    content: {
      content: 'Total allocation: E42M. PMO operations: E3M. Textile upgrade: E12M. Agri-processing: E8M. e-Government: E10M. Tourism corridor: E6M. SME fund: E3M.',
      notes: 'Supplementary budget request for E8M pending parliamentary approval.',
    },
    created_at: '2025-04-15T08:00:00Z', updated_at: '2025-05-01T10:00:00Z',
  },
  {
    id: 'act-014', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P3', type: 'resource_plan', title: 'Human Resource Plan',
    user_order: 3, status: 'in_progress', due_date: futureDate,
    content: { content: 'Headcount plan in progress. PMO team of 8 confirmed. Sector leads TBD.' },
    created_at: '2025-04-20T08:00:00Z', updated_at: '2025-05-15T10:00:00Z',
  },
  {
    id: 'act-015', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P3', type: 'action_items', title: 'Q2 2025 Action Items',
    user_order: 4, status: 'in_progress', due_date: soonDate,
    content: {
      actions: '1. Finalise PMO ToR and post positions\n2. Negotiate anchor investor MoUs\n3. Procure e-gov platform vendor',
      owners: '1. HR Directorate\n2. EDA CEO\n3. ICT Ministry',
      blockers: 'Procurement committee quorum issue delaying vendor selection',
    },
    created_at: '2025-04-25T08:00:00Z', updated_at: '2025-06-01T08:00:00Z',
  },
  {
    id: 'act-016', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P3', type: 'procurement_plan', title: 'Procurement Plan',
    user_order: 5, status: 'not_started', due_date: futureDate,
    content: {},
    created_at: '2025-05-01T08:00:00Z', updated_at: '2025-05-01T08:00:00Z',
  },
  {
    id: 'act-017', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P3', type: 'implementation_timeline', title: 'Gantt — Full 3-Year Timeline',
    user_order: 6, status: 'not_started',
    content: {},
    created_at: '2025-05-01T08:00:00Z', updated_at: '2025-05-01T08:00:00Z',
  },
  {
    id: 'act-018', plan_id: 'plan-001', org_id: 'org-001',
    phase: 'P3', type: 'financial_projections', title: 'Financial Projections 2025–2027',
    user_order: 7, status: 'not_started',
    content: {},
    created_at: '2025-05-05T08:00:00Z', updated_at: '2025-05-05T08:00:00Z',
  },
]

// ─── Activity Links (cross-phase dependency graph) ───────────────────────────
// link_type: 'auto' (system-inferred from content references), 'manual'
// (user-drawn), 'ai_suggested' (Ollama-proposed during drafting).

export const MOCK_ACTIVITY_LINKS: import('../types').ActivityLink[] = [
  // SWOT (P1) feeds Strategic Objectives (P2) — auto-detected
  { id: 'link-001', plan_id: 'plan-001', source_id: 'act-001', target_id: 'act-008', link_type: 'auto', created_by: 'user-001', created_at: '2025-03-01T08:00:00Z' },
  // PESTLE (P1) feeds Strategic Objectives (P2)
  { id: 'link-002', plan_id: 'plan-001', source_id: 'act-002', target_id: 'act-008', link_type: 'auto', created_by: 'user-001', created_at: '2025-03-01T08:05:00Z' },
  // Risk Register (P1) feeds Strategic Initiatives (P2) — AI suggested
  { id: 'link-003', plan_id: 'plan-001', source_id: 'act-003', target_id: 'act-010', link_type: 'ai_suggested', created_by: 'user-001', created_at: '2025-03-20T08:00:00Z' },
  // Stakeholder Map (P1) feeds Investor Value Proposition (P2)
  { id: 'link-004', plan_id: 'plan-001', source_id: 'act-004', target_id: 'act-011', link_type: 'manual', created_by: 'user-002', created_at: '2025-04-01T08:00:00Z' },
  // Competitive Analysis (P1) feeds Value Proposition (P2)
  { id: 'link-005', plan_id: 'plan-001', source_id: 'act-005', target_id: 'act-011', link_type: 'auto', created_by: 'user-001', created_at: '2025-04-01T08:10:00Z' },
  // Market Analysis (P1, still in_progress) feeds Strategic Initiatives (P2) — shows a link from an incomplete source
  { id: 'link-006', plan_id: 'plan-001', source_id: 'act-006', target_id: 'act-010', link_type: 'ai_suggested', created_by: 'user-001', created_at: '2025-05-15T08:00:00Z' },

  // Strategic Objectives (P2) feeds KPI Framework (P2) — same-phase link
  { id: 'link-007', plan_id: 'plan-001', source_id: 'act-008', target_id: 'act-009', link_type: 'auto', created_by: 'user-001', created_at: '2025-03-10T08:00:00Z' },
  // Strategic Objectives (P2) feeds Operational Roadmap (P3)
  { id: 'link-008', plan_id: 'plan-001', source_id: 'act-008', target_id: 'act-012', link_type: 'auto', created_by: 'user-001', created_at: '2025-04-10T08:00:00Z' },
  // KPI Framework (P2) feeds Action Items (P3) — direct P2 -> P3 skip
  { id: 'link-009', plan_id: 'plan-001', source_id: 'act-009', target_id: 'act-015', link_type: 'manual', created_by: 'user-002', created_at: '2025-04-25T08:00:00Z' },
  // Strategic Initiatives (P2, in_progress) feeds Budget Allocation (P3) — demonstrates a P3 task already linked to an unfinished P2 driver
  { id: 'link-010', plan_id: 'plan-001', source_id: 'act-010', target_id: 'act-013', link_type: 'ai_suggested', created_by: 'user-001', created_at: '2025-04-15T08:00:00Z' },
  // Value Proposition (P2, under_review) feeds Resource Plan (P3)
  { id: 'link-011', plan_id: 'plan-001', source_id: 'act-011', target_id: 'act-014', link_type: 'manual', created_by: 'user-002', created_at: '2025-04-20T08:00:00Z' },

  // Operational Roadmap (P3) feeds Budget Allocation (P3) — same-phase
  { id: 'link-012', plan_id: 'plan-001', source_id: 'act-012', target_id: 'act-013', link_type: 'auto', created_by: 'user-001', created_at: '2025-04-12T08:00:00Z' },
  // Operational Roadmap (P3) feeds Implementation Timeline (P3, not_started) — shows downstream not-started node
  { id: 'link-013', plan_id: 'plan-001', source_id: 'act-012', target_id: 'act-017', link_type: 'auto', created_by: 'user-001', created_at: '2025-04-12T08:05:00Z' },
  // Budget Allocation (P3) feeds Financial Projections (P3, not_started)
  { id: 'link-014', plan_id: 'plan-001', source_id: 'act-013', target_id: 'act-018', link_type: 'manual', created_by: 'user-002', created_at: '2025-05-01T08:00:00Z' },
  // Resource Plan (P3) feeds Action Items (P3)
  { id: 'link-015', plan_id: 'plan-001', source_id: 'act-014', target_id: 'act-015', link_type: 'auto', created_by: 'user-001', created_at: '2025-04-22T08:00:00Z' },
  // Action Items (P3) feeds Procurement Plan (P3, not_started)
  { id: 'link-016', plan_id: 'plan-001', source_id: 'act-015', target_id: 'act-016', link_type: 'ai_suggested', created_by: 'user-001', created_at: '2025-05-02T08:00:00Z' },
]

export const MOCK_REPORTS: Report[] = [
  {
    id: 'rpt-001',
    plan_id: 'plan-001',
    org_id: 'org-001',
    type: 'executive_summary',
    format: 'pdf',
    file_path: '/reports/plan-001-exec-summary.pdf',
    generated_by: 'user-001',
    generated_at: '2025-05-15T09:00:00Z',
  },
  {
    id: 'rpt-002',
    plan_id: 'plan-001',
    org_id: 'org-001',
    type: 'progress_status',
    format: 'xlsx',
    file_path: '/reports/plan-001-progress.xlsx',
    generated_by: 'user-002',
    generated_at: '2025-06-01T14:30:00Z',
  },
]
