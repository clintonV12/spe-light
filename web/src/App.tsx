import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ProtectedRoute from './components/layout/ProtectedRoute'
import { useOnlineStatus } from './hooks'
import LoginPage from './pages/LoginPage'
import AcceptInvitePage from './pages/AcceptInvitePage'

const DashboardPage      = lazy(() => import('./pages/DashboardPage'))
const PlansPage          = lazy(() => import('./pages/PlansPage'))
const PlanDetailPage     = lazy(() => import('./pages/PlanDetailPage'))
const ActivityEditorPage = lazy(() => import('./pages/ActivityEditorPage'))
const ProgressPage       = lazy(() => import('./pages/ProgressPage'))
const ReportsPage        = lazy(() => import('./pages/ReportsPage'))
const AdminPage          = lazy(() => import('./pages/AdminPage'))
const PlatformAdminPage  = lazy(() => import('./pages/PlatformAdminPage'))

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
        <Route path="/invitations/accept" element={<AcceptInvitePage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"   element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
            <Route path="/plans"       element={<Suspense fallback={<PageLoader />}><PlansPage /></Suspense>} />
            <Route path="/plans/:planId" element={<Suspense fallback={<PageLoader />}><PlanDetailPage /></Suspense>} />
            <Route path="/plans/:planId/activities/:activityId" element={<Suspense fallback={<PageLoader />}><ActivityEditorPage /></Suspense>} />
            <Route path="/progress"    element={<Suspense fallback={<PageLoader />}><ProgressPage /></Suspense>} />
            <Route path="/reports"     element={<Suspense fallback={<PageLoader />}><ReportsPage /></Suspense>} />
            <Route element={<ProtectedRoute minimumRole="org_admin" />}>
              <Route path="/admin"     element={<Suspense fallback={<PageLoader />}><AdminPage /></Suspense>} />
            </Route>
            {/* Platform tier — auth-gated here, role-gated inside PlatformAdminPage itself
                (see note above re: ProtectedRoute's hierarchy semantics). */}
            <Route path="/platform-admin" element={<Suspense fallback={<PageLoader />}><PlatformAdminPage /></Suspense>} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}