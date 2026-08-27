import React, { useState } from 'react'
import axios from 'axios'
import { X } from 'lucide-react'
import { Button, Input } from '../ui'
import { plansApi } from '../../api/endpoints'
import { useOfflineStore } from '../../store/offline'
import { useToast } from '../../hooks'
import type { Plan } from '../../types'

// PendingPlan marks a locally-created, not-yet-synced plan — see
// handleSubmit's offline branch below. Consumers (PlansPage's row
// rendering, PlanDetailPage's load()) check this flag to render a
// "syncing" state instead of treating the plan as fully real yet.
export type PendingPlan = Plan & { _pending: true }

interface CreatePlanModalProps {
  /**
   * Called with the created plan — a real one (server round-trip
   * succeeded) or a PendingPlan (queued for later, see below). Changed
   * from a no-arg callback: the caller used to just re-fetch the whole
   * list via plansApi.list(), but that can't ever surface a plan that
   * only exists locally and hasn't synced yet — the server has never
   * heard of it.
   */
  onCreated: (plan: Plan | PendingPlan) => void
  onClose: () => void
}

export const CreatePlanModal: React.FC<CreatePlanModalProps> = ({ onCreated, onClose }) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const { success, info, error } = useToast()

  const handleSubmit = async () => {
    if (!title.trim()) return
    setLoading(true)
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }
    try {
      const plan = await plansApi.create(payload)
      success('Plan created')
      onCreated(plan)
      onClose()
    } catch (err) {
      // Genuine network failure (no response ever received) — the normal
      // create can't happen without a server round trip, but the person
      // shouldn't lose their work or be blocked just because they're
      // offline. Generate a client-side id, queue the real POST for
      // useSyncEngine to replay once back online (see resolveTempId in
      // store/offline.ts, which — once this resolves — rewrites this
      // tempId to the real one everywhere it's still referenced), and
      // hand back a PendingPlan so the caller can render it immediately
      // as if it had succeeded.
      //
      // A real error (validation, auth) is NOT queued — retrying it later
      // would just fail identically — so it falls through to the existing
      // toast-and-stay-open behavior instead.
      if (axios.isAxiosError(err) && !err.response) {
        const tempId = crypto.randomUUID()
        useOfflineStore.getState().enqueue({
          operation: 'create',
          resource: '/plans',
          payload,
          tempId,
        })
        const now = new Date().toISOString()
        // Cast via `unknown` rather than a normal `as PendingPlan` — this
        // file doesn't have types/index.ts's actual Plan shape available,
        // so rather than guess at every field (and risk a wrong guess
        // compiling silently against a structurally-permissive type) this
        // is explicit about only providing the fields every consumer of
        // a PendingPlan actually needs before it resolves to a real,
        // fully-typed Plan from the server: id, title, description,
        // status, the two dates, and the timestamps. Revisit this cast
        // once the real Plan type is in scope here.
        const pendingPlan = {
          id: tempId,
          title: payload.title,
          description: payload.description ?? null,
          status: 'draft',
          start_date: payload.start_date ?? null,
          end_date: payload.end_date ?? null,
          created_at: now,
          updated_at: now,
          org_id: '',
          owner_id: '',
          _pending: true,
        } as unknown as PendingPlan
        info('You\u2019re offline — this plan will sync once you\u2019re back online.')
        onCreated(pendingPlan)
        onClose()
        return
      }
      error('Failed to create plan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">New plan</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            label="Plan title"
            placeholder="e.g. 2026 Organisational Strategy"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Description</label>
            <textarea
              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent resize-none min-h-20"
              placeholder="Brief description of this plan's purpose"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* No more plan-type picker — every plan now uses the same
              Strategic Pillar > Strategic Objective > Activity structure,
              with an optional Advanced Research tab available afterwards
              from the plan view. See migration 014_collapse_plan_types. */}

          <div className="grid grid-cols-2 gap-3">
            <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" loading={loading} disabled={!title.trim()} onClick={handleSubmit}>
            Create plan
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CreatePlanModal