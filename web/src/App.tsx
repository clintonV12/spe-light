import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ProtectedRoute from './components/layout/ProtectedRoute'
import { useOnlineStatus } from './hooks'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AcceptInvitePage from './pages/AcceptInvitePage'

const DashboardPage      = lazy(() => import('./pages/DashboardPage'))
const PlansPage          = lazy(() => import('./pages/PlansPage'))
const PlanDetailPage     = lazy(() => import('./pages/PlanDetailPage'))
const ActivityEditorPage = lazy(() => import('./pages/ActivityEditorPage'))
const ReportsPage        = lazy(() => import('./pages/ReportsPage'))
const AdminPage          = lazy(() => import('./pages/AdminPage'))
const PlatformAdminPage  = lazy(() => import('./pages/PlatformAdminPage'))
// Advisor-only landing page — pick or create the org to act in. Lives
// outside AppShell (no sidebar/nav chrome — see OrgPickerPage.tsx's own
// full-screen layout) but still inside the outer auth-only ProtectedRoute
// below, since it requires being logged in, just not any particular org.
const OrgPickerPage      = lazy(() => import('./pages/OrgPickerPage'))
// In-app documentation (API reference, and any future user guides) — see
// src/docs/ and DOC_REGISTRY in DocsPage.tsx. Public route (see below) —
// not just "no role gate," genuinely reachable without signing in at all.
const DocsPage            = lazy(() => import('./pages/DocsPage'))
// Self-service account page — same component serves org-tier and
// platform-tier users alike (GET/PATCH /api/v1/me carries no role gate),
// so it lives at the top level next to Dashboard rather than under either
// role-gated /admin or /platform-admin subtree.
const ProfilePage        = lazy(() => import('./pages/ProfilePage'))

const IS_MOCK = import.meta.env.VITE_MOCK === 'true'

const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <span className="size-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
  </div>
)

function OnlineStatusInit() {
  useOnlineStatus()
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <OnlineStatusInit />
      <Routes>
        {/* In mock mode /login goes straight to dashboard — store is already authed */}
        <Route
          path="/login"
          element={IS_MOCK ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />
        {/* Account recovery — public, no Bearer token required (mirrors
            /auth/password-reset/* on the backend, which is public for the
            same reason: the visitor doesn't have a session yet). */}
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invitations/accept" element={<AcceptInvitePage />} />
        {/* Docs are public on purpose — someone evaluating the platform, or
            an admin troubleshooting from outside a logged-in session,
            shouldn't have to sign in just to read the API reference. Lives
            outside ProtectedRoute/AppShell entirely (so it renders with no
            sidebar for a logged-out visitor); DocsPage renders its own
            lightweight header instead, with a "Back to dashboard" link when
            an authenticated user's session happens to still be active in
            this browser (see useAuthStore usage in DocsPage.tsx) or a
            "Sign in" link when it isn't. */}
        <Route path="/docs" element={<Suspense fallback={<PageLoader />}><DocsPage /></Suspense>} />

        <Route element={<ProtectedRoute />}>
          {/* Must be registered before ProtectedRoute's advisor-without-org
              check has anywhere to send someone — without this route,
              that redirect and the catch-all's redirect to /dashboard
              ping-pong forever ("Maximum update depth exceeded"). Sibling
              of the AppShell subtree, not nested inside it — no
              sidebar/nav while picking an org. */}
          <Route path="/org-picker" element={<Suspense fallback={<PageLoader />}><OrgPickerPage /></Suspense>} />
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"   element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
            <Route path="/plans"       element={<Suspense fallback={<PageLoader />}><PlansPage /></Suspense>} />
            <Route path="/plans/:planId" element={<Suspense fallback={<PageLoader />}><PlanDetailPage /></Suspense>} />
            <Route path="/plans/:planId/activities/:activityId" element={<Suspense fallback={<PageLoader />}><ActivityEditorPage /></Suspense>} />
            <Route path="/reports"     element={<Suspense fallback={<PageLoader />}><ReportsPage /></Suspense>} />
            {/* No role gate — every authenticated user, org-tier or
                platform-tier, manages their own account here. */}
            <Route path="/profile"     element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />
            <Route element={<ProtectedRoute minimumRole="org_admin" />}>
              <Route path="/admin"     element={<Suspense fallback={<PageLoader />}><AdminPage /></Suspense>} />
            </Route>
            {/* Platform tier — auth-gated here, role-gated inside PlatformAdminPage itself
                (see note above re: ProtectedRoute's hierarchy semantics). */}
            <Route element={<ProtectedRoute minimumRole="platform_support" />}>
              <Route path="/platform-admin" element={<Suspense fallback={<PageLoader />}><PlatformAdminPage /></Suspense>} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}