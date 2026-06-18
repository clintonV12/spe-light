# StratPlan / SPE-LIGHT — Backend API

> Self-hosted strategic planning and execution platform — P1 · P2 · P3 phases, generative AI, multi-tenant, offline-capable.

This README covers the **Go backend API only**. The React frontend (`web/`) is owned by a separate developer/track and is intentionally out of scope here — this document focuses on what the API provides so the frontend can integrate against it.

---

## Implementation status

| Sprint | Scope | Status |
|--------|-------|--------|
| **Sprint 1** | Auth, multi-tenancy, org/user management, platform admin console | ✅ Implemented |
| **Sprint 2** | Plans, activities, activity links, progress tracking | ✅ Implemented |
| **Sprint 3** | AI drafting (Ollama), report generation, milestones, notifications | 🚧 Stubbed (returns `501 Not Implemented`) |
| SSO (SAML/OIDC) | Enterprise identity | 🚧 Schema exists (`sso_configs`); no service/handler yet |
| Offline sync | SQLite cache, sync queue | 🚧 Schema exists (`sync_queue`); frontend-driven, not started server-side |

Routes that exist but aren't built yet return `501` rather than `404`, so the frontend can distinguish "not built" from "wrong URL."

---

## What is StratPlan?

StratPlan helps organisations create, manage, and track multi-phase strategic plans. Plans are divided into three phases:

| Phase | Purpose | Examples |
|-------|---------|---------|
| **P1 — Analysis** | Understand the current state | SWOT, PESTLE, Business Model Canvas, Risk Register |
| **P2 — Strategy** | Define the desired future state | Vision & Mission, KPI Framework, OKRs, Strategic Objectives |
| **P3 — Operations** | Plan how to get there | Roadmap, Budget, Resource Plan, Action Items |

Activities in any phase can be created in any order — phase is a label, not a sequencing constraint. `user_order` tracks creation sequence for display purposes.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.22 + [Chi](https://github.com/go-chi/chi) router |
| Database | PostgreSQL 15+ |
| Auth | JWT (access + refresh) · bcrypt |
| Email | SMTP relay via [go-mail](https://github.com/wneessen/go-mail) (stdout in dev) |
| AI runtime (Sprint 3) | [Ollama](https://ollama.ai) — llama3 8B or mistral 7B |

---

## Quick start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET to a random 32+ char string in production.
# SMTP settings are optional for local dev (emails print to stdout).

# 2. Start Postgres (adjust to your local setup)
docker run -d --name stratplan-db -e POSTGRES_USER=stratplan \
  -e POSTGRES_PASSWORD=stratplan -e POSTGRES_DB=stratplan \
  -p 5432:5432 postgres:16

# 3. Run database migrations (requires the golang-migrate CLI)
export DATABASE_URL=postgres://stratplan:stratplan@localhost:5432/stratplan?sslmode=disable
migrate -path ./migrations -database "$DATABASE_URL" up

# 4. Fetch dependencies and run
# go.sum is intentionally not committed yet — this generates it from go.mod.
go mod tidy
go run ./cmd/server

# 5. Verify
curl http://localhost:8080/health
# → {"status":"ok","time":"..."}
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `APP_ENV` | `development` | `development` or `production` |
| `APP_URL` | `http://localhost:8080` | Public base URL (used in invite/reset emails) |
| `DATABASE_URL` | `postgres://...` | PostgreSQL connection string |
| `JWT_SECRET` | *(must set in prod)* | Min 32 chars |
| `JWT_ACCESS_EXPIRY_MIN` | `15` | Access token TTL in minutes |
| `JWT_REFRESH_EXPIRY_DAYS` | `30` | Refresh token TTL in days |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL (Sprint 3) |
| `OLLAMA_MODEL` | `llama3` | Model name (Sprint 3) |
| `SMTP_HOST` | `localhost` | Leave as `localhost` to log emails to stdout in dev |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` / `SMTP_PASSWORD` | | SMTP credentials |
| `SMTP_FROM` | `noreply@stratplan.local` | From address for transactional emails |

---

## Database migrations

Plain SQL files in `migrations/`, run with [golang-migrate](https://github.com/golang-migrate/migrate/tree/master/cmd/migrate):

```bash
migrate -path ./migrations -database "$DATABASE_URL" up      # apply all
migrate -path ./migrations -database "$DATABASE_URL" down 1  # roll back one
migrate -path ./migrations -database "$DATABASE_URL" version # check current version
```

| Migration | Adds |
|-----------|------|
| `001_initial_schema` | All core tables: organisations, users, SSO, tokens, invitations, plans, activities, links, milestones, reports, notification log, sync queue, audit log |
| `002_row_level_security` | PostgreSQL RLS policies enforcing org-level tenant isolation as a defense-in-depth layer on top of application-level filtering. **Not yet wired into the connection pool** — see `internal/database/rls.go` for the integration note and required follow-up work. |
| `003_nullable_org_id_for_platform_users` | Bug fix found during integration testing: `users.org_id` was `NOT NULL`, which made it impossible to create a `super_admin`/`platform_support` user without artificially homing them in an org — defeating the cross-org design intent. Relaxes the constraint for platform-tier roles only, via a `CHECK` constraint, and adds a partial unique index so platform-tier emails are still globally unique. `models.User.OrgID` is now `*uuid.UUID` to match. |

---

## Project structure

```
spe-light/
├── cmd/
│   └── server/
│       └── main.go                  Entry point — config, DB, router, graceful shutdown
├── internal/
│   ├── auditlog/
│   │   └── auditlog.go              Immutable audit trail writer (best-effort)
│   ├── auth/
│   │   └── auth.go                  bcrypt, JWT issue/parse, opaque token generation, HMAC signing
│   ├── config/
│   │   └── config.go                Environment config loader + validation
│   ├── database/
│   │   ├── db.go                    pgxpool connection + health check
│   │   └── rls.go                   RLS session-variable helper (integration pending)
│   ├── email/
│   │   └── email.go                 SMTP service + inline HTML templates (6 transactional emails)
│   ├── handlers/                    HTTP layer — thin: decode → call service → encode
│   │   ├── admin.go                 Platform admin console (orgs, org invites)
│   │   ├── auth.go                  Login, refresh, logout, password reset, invite accept
│   │   ├── email_factory.go         Router-side email service constructor
│   │   ├── health.go                GET /health
│   │   ├── org.go                   Org admin — users + invitations
│   │   ├── plan.go                  Plans, activities, progress, links
│   │   └── router.go                All route definitions + middleware wiring
│   ├── middleware/
│   │   └── auth.go                  JWT auth, RBAC, in-memory login rate limiter
│   ├── models/
│   │   └── models.go                All domain structs + enums
│   ├── response/
│   │   └── response.go              JSON envelope helpers, request body decoding
│   └── services/                    Business logic — DB queries live here, not in handlers
│       ├── admin/service.go         Cross-org operations (super_admin / platform_support)
│       ├── auth/service.go          Login, token rotation, password reset, invite acceptance
│       ├── org/                     Org-scoped user + invitation management
│       │   ├── names.go
│       │   └── service.go
│       └── plan/                    Plans, activities, links, progress metrics (Sprint 2)
│           ├── assigned.go
│           └── service.go
├── migrations/
│   ├── 001_initial_schema.up.sql / .down.sql
│   └── 002_row_level_security.up.sql / .down.sql
├── .env.example
└── go.mod
```

---

## API reference

This section is a quick overview. For full request/response shapes, every error message, edge cases, and known gaps per-endpoint, see:

- **[`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)** — complete endpoint-by-endpoint reference
- **[`docs/AUTH_AND_CONVENTIONS.md`](docs/AUTH_AND_CONVENTIONS.md)** — token lifecycle, full RBAC matrix, integration recipes
- **[`docs/stratplan.postman_collection.json`](docs/stratplan.postman_collection.json)** — importable Postman collection with chained auth variables, covering every route below


All endpoints are prefixed `/api/v1` except `/health`, `/auth/*`, and `/invitations/accept`. Authenticated endpoints require `Authorization: Bearer <access_token>`.

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check |
| `POST` | `/auth/login` | Email + password login. Rate-limited (10 attempts / 5 min / IP). |
| `POST` | `/auth/refresh` | Rotate refresh token, get a new pair |
| `POST` | `/auth/logout` | Revoke the presented refresh token |
| `POST` | `/auth/password-reset/request` | Always returns 200 (no enumeration) |
| `POST` | `/auth/password-reset/confirm` | Consume reset token, set new password, revoke all sessions |
| `POST` | `/invitations/accept` | Accept an invite token, create the user account, returns tokens |

### Org admin (`org_admin` only)

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/v1/org/users` | List users in caller's org |
| `PATCH`  | `/api/v1/org/users/{userID}` | Update role and/or active status |
| `GET`    | `/api/v1/org/invitations` | List invitations |
| `POST`   | `/api/v1/org/invitations` | Send a user invite |
| `DELETE` | `/api/v1/org/invitations/{invitationID}` | Cancel a pending invite |
| `POST`   | `/api/v1/org/invitations/{invitationID}/resend` | Resend with a fresh token |

### Platform admin (`super_admin` read+write, `platform_support` read-only)

| Method | Path | Description |
|--------|------|-------------|
| `GET`   | `/api/v1/admin/orgs` | List all organisations (`?active_only=true&limit=&offset=`) |
| `POST`  | `/api/v1/admin/orgs` | Create an org directly (super_admin) |
| `PATCH` | `/api/v1/admin/orgs/{orgID}` | Update an org; deactivating revokes all its users' sessions (super_admin) |
| `POST`  | `/api/v1/admin/org-invitations` | Invite a new org admin contact, creates a pending org (super_admin) |

### Plans (`planner`+ to write, all org roles to read — viewers may be plan-scoped)

| Method   | Path | Description |
|----------|------|-------------|
| `GET`    | `/api/v1/plans` | List plans for caller's org (respects plan-scoped viewer grants) |
| `POST`   | `/api/v1/plans` | Create a plan |
| `GET`    | `/api/v1/plans/{planID}` | Get a single plan |
| `PUT`    | `/api/v1/plans/{planID}` | Partial update (title, description, status, dates) |
| `DELETE` | `/api/v1/plans/{planID}` | Soft-delete plan + its activities (`org_admin` only) |
| `GET`    | `/api/v1/plans/{planID}/activities` | List activities, optional `?phase=P1\|P2\|P3` |
| `POST`   | `/api/v1/plans/{planID}/activities` | Create an activity |
| `GET`    | `/api/v1/plans/{planID}/progress` | Per-phase + overall completion %, overdue counts, milestone stats |

### Activities

| Method | Path | Description |
|--------|------|-------------|
| `PUT`  | `/api/v1/activities/{activityID}` | Update title/status/content/assignees/due date. `contributor` may only update activities assigned to them (enforced server-side). |
| `POST` | `/api/v1/activities/{activityID}/links` | Link two activities within the same plan (`auto`/`manual`/`ai_suggested`) |

### Not yet implemented (Sprint 3+, returns `501`)

`POST /api/v1/ai/draft`, `POST /api/v1/ai/summary`, `POST /api/v1/plans/{planID}/reports`, `GET /api/v1/reports/{jobID}`

---

## Role system

Two tiers — Platform and Organisation.

**Platform tier** (cross-org, no `org_id` in JWT):

| Role | Capabilities |
|------|-----------------|
| `super_admin` | Create/update/deactivate orgs, invite org admins, full admin console |
| `platform_support` | Read-only across all orgs (`GET /api/v1/admin/orgs` only) |

**Organisation tier** (scoped to one org via `org_id` claim):

| Role | Capabilities |
|------|-----------------|
| `org_admin` | Manage users, invitations; full plan/activity CRUD; delete plans |
| `planner` | Create/edit plans and activities, link activities |
| `contributor` | Edit only activities assigned to them; read everything else |
| `viewer` | Read-only; can be scoped to specific plans via `plan_viewers` |

---

## Security notes for integrators

- **Token enumeration resistance**: login and password-reset-request return deliberately generic responses regardless of whether the account/email exists.
- **Session invalidation**: deactivating a user or an org immediately revokes all its refresh tokens server-side; the access token still works until its 15-minute TTL expires (by design — there's no server-side access-token revocation list in v1).
- **Rate limiting**: `/auth/login` is limited to 10 attempts per 5 minutes per IP, in-memory only. This resets on server restart and does not coordinate across multiple instances — replace with a Redis-backed limiter before running more than one API instance behind a load balancer.
- **Row-level security**: migration `002` adds Postgres RLS policies as defense-in-depth, but the connection-pool integration (`SET app.current_org_id`) is not yet wired into the request path — see `internal/database/rls.go` for the documented gap and suggested approach. Every service method already filters by `org_id` explicitly, so this is not a current vulnerability, just an extra layer not yet activated.
- **Audit log**: `internal/auditlog` is wired into the highest-value mutations (role changes, user/org deactivation, plan deletion). Extend `auditlog.Record` calls into additional service methods as new sensitive operations are added — it's a single function call, best-effort, and never blocks the request on failure.

---

## Verification

This implementation was integration-tested end-to-end against a real PostgreSQL 16 instance (not just compiled) before delivery: migrations applied cleanly, and the full request lifecycle was exercised — login, token issuance/refresh, plan and activity creation across non-sequential phases, progress aggregation with overdue detection, activity linking with self-link rejection, RBAC enforcement for every role tier (including the `platform_support` read-only restriction), user/org deactivation with session revocation, audit log writes, login rate limiting, and the `users.org_id` nullability fix described above (migration 003).

## Known gaps / next steps for whoever picks this up

1. **SSO service** — the `sso_configs` table and `SSOConfig` model exist; no service or handler layer yet. Needed for `PUT /api/v1/org/sso`.
2. **RLS wiring** — see security notes above.
3. **Milestones CRUD** — table and model exist (`Milestone`), consumed read-only by `GetProgress`; no create/update endpoints yet.
4. **Multi-instance rate limiting** — current limiter is single-process in-memory.
5. **Sprint 3**: Ollama client, AI draft/summary endpoints, report generation (PDF/docx/xlsx), notification log writer, sync queue consumer for offline writes.
6. **No seed/bootstrap script** — the very first `super_admin` currently has to be inserted by hand (see the SQL in the verification notes above for the exact shape). Worth adding a `make bootstrap-admin` task or a one-time CLI flag.

---