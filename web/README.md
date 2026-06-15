React + TypeScript frontend for the StratPlan Strategic Planning & Execution Platform.
Built with Vite, Tailwind CSS, Zustand, and React Router.

---

## Quick start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS or 22 | Check with `node --version` |
| npm | 9+ | Comes with Node |
| Go backend | Running on `:8080` | Only needed for real-dev / prod mode |

### Install dependencies

```bash
cd web
npm install
```

---

## Running the app

There are three modes. Pick the one that matches your situation.

### 1. Mock mode — no backend required ✅ (recommended for UI work)

```bash
npm run dev:mock
```

- Opens at **http://localhost:5173**
- Auto-logs you in as **Themba Dlamini (org_admin)**
- All API calls are intercepted by in-memory mock handlers — no network requests made
- Full seed data: 4 plans, 18 activities across all phases, users, invitations, reports
- Any change you make (create plan, update activity, invite user) is reflected immediately in the UI and persists for the session

> **How it works:** `VITE_MOCK=true` is set by `.env.mock`. The API layer in
> `src/api/endpointsImpl.ts` checks this flag at load time and routes every
> call to `src/mocks/handlers.ts` instead of Axios. The login page detects
> mock mode and auto-authenticates without showing the form.

### 2. Real dev mode — backend required

```bash
npm run dev
```

- Opens at **http://localhost:5173**
- Proxies `/api`, `/auth`, `/invitations`, `/health` → `http://localhost:8080`
- Requires the Go backend to be running (see root `README.md`)
- Login with real credentials from your local database

### 3. Production build

```bash
npm run build
```

- Compiles TypeScript and bundles to **`../static/`** (one level up, served by the Go binary)
- Run `npm run preview` to locally preview the production bundle before deploying

---

## Environment files

| File | Used by | Purpose |
|------|---------|---------|
| `.env.mock` | `npm run dev:mock` | Sets `VITE_MOCK=true` |
| `.env.local` | `npm run dev` | Override any variable locally (gitignored) |
| `.env.production` | `npm run build` | Production-time variables |

**Create `.env.mock`** if it doesn't exist:

```bash
# web/.env.mock
VITE_MOCK=true
```

All environment variables exposed to the frontend must be prefixed `VITE_`.

---

## Project structure

```
web/
├── index.html                  # Entry HTML — loads Google Fonts (Inter, Plus Jakarta Sans)
├── vite.config.ts              # Dev proxy → :8080; production output → ../static
├── tailwind.config.js          # Custom design tokens (see Design tokens below)
├── postcss.config.js
├── .env.mock                   # VITE_MOCK=true for mock mode
│
└── src/
    ├── main.tsx                # App bootstrap — installs mocks if VITE_MOCK=true
    ├── App.tsx                 # Router — all routes defined here
    ├── index.css               # Tailwind base/components/utilities imports
    │
    ├── types/
    │   └── index.ts            # All domain types (Plan, Activity, User, Phase, etc.)
    │
    ├── api/
    │   ├── client.ts           # Axios instance + JWT refresh interceptor
    │   ├── endpoints.ts        # Public barrel — import from here in all pages/components
    │   ├── endpointsImpl.ts    # Routes calls to real or mock based on VITE_MOCK
    │   └── realEndpoints.ts    # Actual Axios calls (used when VITE_MOCK is unset)
    │
    ├── store/
    │   ├── auth.ts             # Zustand — user, org, tokens (persisted to localStorage)
    │   ├── offline.ts          # Zustand — sync queue, pending count, online state
    │   └── ui.ts               # Zustand — toasts, sidebar collapsed state
    │
    ├── hooks/
    │   └── index.ts            # useOnlineStatus, useSyncEngine, usePermission, useToast
    │
    ├── mocks/
    │   ├── seed.ts             # Realistic seed data (plans, activities, users, reports)
    │   ├── handlers.ts         # In-memory mock API handlers with simulated delay
    │   ├── mockEndpoints.ts    # Mock implementations matching real endpoint signatures
    │   └── index.ts            # installMocks() — called by main.tsx in mock mode
    │
    ├── i18n/
    │   ├── index.ts            # i18next setup
    │   └── locales/
    │       ├── en.json         # English (default)
    │       ├── fr.json         # French
    │       └── pt.json         # Portuguese
    │
    ├── components/
    │   ├── ui/
    │   │   ├── index.tsx       # Button, Badge, Input, Select, Card, ProgressBar, EmptyState
    │   │   └── ToastContainer.tsx
    │   ├── layout/
    │   │   ├── AppShell.tsx    # Collapsible sidebar, top bar, offline banner, sync trigger
    │   │   └── ProtectedRoute.tsx  # Role-aware auth guard
    │   ├── plans/
    │   │   └── CreatePlanModal.tsx
    │   ├── activities/
    │   │   ├── ActivityCard.tsx
    │   │   ├── CreateActivityModal.tsx
    │   │   └── editors/
    │   │       ├── SwotEditor.tsx          # 4-quadrant live editor
    │   │       ├── KpiEditor.tsx           # Tabular baseline / target / current
    │   │       ├── RiskRegisterEditor.tsx  # Likelihood × impact scoring
    │   │       └── GenericEditor.tsx       # Free-text sections fallback
    │   ├── ai/
    │   │   └── AiDraftPanel.tsx   # Keyword → Ollama → accept / retry / discard
    │   └── admin/
    │       └── InviteUserModal.tsx
    │
    └── pages/
        ├── LoginPage.tsx           # Split-panel login; auto-signs in during mock mode
        ├── AcceptInvitePage.tsx    # Invitation accept flow with password setup
        ├── DashboardPage.tsx       # Stat cards, recent plans grid, overdue alert
        ├── PlansPage.tsx           # Sortable table, filters, context menus
        ├── PlanDetailPage.tsx      # Phase tabs (P1/P2/P3), activity list
        ├── ActivityEditorPage.tsx  # Type-routed editor + AI panel + save state
        ├── ProgressPage.tsx        # Phase breakdown bars, per-plan progress cards
        ├── ReportsPage.tsx         # Generate form, job polling, download, history
        └── AdminPage.tsx           # Members tab + Invitations tab
```

---

## Design tokens

All tokens live in `tailwind.config.js`. Use them directly in className strings.

### Colours

| Token | Hex | Use |
|-------|-----|-----|
| `ink-900` | `#0F1117` | Primary text, sidebar background |
| `ink-50` | `#F4F5F7` | Page background |
| `ink-100–800` | — | Borders, muted text, cards |
| `accent` | `#4B6BFB` | Buttons, links, active nav |
| `accent-50–100` | — | Accent backgrounds |
| `p1` / `p1-light` / `p1-dark` | Amber | Phase 1 (Analysis) badges and bars |
| `p2` / `p2-light` / `p2-dark` | Green | Phase 2 (Strategy) badges and bars |
| `p3` / `p3-light` / `p3-dark` | Purple | Phase 3 (Operations) badges and bars |

### Typography

| Class | Font | Use |
|-------|------|-----|
| `font-sans` | Inter | Body text, UI labels (default) |
| `font-display` | Plus Jakarta Sans | Page headings, logo |

---

## Adding a new page

1. Create `src/pages/YourPage.tsx`
2. Add a lazy import in `App.tsx`:
   ```tsx
   const YourPage = lazy(() => import('./pages/YourPage'))
   ```
3. Add the route inside the `<ProtectedRoute>` block:
   ```tsx
   <Route path="/your-path" element={<Suspense fallback={<PageLoader />}><YourPage /></Suspense>} />
   ```
4. Add a nav item in `src/components/layout/AppShell.tsx` if it needs a sidebar link

---

## Adding a new API call

1. Add the real Axios call to `src/api/realEndpoints.ts`
2. Add a matching mock implementation to `src/mocks/mockEndpoints.ts`
3. Add the delegating wrapper to `src/api/endpointsImpl.ts`
4. Export it from `src/api/endpoints.ts` (the barrel file pages import from)

---

## Role-based access

Roles in descending order of permission: `super_admin` → `platform_support` → `org_admin` → `planner` → `contributor` → `viewer`.

**In components**, use the `usePermission` hook:

```tsx
import { usePermission } from '../hooks'

const { can, hasRole } = usePermission()

// Pre-built permission flags
can.createPlan      // planner+
can.editActivity    // contributor+
can.runAI           // planner+
can.generateReports // planner+
can.manageUsers     // org_admin+
can.manageOrgs      // super_admin only

// Or check a minimum role directly
hasRole('org_admin') // true if current user is org_admin or above
```

**In routes**, wrap with `<ProtectedRoute minimumRole="org_admin" />` — unauthorized users are redirected to `/dashboard`.

---

## State management

| Store | File | What it holds |
|-------|------|---------------|
| Auth | `store/auth.ts` | `user`, `org`, `accessToken`, `refreshToken`, `isAuthenticated` — persisted to localStorage |
| Offline | `store/offline.ts` | `isOnline`, `queue`, `pendingCount`, `isSyncing` — persisted to localStorage |
| UI | `store/ui.ts` | `toasts`, `sidebarCollapsed` — session only |

Import and use with Zustand selectors:
```tsx
import { useAuthStore } from '../store/auth'
const user = useAuthStore((s) => s.user)
```

---

## Mock mode — details for contributors

The mock layer lives entirely in `src/mocks/`. It is **never included in production builds** — `endpointsImpl.ts` only imports from `src/mocks/` when `VITE_MOCK === 'true'`, which is never true in `npm run build`.

### Seed data (`mocks/seed.ts`)

Contains: 1 organisation, 4 users (org_admin, planner, contributor, deactivated viewer), 3 invitations, 4 plans with realistic progress data, 18 activities across all phases and types, 2 historical reports.

### Handlers (`mocks/handlers.ts`)

All handlers simulate ~350ms network delay. Mutations are applied to module-level arrays and are visible immediately within the same session. Refreshing the page resets to seed data.

### Adding mock data

Add records directly to the arrays in `mocks/seed.ts`. The `recomputeProgress()` function in `handlers.ts` automatically recalculates plan progress from the activity list, so you don't need to set progress manually.

---

## Useful commands

```bash
npm run dev          # Dev server with real backend proxy (port 5173)
npm run dev:mock     # Dev server with in-memory mocks — no backend needed
npm run build        # Production build → ../static/
npm run preview      # Preview production build locally
npm run lint         # ESLint
```

---

## Common issues

**`502 Bad Gateway` on login**
You're running `npm run dev` (real mode) without the Go backend running. Either start the backend on `:8080` or use `npm run dev:mock`.

**Login page shows instead of dashboard in mock mode**
The `.env.mock` file is missing. Create it at `web/.env.mock` with `VITE_MOCK=true`, then restart the dev server.

**Tailwind classes not applying**
Run `npm install` to ensure all dev dependencies are present, then restart the dev server. Tailwind v3 is used (not v4).

**TypeScript errors after adding a new file**
Run `npm run build` to see all TS errors at once. The dev server only reports errors for files it has compiled.

**Changes to mock seed data not showing**
Vite hot-reloads modules but Zustand store state is retained across HMR. Open DevTools → Application → Local Storage → clear `stratplan-auth`, then hard-refresh.