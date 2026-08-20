/**
 * pages/OrgPickerPage.tsx — landing page for the `advisor` role.
 *
 * An advisor has no organisation of their own (org_id is nil on their
 * user row, same as super_admin / platform_support — see
 * internal/models.RoleAdvisor). Before they can see any org's plans,
 * activities, or reports, they pick which organisation to act in here.
 * That choice is purely client-side state (advisorApi.enterOrg just sets
 * the X-Org-Context header sent on every subsequent request — see
 * api/client.ts's advisorOrgStore) — nothing is persisted server-side
 * about "this advisor is currently looking at this org."
 *
 * Routing integration (not wired here — App.tsx/routes.tsx wasn't
 * provided): after login, if user.role === 'advisor' and
 * advisorApi.currentOrgId() is null, redirect here instead of the normal
 * dashboard. Once enterOrg() is called, redirect into the app exactly as
 * an org_admin would land. A persistent "Advising: {orgName} · Exit"
 * banner somewhere in the app shell should call advisorApi.exitOrg() and
 * route back here.
 */
import { useEffect, useMemo, useState } from 'react'
import { Building2, Plus, Search, ArrowRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { adminApi, advisorApi } from '../api/endpoints'
import type { Organisation } from '../types'

export default function OrgPickerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    adminApi.listOrgs({ active_only: true })
      .then(setOrgs)
      .catch(() => setError(t('orgPicker.loadError', 'Could not load organisations.')))
      .finally(() => setLoading(false))
  }, [t])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orgs
    return orgs.filter((o) => o.name.toLowerCase().includes(q))
  }, [orgs, query])

  function enter(org: Organisation) {
    advisorApi.enterOrg(org.id)
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center size-12 rounded-2xl bg-accent-50 text-accent-700 mb-4">
            <Building2 className="size-6" />
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            {t('orgPicker.title', 'Which organisation are you advising today?')}
          </h1>
          <p className="text-sm text-ink-500 mt-1.5">
            {t('orgPicker.subtitle', 'Pick an existing organisation, or set up a new one.')}
          </p>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('orgPicker.searchPlaceholder', 'Search organisations…') as string}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-white text-sm
                         text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2
                         focus:ring-accent-300 focus:border-accent-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-ink-900 text-white
                       text-sm font-medium hover:bg-ink-800 transition-colors whitespace-nowrap"
          >
            <Plus className="size-4" />
            {t('orgPicker.newOrg', 'New organisation')}
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-white rounded-2xl border border-ink-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-ink-500">
            {query
              ? t('orgPicker.noMatches', 'No organisations match "{{query}}".', { query })
              : t('orgPicker.none', 'No organisations yet — create the first one.')}
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  onClick={() => enter(org)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl
                             bg-white border border-ink-100 hover:border-accent-300 hover:bg-accent-50/40
                             transition-colors text-left group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0 inline-flex items-center justify-center size-9 rounded-xl bg-ink-100 text-ink-500">
                      <Building2 className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900 truncate">{org.name}</p>
                      {org.industry && <p className="text-xs text-ink-400 truncate">{org.industry}</p>}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-ink-300 group-hover:text-accent-600 transition-colors shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateOrgModal
          onClose={() => setShowCreate(false)}
          onCreated={(org) => {
            setShowCreate(false)
            enter(org)
          }}
        />
      )}
    </div>
  )
}

function CreateOrgModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (org: Organisation) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) {
      setError(t('orgPicker.nameRequired', 'Organisation name is required.'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const org = await adminApi.createOrg({ name: name.trim(), industry: industry.trim() || undefined })
      onCreated(org)
    } catch {
      setError(t('orgPicker.createError', 'Could not create the organisation. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-ink-900/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold text-ink-900">
            {t('orgPicker.createTitle', 'New organisation')}
          </h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X className="size-5" />
          </button>
        </div>

        <label className="block text-xs font-medium text-ink-500 mb-1.5">
          {t('orgPicker.orgName', 'Organisation name')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm mb-3
                     focus:outline-none focus:ring-2 focus:ring-accent-300 focus:border-accent-400"
        />

        <label className="block text-xs font-medium text-ink-500 mb-1.5">
          {t('orgPicker.industry', 'Industry (optional)')}
        </label>
        <input
          type="text"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm mb-4
                     focus:outline-none focus:ring-2 focus:ring-accent-300 focus:border-accent-400"
        />

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-ink-600 hover:bg-ink-50"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-ink-900 text-white
                       hover:bg-ink-800 disabled:opacity-50 transition-colors"
          >
            {saving ? t('common.creating', 'Creating…') : t('orgPicker.createAndEnter', 'Create & enter')}
          </button>
        </div>
      </div>
    </div>
  )
}