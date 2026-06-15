import { useEffect, useState } from 'react'
import { UserPlus, RefreshCw, MoreHorizontal, ShieldCheck, Shield, Eye, Users, Mail } from 'lucide-react'
import { orgApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import { Badge } from '../components/ui'
import InviteUserModal from '../components/admin/InviteUserModal'
import type { User, Invitation, UserRole } from '../types'

type Tab = 'users' | 'invitations'

const ROLE_META: Record<UserRole, { label: string; icon: React.ReactNode; variant: 'neutral' | 'p1' | 'p2' | 'p3' | 'success' }> = {
  super_admin:      { label: 'Super admin',       icon: <ShieldCheck className="size-3.5" />, variant: 'p3' },
  platform_support: { label: 'Platform support',  icon: <Shield className="size-3.5" />,      variant: 'p1' },
  org_admin:        { label: 'Org admin',          icon: <ShieldCheck className="size-3.5" />, variant: 'p2' },
  planner:          { label: 'Planner',            icon: <Shield className="size-3.5" />,      variant: 'success' },
  contributor:      { label: 'Contributor',        icon: <Users className="size-3.5" />,        variant: 'neutral' },
  viewer:           { label: 'Viewer',             icon: <Eye className="size-3.5" />,          variant: 'neutral' },
}

function UserRowMenu({ user, currentUserId, onToggleActive, onChangeRole }: {
  user: User
  currentUserId: string
  onToggleActive: () => void
  onChangeRole: (role: UserRole) => void
}) {
  const [open, setOpen] = useState(false)
  if (user.id === currentUserId) return null

  const roles: UserRole[] = ['planner', 'contributor', 'viewer', 'org_admin']

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg text-ink-300 hover:text-ink-700 hover:bg-ink-50 transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-ink-100 bg-white shadow-lg py-1">
            <p className="px-3 py-1.5 text-xs font-semibold text-ink-400 uppercase tracking-wide">Change role</p>
            {roles.map((r) => (
              <button
                key={r}
                onClick={() => { onChangeRole(r); setOpen(false) }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors ${
                  user.role === r ? 'text-accent bg-accent-50' : 'text-ink-700 hover:bg-ink-50'
                }`}
              >
                {ROLE_META[r].icon} {ROLE_META[r].label}
              </button>
            ))}
            <div className="my-1 border-t border-ink-100" />
            <button
              onClick={() => { onToggleActive(); setOpen(false) }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm ${
                user.is_active ? 'text-red-600 hover:bg-red-50' : 'text-p2-dark hover:bg-p2-light'
              }`}
            >
              {user.is_active ? 'Deactivate user' : 'Reactivate user'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadUsers = async () => {
    try {
      const [u, inv] = await Promise.all([orgApi.listUsers(), orgApi.listInvitations()])
      setUsers(u)
      setInvitations(inv)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { loadUsers() }, [])

  const handleToggleActive = async (user: User) => {
    setActionLoading(user.id)
    try { await orgApi.updateUser(user.id, { is_active: !user.is_active }); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const handleChangeRole = async (user: User, role: UserRole) => {
    setActionLoading(user.id)
    try { await orgApi.updateUser(user.id, { role }); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const handleCancelInvite = async (inv: Invitation) => {
    setActionLoading(inv.id)
    try { await orgApi.cancelInvitation(inv.id); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const handleResendInvite = async (inv: Invitation) => {
    setActionLoading(inv.id)
    try { await orgApi.resendInvitation(inv.id); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const pendingInvitations = invitations.filter((i) => i.status === 'pending')

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Team &amp; access</h1>
          <p className="text-ink-500 text-sm mt-0.5">
            {users.length} member{users.length !== 1 ? 's' : ''} · {pendingInvitations.length} pending invite{pendingInvitations.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
        >
          <UserPlus className="size-4" /> Invite member
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ink-100 rounded-xl p-1 w-fit">
        {([
          { id: 'users', label: 'Members', count: users.length },
          { id: 'invitations', label: 'Invitations', count: pendingInvitations.length },
        ] as { id: Tab; label: string; count: number }[]).map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                tab === id ? 'bg-accent-100 text-accent' : 'bg-ink-200 text-ink-500'
              }`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Users table */}
      {tab === 'users' && (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1,2,3].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-ink-100 bg-ink-50">
                <tr>
                  {['Member', 'Role', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {users.map((user) => {
                  const roleMeta = ROLE_META[user.role]
                  const isSelf = user.id === currentUser?.id
                  return (
                    <tr key={user.id} className={`${!user.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-accent-100 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-accent">
                              {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-900">
                              {user.name} {isSelf && <span className="text-ink-400 font-normal">(you)</span>}
                            </p>
                            <p className="text-xs text-ink-400">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={roleMeta.variant}>
                          <span className="flex items-center gap-1">{roleMeta.icon} {roleMeta.label}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-medium ${user.is_active ? 'text-p2-dark' : 'text-ink-400'}`}>
                          {user.is_active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {actionLoading === user.id ? (
                          <RefreshCw className="size-4 text-ink-300 animate-spin inline-block" />
                        ) : (
                          <UserRowMenu
                            user={user}
                            currentUserId={currentUser?.id ?? ''}
                            onToggleActive={() => handleToggleActive(user)}
                            onChangeRole={(r) => handleChangeRole(user, r)}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Invitations table */}
      {tab === 'invitations' && (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1,2].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}
            </div>
          ) : invitations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Mail className="size-9 text-ink-200 mb-3" />
              <p className="text-sm font-semibold text-ink-500">No invitations sent yet</p>
              <p className="text-xs text-ink-400 mt-1">Invite team members to get started.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-ink-100 bg-ink-50">
                <tr>
                  {['Email', 'Role', 'Status', 'Expires', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {invitations.map((inv) => {
                  const roleMeta = ROLE_META[inv.role]
                  const isPending = inv.status === 'pending'
                  const expired = new Date(inv.expires_at) < new Date()
                  return (
                    <tr key={inv.id} className={!isPending ? 'opacity-60' : ''}>
                      <td className="px-4 py-3.5">
                        <p className="text-sm text-ink-800">{inv.email}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={roleMeta.variant}>{roleMeta.label}</Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-medium capitalize ${
                          inv.status === 'accepted' ? 'text-p2-dark'
                          : inv.status === 'pending' && !expired ? 'text-p1-dark'
                          : 'text-ink-400'
                        }`}>
                          {expired && isPending ? 'Expired' : inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs text-ink-400">
                          {new Date(inv.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {actionLoading === inv.id ? (
                          <RefreshCw className="size-4 text-ink-300 animate-spin inline-block" />
                        ) : isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleResendInvite(inv)}
                              className="text-xs text-accent hover:text-accent-700 font-medium"
                            >
                              Resend
                            </button>
                            <button
                              onClick={() => handleCancelInvite(inv)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showInvite && (
        <InviteUserModal onInvited={loadUsers} onClose={() => setShowInvite(false)} />
      )}
    </div>
  )
}
