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

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ minimumRole }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useAuthStore((s) => s.user?.role)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (minimumRole && role && ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minimumRole]) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

export default ProtectedRoute
