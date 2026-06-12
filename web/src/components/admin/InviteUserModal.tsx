import React, { useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input, Select } from '../ui'
import { orgApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { UserRole } from '../../types'

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

  const handleSubmit = async () => {
    if (!email.trim()) return
    setLoading(true)
    try {
      await orgApi.sendInvitation({ email: email.trim(), role })
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
            onChange={(e) => setRole(e.target.value as UserRole)}
          />
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
