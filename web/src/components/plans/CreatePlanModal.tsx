import React, { useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input } from '../ui'
import { plansApi } from '../../api/endpoints'
import { useToast } from '../../hooks'

interface CreatePlanModalProps {
  onCreated: () => void
  onClose: () => void
}

export const CreatePlanModal: React.FC<CreatePlanModalProps> = ({ onCreated, onClose }) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const { success, error } = useToast()

  const handleSubmit = async () => {
    if (!title.trim()) return
    setLoading(true)
    try {
      await plansApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      })
      success('Plan created')
      onCreated()
      onClose()
    } catch {
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