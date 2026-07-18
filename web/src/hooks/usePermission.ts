/**
 * hooks/usePermission.ts
 *
 * Derives UI-level capability flags from the logged-in user's role.
 * These mirror the RequireRole middleware rules in internal/handlers/router.go
 * so the frontend hides actions the backend would reject anyway.
 *
 * IMPORTANT: these flags are for UX only — the backend enforces role checks
 * independently and is the authoritative source of truth. Never skip a
 * server call just because can.X is false; only show/hide UI.
 *
 * Role hierarchy (from models.go):
 *   super_admin > platform_support > org_admin > planner > contributor > viewer
 *
 * Usage:
 *   const { can, role, isPlatform } = usePermission()
 *   if (can.createPlan) { ... }
 */

import { useAuthStore } from '../store/auth'
import type { UserRole } from '../types'

// ── Role hierarchy ────────────────────────────────────────────────────────────

const ROLE_RANK: Record<UserRole, number> = {
  super_admin:      100,
  platform_support:  80,
  org_admin:         60,
  planner:           40,
  contributor:       20,
  viewer:            10,
}

function atLeast(userRole: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minimum]
}

// ── Capability flags ──────────────────────────────────────────────────────────

export interface PermissionSet {
  // Plans
  createPlan:     boolean   // planner+
  editPlan:       boolean   // planner+
  deletePlan:     boolean   // org_admin only
  duplicatePlan:  boolean   // planner+
  managePlanViewers: boolean // org_admin only

  // Activities
  createActivity: boolean   // planner+
  editActivity:   boolean   // contributor+ (own) | planner+ (any)
  deleteActivity: boolean   // planner+

  // Activity links
  createLink:     boolean   // planner+

  // Milestones
  createMilestone: boolean  // planner+
  editMilestone:   boolean  // planner+
  deleteMilestone: boolean  // org_admin only

  // Reports
  generateReport: boolean   // planner+

  // AI features
  runAI:          boolean   // planner+

  // Org admin panel
  manageUsers:    boolean   // org_admin+
  manageSSO:      boolean   // org_admin+
  sendInvite:     boolean   // org_admin+
  viewAuditLog:   boolean   // org_admin+

  // Platform admin
  viewAdminPanel: boolean   // super_admin | platform_support
  createOrg:      boolean   // super_admin only
  deactivateOrg:  boolean   // super_admin only
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePermission(): {
  can:        PermissionSet
  role:       UserRole | null
  isPlatform: boolean
  isOrgUser:  boolean
} {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? null

  if (!role) {
    // Unauthenticated — all false
    const none = Object.fromEntries(
      Object.keys({} as PermissionSet).map((k) => [k, false])
    ) as unknown as PermissionSet

    // Build the full false set explicitly so TS is happy
    const noCan: PermissionSet = {
      createPlan: false, editPlan: false, deletePlan: false,
      duplicatePlan: false, managePlanViewers: false,
      createActivity: false, editActivity: false, deleteActivity: false,
      createLink: false,
      createMilestone: false, editMilestone: false, deleteMilestone: false,
      generateReport: false, runAI: false,
      manageUsers: false, manageSSO: false, sendInvite: false, viewAuditLog: false,
      viewAdminPanel: false, createOrg: false, deactivateOrg: false,
    }
    void none
    return { can: noCan, role: null, isPlatform: false, isOrgUser: false }
  }

  const isPlatform = role === 'super_admin' || role === 'platform_support'
  const isOrgUser  = !isPlatform

  const can: PermissionSet = {
    // Plan CRUD
    createPlan:          atLeast(role, 'planner'),
    editPlan:            atLeast(role, 'planner'),
    deletePlan:          atLeast(role, 'org_admin'),
    duplicatePlan:       atLeast(role, 'planner'),
    managePlanViewers:   atLeast(role, 'org_admin'),

    // Activity CRUD
    createActivity:      atLeast(role, 'planner'),
    editActivity:        atLeast(role, 'contributor'),  // server checks assignment for contributor
    deleteActivity:      atLeast(role, 'planner'),

    // Links
    createLink:          atLeast(role, 'planner'),

    // Milestones
    createMilestone:     atLeast(role, 'planner'),
    editMilestone:       atLeast(role, 'planner'),
    deleteMilestone:     atLeast(role, 'org_admin'),

    // Reports & AI
    generateReport:      atLeast(role, 'planner'),
    runAI:               atLeast(role, 'planner'),

    // Org management
    manageUsers:         atLeast(role, 'org_admin'),
    manageSSO:           atLeast(role, 'org_admin'),
    sendInvite:          atLeast(role, 'org_admin'),
    viewAuditLog:        atLeast(role, 'org_admin'),

    // Platform admin
    viewAdminPanel:      isPlatform,
    createOrg:           role === 'super_admin',
    deactivateOrg:       role === 'super_admin',
  }

  return { can, role, isPlatform, isOrgUser }
}