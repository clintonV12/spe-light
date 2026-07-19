import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input, Select } from '../ui'
import { orgApi, plansApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Plan, UserRole } from '../../types'

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'planner',     label: 'Planner' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'viewer',      label: 'Viewer' },
  { value: 'org_admin',   label: 'Org Admin' },
]

interface InviteUserModalProps {
  onInvited: () => void
  onClose: () => void
}

export const InviteUserModal: React.FC<InviteUserModalProps> = ({ onInvited, onClose }) => {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('contributor')
  const [loading, setLoading] = useState(false)
  const { success, error } = useToast()

  // Plan scoping — only relevant for viewer invites. Left empty = org-wide
  // viewer (sees every plan); any selection = scoped to just those plans.
  const [plans, setPlans] = useState<Plan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansFetched, setPlansFetched] = useState(false)
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([])

  useEffect(() => {
    // plansFetched (not plans.length > 0) gates the fetch — an org with
    // zero plans would otherwise leave plans.length permanently at 0,
    // making this effect think it never fetched and refire forever.
    if (role !== 'viewer' || plansFetched || plansLoading) return
    setPlansLoading(true)
    plansApi.list()
      .then(setPlans)
      .catch(() => setPlans([]))
      .finally(() => {
        setPlansLoading(false)
        setPlansFetched(true)
      })
  }, [role, plansFetched, plansLoading])

  const togglePlan = (planId: string) => {
    setSelectedPlanIds((prev) =>
      prev.includes(planId) ? prev.filter((id) => id !== planId) : [...prev, planId]
    )
  }

  const handleSubmit = async () => {
    if (!email.trim()) return
    setLoading(true)
    try {
      await orgApi.sendInvitation({
        email: email.trim(),
        role,
        // Only send plan_ids for viewer invites with an actual selection —
        // any other role ignores it server-side anyway, and an empty/omitted
        // array means "org-wide" for viewers.
        ...(role === 'viewer' && selectedPlanIds.length > 0 ? { plan_ids: selectedPlanIds } : {}),
      })
      success(`Invitation sent to ${email}`)
      onInvited()
      onClose()
    } catch {
      error('Failed to send invitation')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">Invite team member</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            label="Email address"
            type="email"
            placeholder="colleague@organisation.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={role}
            onChange={(e) => {
              const nextRole = e.target.value as UserRole
              setRole(nextRole)
              if (nextRole !== 'viewer') setSelectedPlanIds([])
            }}
          />

          {role === 'viewer' && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700">
                Plan access <span className="text-ink-400 font-normal">(optional)</span>
              </label>
              {plansLoading ? (
                <div className="h-20 rounded-xl bg-ink-50 animate-pulse" />
              ) : plans.length === 0 ? (
                <p className="text-xs text-ink-400">
                  No plans yet — this viewer will have org-wide access once plans exist.
                </p>
              ) : (
                <>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-ink-200 divide-y divide-ink-100">
                    {plans.map((plan) => (
                      <label
                        key={plan.id}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 cursor-pointer hover:bg-ink-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlanIds.includes(plan.id)}
                          onChange={() => togglePlan(plan.id)}
                          className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                        />
                        <span className="truncate">{plan.title}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-ink-400">
                    {selectedPlanIds.length > 0
                      ? `Scoped to ${selectedPlanIds.length} plan${selectedPlanIds.length !== 1 ? 's' : ''}.`
                      : 'Leave unchecked for org-wide viewer access to all plans.'}
                  </p>
                </>
              )}
            </div>
          )}

          <p className="text-xs text-ink-400">
            An invitation link valid for 72 hours will be sent to this address.
          </p>
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" loading={loading} disabled={!email.trim()} onClick={handleSubmit}>
            Send invite
          </Button>
        </div>
      </div>
    </div>
  )
}

export default InviteUserModal