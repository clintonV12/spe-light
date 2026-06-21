# StratPlan / SPE-LIGHT — Backend API

> Self-hosted strategic planning and execution platform — P1 · P2 · P3 phases, generative AI, multi-tenant, offline-capable.

This README covers the **Go backend API only**. The React frontend (`web/`) is out of scope here.

---

## Implementation status

| Sprint | Scope | Status |
|--------|-------|--------|
| **Sprint 1** | Auth, multi-tenancy, org/user management, platform admin | ✅ Complete |
| **Sprint 2** | Plans, activities, activity links, progress tracking | ✅ Complete |
| **Sprint B** | Milestones CRUD, plan-scoped viewer wiring, cycle detection, auth fixes | ✅ Complete |
| **Sprint A** | SSO config endpoints, link listing, auto-link detection, RLS wiring, completeness score | ✅ Complete (SSO auth flows pending — see below) |
| **Sprint A (SSO flows)** | SAML ACS, OIDC callback, JIT provisioning | 🚧 `501` — library integration next |
| **Sprint C** | AI drafting (Ollama), AI summary | 🚧 `501` stubs wired |
| **Sprint D** | Report generation (PDF/docx/xlsx), link graph completion | 🚧 `501` stubs wired |
| **Sprint E** | Notifications (overdue/milestone/role), bulk ops, plan duplication | 🔲 Not started |
| **Sprint F** | Offline sync (SQLite/sync queue), ops hardening | 🔲 Not started |
| SSO auth flows | SAML 2.0 + OIDC + JIT provisioning | 🚧 Config endpoints ✅; authentication flows next |

Routes that exist but aren't built return `501` so the frontend can distinguish "not built" from "wrong URL."

---

## What is StratPlan?

StratPlan helps organisations create, manage, and track multi-phase strategic plans:

| Phase | Purpose | Examples |
|-------|---------|---------|
| **P1 — Analysis** | Understand the current state | SWOT, PESTLE, Business Model Canvas, Risk Register |
| **P2 — Strategy** | Define the desired future state | Vision & Mission, KPI Framework, OKRs, Strategic Objectives |
| **P3 — Operations** | Plan how to get there | Roadmap, Budget, Resource Plan, Action Items |

Activities in any phase can be created in any order — phase is a label, not a sequencing constraint.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.22 + [Chi](https://github.com/go-chi/chi) router |
| Database | PostgreSQL 15+ |
| Auth | JWT (access + refresh) · bcrypt · SAML/OIDC (config ready, flows next) |
| Email | SMTP via [go-mail](https://github.com/wneessen/go-mail) (stdout in dev) |
| AI runtime (Sprint C) | [Ollama](https://ollama.ai) — llama3 8B or mistral 7B |

---

## Quick start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET to a 32+ char random string in production.

# 2. Start Postgres
docker run -d --name stratplan-db \
  -e POSTGRES_USER=stratplan -e POSTGRES_PASSWORD=stratplan -e POSTGRES_DB=stratplan \
  -p 5432:5432 postgres:16

# 3. Run the server (migrations run automatically on startup)
export DATABASE_URL=postgres://stratplan:stratplan@localhost:5432/stratplan?sslmode=disable
go mod tidy
go run ./cmd/server

# 4. Create the first super_admin (one-time)
go run ./cmd/seed

# 5. Verify
curl http://localhost:8080/health
# → {"status":"ok","time":"..."}
```

> **Note:** `cmd/seed/main.go` creates a `super_admin` with `org_id = NULL` (correct per migration 003). Override credentials with `SEED_EMAIL` and `SEED_PASSWORD` env vars. Run it only once, or re-run to reset the password.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `APP_ENV` | `development` | `development` or `production` |
| `APP_URL` | `http://localhost:8080` | Public base URL (used in emails) |
| `DATABASE_URL` | `postgres://...` | PostgreSQL connection string |
| `JWT_SECRET` | *(must set in prod)* | Min 32 chars |
| `JWT_ACCESS_EXPIRY_MIN` | `15` | Access token TTL (minutes) |
| `JWT_REFRESH_EXPIRY_DAYS` | `30` | Refresh token TTL (days) |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API (Sprint C) |
| `OLLAMA_MODEL` | `llama3` | Model name (Sprint C) |
| `SMTP_HOST` | `localhost` | Leave as `localhost` to log emails to stdout in dev |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` / `SMTP_PASSWORD` | | SMTP credentials |
| `SMTP_FROM` | `noreply@stratplan.local` | From address |

---

## Database migrations

Migrations run **automatically on startup** as of Sprint A. No manual CLI step required.

To run manually or roll back:
```bash
migrate -path ./migrations -database "$DATABASE_URL" up
migrate -path ./migrations -database "$DATABASE_URL" down 1
migrate -path ./migrations -database "$DATABASE_URL" version
```

| Migration | Description |
|-----------|-------------|
| `001_initial_schema` | All core tables |
| `002_row_level_security` | PostgreSQL RLS policies (now wired into request path via `middleware.WithRLS`) |
| `003_nullable_org_id_for_platform_users` | `users.org_id` nullable for `super_admin`/`platform_support` |

---

## Project structure

```
spe-light/
├── cmd/
│   ├── server/
│   │   └── main.go                  Entry point — JSON logging, auto-migrations, graceful shutdown
│   └── seed/
│       └── main.go                  Bootstrap super_admin (run once)
├── internal/
│   ├── auditlog/
│   │   └── auditlog.go              Immutable audit trail writer
│   ├── auth/
│   │   └── auth.go                  bcrypt, JWT, opaque tokens, HMAC signing
│   ├── config/
│   │   └── config.go                Env config loader
│   ├── database/
│   │   ├── db.go                    pgxpool connection
│   │   └── rls.go                   RLS session-variable helper (now wired via middleware)
│   ├── email/
│   │   └── email.go                 SMTP service + HTML templates
│   ├── handlers/                    HTTP layer (decode → service → encode)
│   │   ├── admin.go                 Platform admin (orgs, org invites)
│   │   ├── auth.go                  Login, refresh, logout, password reset, invite accept
│   │   ├── email_factory.go         Email service constructor for router
│   │   ├── health.go                GET /health
│   │   ├── links.go                 ✨ Sprint A: list plan links, list activity links, auto-links
│   │   ├── milestone.go             Sprint B: milestone CRUD
│   │   ├── org.go                   Org admin — users + invitations
│   │   ├── plan.go                  Plans, activities, progress
│   │   ├── plan_viewer.go           Sprint B: grant/revoke plan-scoped viewer access
│   │   ├── router.go                All route definitions + middleware wiring
│   │   └── sso.go                   ✨ Sprint A: GET/PUT/DELETE /api/v1/org/sso
│   ├── middleware/
│   │   ├── auth.go                  JWT auth, RBAC, rate limiter
│   │   └── rls.go                   ✨ Sprint A: per-request RLS connection + org context
│   ├── models/
│   │   └── models.go                All domain structs + enums
│   ├── response/
│   │   └── response.go              JSON envelope helpers
│   └── services/
│       ├── admin/service.go         Cross-org platform operations
│       ├── auth/service.go          Login, tokens, password reset, invite acceptance
│       ├── milestone/service.go     Sprint B: milestone CRUD
│       ├── org/
│       │   ├── names.go
│       │   └── service.go           Org-scoped user + invitation management
│       ├── plan/
│       │   ├── activity_plan.go     ✨ Sprint A: activity→plan lookup helper
│       │   ├── assigned.go          IsAssigned helper for contributor gate
│       │   ├── completeness.go      ✨ Sprint A: plan completeness score (REQ-F-044)
│       │   ├── cycle_check.go       Sprint B: BFS cycle prevention (REQ-F-042)
│       │   ├── links.go             ✨ Sprint A: ListLinks + AutoDetectLinks (REQ-F-040)
│       │   ├── plan_viewer.go       Sprint B: GrantPlanViewer / RevokePlanViewer
│       │   └── service.go           Plans, activities, progress, link creation
│       └── sso/
│           └── service.go           ✨ Sprint A: SSO config CRUD
├── migrations/
│   ├── 001_initial_schema.{up,down}.sql
│   ├── 002_row_level_security.{up,down}.sql
│   └── 003_nullable_org_id_for_platform_users.{up,down}.sql
├── docs/
│   ├── API_REFERENCE.md
│   ├── AUTH_AND_CONVENTIONS.md
│   └── stratplan.postman_collection.json
├── .env.example
└── go.mod
```

---

## API overview

Full request/response shapes: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)
Auth lifecycle + RBAC: [`docs/AUTH_AND_CONVENTIONS.md`](docs/AUTH_AND_CONVENTIONS.md)
Postman collection: [`docs/stratplan.postman_collection.json`](docs/stratplan.postman_collection.json)

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check |
| `POST` | `/auth/login` | Login. Rate-limited (10/5min/IP). |
| `POST` | `/auth/refresh` | Rotate refresh token |
| `POST` | `/auth/logout` | Revoke refresh token |
| `POST` | `/auth/password-reset/request` | Always 200 |
| `POST` | `/auth/password-reset/confirm` | Set new password, revoke all sessions |
| `POST` | `/invitations/accept` | Accept invite, create account, return tokens |
| `GET`  | `/auth/saml/{orgSlug}/metadata` | SAML SP metadata `[501]` |
| `POST` | `/auth/saml/{orgSlug}/acs` | SAML ACS `[501]` |
| `GET`  | `/auth/oidc/{orgSlug}/login` | OIDC redirect `[501]` |
| `GET`  | `/auth/oidc/{orgSlug}/callback` | OIDC callback `[501]` |

### Org admin (`org_admin`)

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/v1/org/users` | List users |
| `PATCH`  | `/api/v1/org/users/{userID}` | Update role / active status |
| `GET`    | `/api/v1/org/invitations` | List invitations |
| `POST`   | `/api/v1/org/invitations` | Send invite |
| `DELETE` | `/api/v1/org/invitations/{invitationID}` | Cancel invite |
| `POST`   | `/api/v1/org/invitations/{invitationID}/resend` | Resend invite |
| `GET`    | `/api/v1/org/sso` | Get SSO config ✨ |
| `PUT`    | `/api/v1/org/sso` | Create/replace SSO config ✨ |
| `DELETE` | `/api/v1/org/sso` | Remove SSO config ✨ |

### Platform admin (`super_admin` r/w, `platform_support` read)

| Method | Path | Description |
|--------|------|-------------|
| `GET`   | `/api/v1/admin/orgs` | List all orgs |
| `POST`  | `/api/v1/admin/orgs` | Create org |
| `PATCH` | `/api/v1/admin/orgs/{orgID}` | Update org |
| `POST`  | `/api/v1/admin/org-invitations` | Invite new org admin |

### Plans (all roles read; `planner`+ write)

| Method   | Path | Description |
|----------|------|-------------|
| `GET`    | `/api/v1/plans` | List plans |
| `POST`   | `/api/v1/plans` | Create plan |
| `GET`    | `/api/v1/plans/{planID}` | Get plan |
| `PUT`    | `/api/v1/plans/{planID}` | Update plan |
| `DELETE` | `/api/v1/plans/{planID}` | Soft-delete (`org_admin`) |
| `GET`    | `/api/v1/plans/{planID}/activities` | List activities |
| `POST`   | `/api/v1/plans/{planID}/activities` | Create activity |
| `GET`    | `/api/v1/plans/{planID}/progress` | Progress + completeness score ✨ |
| `GET`    | `/api/v1/plans/{planID}/links` | All links for plan ✨ |
| `GET`    | `/api/v1/plans/{planID}/auto-links` | Auto-detected candidate links ✨ |
| `GET`    | `/api/v1/plans/{planID}/milestones` | List milestones ✨ |
| `POST`   | `/api/v1/plans/{planID}/milestones` | Create milestone ✨ |
| `POST`   | `/api/v1/plans/{planID}/viewers` | Grant plan-scoped viewer |
| `DELETE` | `/api/v1/plans/{planID}/viewers/{userID}` | Revoke plan-scoped viewer |

### Activities

| Method | Path | Description |
|--------|------|-------------|
| `PUT`  | `/api/v1/activities/{activityID}` | Update activity |
| `POST` | `/api/v1/activities/{activityID}/links` | Create link (cycle-checked) |
| `GET`  | `/api/v1/activities/{activityID}/links` | List links for activity ✨ |

### Milestones

| Method | Path | Description |
|--------|------|-------------|
| `PUT`    | `/api/v1/milestones/{milestoneID}` | Update milestone |
| `DELETE` | `/api/v1/milestones/{milestoneID}` | Delete milestone (`org_admin`) |

### Not yet implemented (`501`)

`POST /api/v1/ai/draft` · `POST /api/v1/ai/summary` · `POST /api/v1/plans/{planID}/reports` · `GET /api/v1/reports/{jobID}` · SSO auth flows

---

## Security notes

- **Token enumeration resistance:** login and password-reset-request return generic responses regardless of whether the account/email exists.
- **Session invalidation:** deactivating a user or org immediately revokes all refresh tokens; access tokens live out their 15-minute TTL.
- **Circular link prevention:** BFS cycle check added in Sprint B — A→B→C→A is now rejected at link creation.
- **Row-level security:** migration `002` policies are now active — `middleware.WithRLS` acquires a pinned connection per request and sets `app.current_org_id`/`app.bypass_rls` before any query runs. Service methods still query via the pool directly (they need to be migrated to use `middleware.ConnFrom(ctx)` to get full benefit — see `internal/middleware/rls.go` for the migration guide).
- **Rate limiting:** login only, 10/5min/IP, in-memory. Replace with Redis before multi-instance deployment.
- **Audit log:** wired on role changes, user/org deactivation, plan deletion. Extend to other mutations via `auditlog.Record(ctx, db, entry)`.

---

## Known gaps / next steps

1. **SSO auth flows** — `sso_configs` CRUD is live (Sprint A). Next: vendor `crewjam/saml` and `coreos/go-oidc`, implement the four 501-stubbed routes, wire JIT provisioning into `AcceptInvite` or a new `SSOLogin` service method.
2. **RLS full wiring** — `middleware.WithRLS` is active and sets the session variables, but service methods still call `s.db.Query/Exec` directly (pool connections, not the pinned RLS conn). Migrate highest-risk reads first: `ListPlans`, `ListActivities`. See `internal/middleware/rls.go` for the pattern.
3. **Sprint C: AI** — Ollama client (`internal/ai/`), implement `POST /api/v1/ai/draft` and `POST /api/v1/ai/summary`, wire `ai_draft` field on activities, non-blocking job pattern needed (30s responses are too slow for a synchronous HTTP handler).
4. **Sprint D: Reports** — PDF/docx/xlsx generation, `GET /api/v1/reports/{jobID}` polling. Needs an async job mechanism.
5. **Sprint E: Notifications** — email triggers for overdue activities (needs a background sweeper), milestone reached, role changed, user deactivated. `email.SendRoleChanged` is implemented but never called. `notification_log` table exists but is never written to.
6. **Rate-limit window** — spec says 10/minute; code does 10/5-minute. Confirm which is correct and align the other.
7. **Multi-instance rate limiting** — current limiter is per-process. Replace with Redis before running multiple API instances.
8. **`logo_url` settable** — field exists in the org model and schema but no endpoint sets it. Needed for branded reports in Sprint D.
9. **Completeness score tuning** — weights (60/30/10) are hardcoded in `completeness.go`. Consider exposing as config once stakeholders have used it for a cycle.