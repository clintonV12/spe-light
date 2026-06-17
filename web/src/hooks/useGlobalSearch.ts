import { useState, useCallback, useRef } from 'react'
import { plansApi, activitiesApi } from '../api/endpoints'
import type { Plan, Activity } from '../types'

export type SearchResultKind = 'plan' | 'activity' | 'page'

export interface SearchResult {
  kind: SearchResultKind
  id: string
  title: string
  subtitle: string
  path: string
  phase?: 'P1' | 'P2' | 'P3'
  badge?: string
}

const STATIC_PAGES: SearchResult[] = [
  { kind: 'page', id: 'page-dashboard', title: 'Dashboard', subtitle: 'Overview & stats',        path: '/dashboard' },
  { kind: 'page', id: 'page-plans',     title: 'Plans',     subtitle: 'All strategic plans',      path: '/plans' },
  { kind: 'page', id: 'page-progress',  title: 'Progress',  subtitle: 'Phase tracking & network',  path: '/progress' },
  { kind: 'page', id: 'page-reports',   title: 'Reports',   subtitle: 'Generate & download',       path: '/reports' },
  { kind: 'page', id: 'page-admin',     title: 'Admin',     subtitle: 'Team & invitations',         path: '/admin' },
]

function typeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim()
  const t = target.toLowerCase()
  if (!q) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.includes(q)) return 50
  // Loose subsequence match as a fallback
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length ? 20 : 0
}

export function useGlobalSearch() {
  const [isIndexing, setIsIndexing] = useState(false)
  const [indexReady, setIndexReady] = useState(false)
  const plansRef = useRef<Plan[]>([])
  const activitiesRef = useRef<Array<Activity & { planTitle: string }>>([])

  const buildIndex = useCallback(async () => {
    if (indexReady || isIndexing) return
    setIsIndexing(true)
    try {
      const plans = await plansApi.list()
      plansRef.current = plans

      const activityLists = await Promise.all(
        plans.map((p) =>
          activitiesApi.list(p.id).then((acts) =>
            acts.map((a) => ({ ...a, planTitle: p.title })),
          ).catch(() => []),
        ),
      )
      activitiesRef.current = activityLists.flat()
      setIndexReady(true)
    } finally {
      setIsIndexing(false)
    }
  }, [indexReady, isIndexing])

  const search = useCallback((query: string): SearchResult[] => {
    const q = query.trim()
    if (!q) {
      return STATIC_PAGES.slice(0, 5)
    }

    const results: Array<SearchResult & { score: number }> = []

    // Pages
    STATIC_PAGES.forEach((page) => {
      const score = Math.max(fuzzyScore(q, page.title), fuzzyScore(q, page.subtitle) * 0.6)
      if (score > 0) results.push({ ...page, score })
    })

    // Plans
    plansRef.current.forEach((plan) => {
      const score = Math.max(
        fuzzyScore(q, plan.title),
        plan.description ? fuzzyScore(q, plan.description) * 0.5 : 0,
      )
      if (score > 0) {
        results.push({
          kind: 'plan',
          id: plan.id,
          title: plan.title,
          subtitle: `Plan · ${plan.status}`,
          path: `/plans/${plan.id}`,
          badge: plan.status,
          score,
        })
      }
    })

    // Activities
    activitiesRef.current.forEach((act) => {
      const score = Math.max(
        fuzzyScore(q, act.title),
        fuzzyScore(q, typeLabel(act.type)) * 0.7,
        fuzzyScore(q, act.planTitle) * 0.4,
      )
      if (score > 0) {
        results.push({
          kind: 'activity',
          id: act.id,
          title: act.title,
          subtitle: `${act.phase} · ${typeLabel(act.type)} · ${act.planTitle}`,
          path: `/plans/${act.plan_id}/activities/${act.id}`,
          phase: act.phase,
          score,
        })
      }
    })

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ score, ...r }) => r)
  }, [])

  return { buildIndex, search, isIndexing, indexReady }
}
