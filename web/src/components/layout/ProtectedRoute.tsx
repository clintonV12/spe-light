import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import type { UserRole } from '../../types'

interface ProtectedRouteProps {
  minimumRole?: UserRole
}

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  platform_support: 80,
  org_admin: 60,
  planner: 40,
  contributor: 20,
  viewer: 10,
}

// Platform-tier roles have no org_id and no access to org-scoped pages —
// they're a separate axis from the org-tier ladder above, not a superset of
// it, even though their ROLE_HIERARCHY numbers happen to be higher (that
// ranking is only meaningful for org-tier-vs-org-tier and
// platform-tier-vs-platform-tier comparisons).
const PLATFORM_ROLES: UserRole[] = ['super_admin', 'platform_support']

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ minimumRole }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useAuthStore((s) => s.user?.role)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const isPlatformTier = role ? PLATFORM_ROLES.includes(role) : false
  const gateIsOrgTier = minimumRole ? !PLATFORM_ROLES.includes(minimumRole) : false

  // A platform-tier user hitting an org-tier gate (e.g. /admin, minimumRole
  // "org_admin") would otherwise pass on numeric rank alone (platform_support
  // = 80 > org_admin = 60) and land on a page where every API call 403s,
  // since the backend requires an exact org-tier role plus an org_id they
  // don't have. Send them to their own console instead.
  if (isPlatformTier && gateIsOrgTier) {
    return <Navigate to="/platform-admin" replace />
  }

  if (minimumRole && role && ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minimumRole]) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

export default ProtectedRoute