# StratPlan / SPE-LIGHT

> Self-hosted strategic planning and execution platform — P1 · P2 · P3 phases, generative AI, multi-tenant, offline-capable.

---

## What is StratPlan?

StratPlan helps organisations create, manage, and track multi-phase strategic plans. Plans are divided into three phases:

| Phase | Purpose | Examples |
|-------|---------|---------|
| **P1 — Analysis** | Understand the current state | SWOT, PESTLE, Business Model Canvas, Risk Register |
| **P2 — Strategy** | Define the desired future state | Vision & Mission, KPI Framework, OKRs, Strategic Objectives |
| **P3 — Operations** | Plan how to get there | Roadmap, Budget, Resource Plan, Action Items |

Activities in any phase can be created in any order — the system links them intelligently without enforcing a rigid sequence.

Generative AI (via [Ollama](https://ollama.ai), running entirely on your server) drafts activities from keywords, suggests KPIs, detects plan gaps, and writes executive summaries.

---

## Key features

- **Multi-tenant** — one installation, many isolated organisations
- **P1 / P2 / P3 plan model** — order-independent activity creation with automatic cross-phase linkage
- **Self-hosted AI** — Ollama with llama3 or mistral; no data leaves your server
- **SSO** — SAML 2.0 and OIDC for enterprise identity providers
- **Email invite system** — GitHub-style invite flow for organisations and users
- **Progress tracking** — per-activity status, phase progress bars, milestone timeline, overdue alerts
- **Report generation** — PDF, Word (.docx), and Excel (.xlsx)
- **Offline-capable** — core features work without connectivity; writes sync on reconnect
- **Multilingual** — English, French, Portuguese at launch; more locales via JSON files
- **Role-based access** — Super admin → Platform support → Org admin → Planner → Contributor → Viewer

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.22 + [Chi](https://github.com/go-chi/chi) router |
| Frontend | React 18 + TypeScript (Vite) |
| Database | PostgreSQL 16 with row-level security |
| Offline cache | SQLite (embedded) |
| AI runtime | [Ollama](https://ollama.ai) — llama3 8B (recommended) or mistral 7B |
| Auth | JWT (access + refresh) · SAML 2.0 · OIDC |
| Email | SMTP relay via [go-mail](https://github.com/wneessen/go-mail) |
| Deployment | Linux binary · Docker Compose · systemd |

---

## Prerequisites

| Requirement | Minimum version | Notes |
|-------------|----------------|-------|
| Go | 1.22 | Backend build |
| Node.js | 20 LTS | Frontend build |
| PostgreSQL | 15 | Primary database |
| Docker + Compose | 24 / 2.x | For containerised setup |
| Ollama | latest | Self-hosted LLM — see [ollama.ai](https://ollama.ai) |
| RAM | 8 GB | Required for llama3 8B; 6 GB minimum for mistral 7B |

---

## Quick start (Docker Compose)

The fastest way to get a working local environment.

```bash
# 1. Clone the repo
git clone https://github.com/your-org/stratplan.git
cd stratplan

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET to a random 32+ char string
# SMTP settings are optional for local dev (emails print to stdout)

# 3. Start Postgres and Ollama
make docker-up

# 4. Pull an AI model (run once — downloads ~5 GB)
make ollama-pull-llama3
# Alternative (faster, smaller): make ollama-pull-mistral

# 5. Run database migrations
export DATABASE_URL=postgres://stratplan:stratplan@localhost:5432/stratplan?sslmode=disable
make migrate-up

# 6. Start the API server
make run

# 7. Verify
curl http://localhost:8080/health
# → {"status":"ok","time":"..."}
```

The API is now running at `http://localhost:8080`.

---

## Local development (without Docker)

```bash
# Start only Postgres and Ollama via Docker, run the app natively
docker compose up -d postgres ollama

# Install Go dependencies
go mod download

# Run migrations
export DATABASE_URL=postgres://stratplan:stratplan@localhost:5432/stratplan?sslmode=disable
make migrate-up

# Start the server with live reload (install air first: go install github.com/air-verse/air@latest)
air
# Or without live reload:
make run

# Frontend (separate terminal)
make web-install
make web-dev
# → http://localhost:5173
```

---

## Environment variables

Copy `.env.example` to `.env` and configure. All variables can also be set as shell environment variables (shell takes priority over `.env`).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `APP_ENV` | `development` | `development` or `production` |
| `APP_URL` | `http://localhost:8080` | Public base URL (used in invite emails) |
| `DATABASE_URL` | `postgres://...` | PostgreSQL connection string |
| `JWT_SECRET` | *(must set)* | Min 32 chars. Change before deploying. |
| `JWT_ACCESS_EXPIRY_MIN` | `15` | Access token TTL in minutes |
| `JWT_REFRESH_EXPIRY_DAYS` | `30` | Refresh token TTL in days |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `llama3` | Model name (`llama3` or `mistral`) |
| `SMTP_HOST` | `localhost` | SMTP server host. Leave as `localhost` to log emails to stdout in dev. |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | | SMTP username |
| `SMTP_PASSWORD` | | SMTP password |
| `SMTP_FROM` | `noreply@stratplan.local` | From address for transactional emails |

---

## Database migrations

Migrations are plain SQL files in `migrations/`. Run them with the [golang-migrate CLI](https://github.com/golang-migrate/migrate/tree/master/cmd/migrate).

```bash
# Apply all pending migrations
make migrate-up

# Roll back the last migration
make migrate-down

# Check current migration version
make migrate-status
```

On Docker, the app does **not** auto-migrate on startup — run `make migrate-up` explicitly after deploying a new version.

---

## Makefile reference

```
make run              Start the API server
make build            Compile binary to bin/stratplan
make test             Run all tests with race detector
make tidy             go mod tidy
make lint             Run golangci-lint

make docker-up        Start Postgres + Ollama + app in Docker
make docker-down      Stop and remove containers
make docker-logs      Tail app container logs

make migrate-up       Apply all pending migrations
make migrate-down     Roll back last migration
make migrate-status   Show current migration version

make ollama-pull-llama3    Pull llama3 model into Ollama
make ollama-pull-mistral   Pull mistral model into Ollama

make web-install      npm install for the frontend
make web-dev          Start Vite dev server (port 5173)
make web-build        Build frontend for production
```

---

## Project structure

```
stratplan/
├── cmd/
│   └── server/
│       └── main.go              Entry point
├── internal/
│   ├── ai/
│   │   └── ollama.go            Ollama API client
│   ├── auth/
│   │   └── auth.go              JWT, bcrypt, token helpers
│   ├── config/
│   │   └── config.go            Environment config loader
│   ├── database/
│   │   └── db.go                PostgreSQL connection pool
│   ├── email/
│   │   └── email.go             SMTP service + HTML templates
│   ├── handlers/
│   │   ├── router.go            All HTTP routes
│   │   ├── health.go            GET /health
│   │   └── helpers.go           JSON/Error response helpers
│   ├── middleware/
│   │   └── auth.go              JWT auth + role enforcement middleware
│   ├── models/
│   │   └── models.go            All domain models and enums
│   └── services/                Business logic (filled per sprint)
├── migrations/
│   ├── 001_initial_schema.up.sql
│   └── 001_initial_schema.down.sql
├── web/                         React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── api/                 API client functions
│   │   ├── components/          Shared UI components
│   │   ├── hooks/               Custom React hooks
│   │   ├── i18n/locales/        en.json · fr.json · pt.json
│   │   └── pages/               Page-level components
│   └── public/
├── docs/
│   └── adr/                     Architecture Decision Records
├── scripts/                     Utility shell scripts
├── .github/
│   ├── workflows/               CI/CD pipelines
│   └── ISSUE_TEMPLATE/          Bug and feature issue templates
├── .env.example                 All env vars documented
├── docker-compose.yml
├── Dockerfile
├── Makefile
└── README.md
```

---

## API overview

All endpoints are prefixed `/api/v1` (except `/health` and `/auth`). Authenticated endpoints require `Authorization: Bearer <access_token>`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check |
| `POST` | `/auth/login` | None | Email + password login |
| `POST` | `/auth/refresh` | None | Rotate refresh token |
| `POST` | `/auth/logout` | Bearer | Revoke session |
| `POST` | `/invitations/accept` | None | Accept an invite token |
| `GET` | `/api/v1/plans` | Bearer | List plans for caller's org |
| `POST` | `/api/v1/plans` | Planner+ | Create a plan |
| `GET` | `/api/v1/plans/:id/activities` | Bearer | List activities (any phase, any order) |
| `POST` | `/api/v1/plans/:id/activities` | Planner+ | Create activity (any phase) |
| `GET` | `/api/v1/plans/:id/progress` | Bearer | Progress metrics |
| `POST` | `/api/v1/plans/:id/reports` | Planner+ | Generate report (async) |
| `POST` | `/api/v1/ai/draft` | Planner+ | AI activity draft from keywords |
| `POST` | `/api/v1/ai/summary` | Planner+ | AI narrative summary |
| `POST` | `/api/v1/org/invitations` | Org admin | Send user invite |
| `PUT` | `/api/v1/org/sso` | Org admin | Configure SAML/OIDC |
| `GET` | `/api/v1/admin/orgs` | Super admin | List all organisations |

See [`docs/api.md`](docs/api.md) for the full reference (generated from code).

---

## Role system

Two tiers — Platform and Organisation.

**Platform tier** (cross-org, assigned by deployment team):

| Role | What they can do |
|------|-----------------|
| `super_admin` | Create/deactivate orgs, invite org admins, global config, billing |
| `platform_support` | Read-only view of all orgs and usage; impersonate for support |

**Organisation tier** (scoped to one org):

| Role | What they can do |
|------|-----------------|
| `org_admin` | Manage users, invite by email, SSO config, all plans |
| `planner` | Create and run plans and all activities, AI, reports |
| `contributor` | Edit assigned activities, view everything |
| `viewer` | Read-only; can be scoped to specific plans only |

---

## AI (Ollama)

StratPlan uses [Ollama](https://ollama.ai) for all AI features. **No data is sent to any external API.**

Supported features:
- Draft any activity type from keywords (SWOT, Vision, KPI set, PESTLE, Risk Register, …)
- Suggest strategic objectives from a completed SWOT
- Propose KPIs with target values for each objective
- Detect gaps across P1/P2/P3
- Write narrative executive summaries for reports

Recommended model: **llama3 8B** (~5 GB download, 8 GB RAM).
Alternative: **mistral 7B** (~4 GB download, 6 GB RAM minimum).

To switch models, change `OLLAMA_MODEL` in `.env` — no code change required.

---

## Offline capability

StratPlan works without internet connectivity. When the server is unreachable:

- The frontend reads from a local SQLite cache
- Writes are queued and replayed automatically on reconnect (last-write-wins, v1.0)
- Conflicts are logged and surfaced to the user
- Features that require the server (AI, SSO, email notifications, report generation) show a clear offline indicator

---

## Deployment (Linux bare metal)

```bash
# 1. Build the binary
make build
# → bin/stratplan (single static binary, no runtime needed)

# 2. Copy to server
scp bin/stratplan user@server:/opt/stratplan/stratplan
scp .env.example  user@server:/opt/stratplan/.env
# Edit .env on the server

# 3. Run migrations on the server
DATABASE_URL="..." /opt/stratplan/stratplan migrate  # or use migrate CLI

# 4. Install systemd service
sudo cp scripts/stratplan.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stratplan
```

See [`scripts/stratplan.service`](scripts/stratplan.service) for the systemd unit file.

Minimum server spec: **4 CPU cores, 8 GB RAM** (required for Ollama llama3 8B).

---

## Contributing

This project is currently in active early development. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Branch strategy:
- `main` — stable, tagged releases only
- `develop` — integration branch for completed sprints
- `feature/*` — individual feature branches
- `fix/*` — bug fixes

---

## Licence

[MIT](LICENSE)
