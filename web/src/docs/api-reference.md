# SPE-Lite — Comprehensive API Reference

## Table of Contents

1. [Product Overview](#1-product-overview) *(unverified — see caveat above)*
2. [Conventions](#2-conventions)
3. [Data Models](#3-data-models)
4. [Endpoints](#4-endpoints)
   - [4.1 Health](#41-health)
   - [4.2 Authentication](#42-authentication--auth)
   - [4.3 SSO — Configuration & Login Flows](#43-sso--saml--oidc)
   - [4.4 Self-Service Account](#44-self-service-account--apiv1me)
   - [4.5 Organisation & Users](#45-organisation--users--apiv1org)
   - [4.6 Platform Admin](#46-platform-admin--apiv1admin)
   - [4.7 Plans](#47-plans)
   - [4.8 Activities](#48-activities)
   - [4.9 Progress & Completeness](#49-progress--completeness)
   - [4.10 Activity Links](#410-activity-links)
   - [4.11 Plan Viewers](#411-plan-viewers)
   - [4.12 Strategic Pillars & Objectives](#412-strategic-pillars--objectives-local-plans)
   - [4.13 Plan Chapters (2, 3, 6, 7)](#413-plan-chapters-2-3-6-7)
   - [4.14 Milestones](#414-milestones)
   - [4.15 AI Assistant](#415-ai-assistant--apiv1ai)
   - [4.16 Reports](#416-reports)
5. [Known Issues](#5-known-issues)
6. [Appendix: Full Route Table](#6-appendix-full-route-table)

---

## 1. Product Overview

*(Pulled from `README.md`, which the person requesting these docs flagged as
stale — kept only because it's low-risk framing, not a technical claim. Verify
against current product/marketing material before reusing externally.)*

StratPlan (internally `spe-light`) is a self-hosted, multi-tenant strategic
planning and execution platform. Organisations create strategic plans built
around user-defined Strategic Pillars and Objectives (the ESWAMCU standard),
and track activities against them, with optional AI-assisted drafting.

Every plan uses the same structure (see §3, **Plan**): Strategic Pillars →
Strategic Objectives (KPAs) → Activities, plus six additional plan
"chapters" (Vision & Mission, Situational Analysis, Organisational
Structure, Monitoring & Evaluation, Tracking, and an optional Advanced
Research bucket for standalone research activities — Business Model Canvas,
Competitive Analysis, Risk Register, and similar — that don't nest under
any pillar). Activities can be created in any order — pillar/objective
assignment is a label, not a sequencing gate.

> **Migration note:** an earlier revision of the product also offered a
> fixed **P1 / P2 / P3** phase model ("international" plans) alongside the
> pillar-based ("local") model, selectable at plan creation. Migration
> `014_collapse_plan_types` retired that distinction — `Plan.plan_type` and
> `Activity.phase` no longer exist, every plan is the pillar/objective
> structure, and the fixed P1/P2/P3 activity types that had no equivalent
> elsewhere (Risk Register, Business Model Canvas, OKR/Balanced Scorecard,
> Operational Roadmap, Resource Plan, Budget Allocation, Competitive
> Analysis) moved to the optional Advanced Research bucket. Anything below
> describing "phase," "P1/P2/P3," "international plans," or "local plans"
> as a live distinction is describing the pre-migration model — flagged
> inline where it still appears pending a full pass.

**Tech stack** (per README; not independently re-verified against `go.mod`/
`config.go` in this pass): Go + [Chi](https://github.com/go-chi/chi) router,
PostgreSQL, JWT (access + refresh) auth with bcrypt, SAML/OIDC for SSO, SMTP
email, [Ollama](https://ollama.ai) for the AI features (self-hosted LLM — no
external API calls, no data leaves the deployment).

> The README's tagline also claims "offline-capable." Its own Sprint table
> lists offline sync as **not started**, and nothing in any batch of source
> reviewed so far touches offline/sync behavior. Treat "offline-capable" as
> aspirational, not a confirmed shipped feature, until source for that
> subsystem is reviewed.

---

## 2. Conventions

Applies to every endpoint below unless the endpoint says otherwise.

**Base paths.** Two prefixes exist:
- `/api/v1/*` — everything requiring authentication, plus one public
  exception (`POST /api/v1/invitations/accept`).
- `/auth/*` and bare `/health` — public, no `Authorization` header, no
  `/api/v1` prefix.

**Auth header.** `Authorization: Bearer <access_token>` on every route inside
`router.go`'s main `r.Group` (i.e. everything except the public routes in
§4.1–4.2 and the four SSO login-flow routes in §4.3).

**Multi-tenancy.** Every org-scoped record carries `org_id`, taken from JWT
claims on every request — never from a client-supplied field. Every
authenticated route also runs through `middleware.WithRLS(db)` (Postgres
Row-Level Security), on top of application-level `WHERE org_id = $N`
filtering in the SQL itself — belt and suspenders, not either/or. Requesting
a real ID that belongs to a *different* org behaves identically to
requesting an ID that doesn't exist — a deliberate anti-enumeration choice.

**Role model.** `models.Role`, six values total:

| Role | Tier | Notes |
|---|---|---|
| `super_admin` | platform (`org_id IS NULL`) | full platform admin console access |
| `platform_support` | platform | read-only platform admin console access |
| `org_admin` | org | full control within their org |
| `planner` | org | can write plan content, cannot manage users/org/delete plans |
| `contributor` | org | can only update activities they're personally assigned to |
| `viewer` | org | read-only; optionally scoped to specific plans (§4.11) |

`Role.IsPlatformRole()` is `true` for exactly the first two. The general
authorization pattern across the whole API:
- **Reads** (`GET`) — almost always any authenticated org member, `viewer`
  included. Exceptions are called out per-endpoint (mostly platform-admin and
  org-admin-only reads like the audit logs and user lists).
- **Writes** (`POST`/`PUT`/`PATCH`) on plan content — `org_admin` or
  `planner`.
- **Deletes** — `org_admin` only, with two exceptions: pillar/objective
  delete also allows `planner` (§4.12), and self-service account routes
  (§4.4) have no role gate at all since they only ever act on the caller's
  own account.
- **Activity updates** specifically also allow `contributor` — but a
  contributor is restricted, in the handler, to activities they're
  personally in `assigned_to` for (`403 you are not assigned to this
  activity` otherwise). A `planner`/`org_admin` can edit any activity in
  their org.

**Strict decoding.** Request bodies are decoded with
`dec.DisallowUnknownFields()` — an unrecognized JSON field 400s the whole
request rather than being silently ignored. Field names throughout this doc
are the literal JSON keys.

**Partial updates.** Every `Update*Request` has all-optional (pointer)
fields; omitted fields are left unchanged. A request with nothing set is
rejected (`"nothing to update"`, or equivalent). An explicit empty string for
a required text field (e.g. `title: ""`) is rejected as invalid — `omitempty`
means *omitted*, not *empty*, and the two are validated differently
throughout.

**Error shape.** Every handler calls `response.ErrorJSON(w, message, status)`
on failure — `message` is a plain human-readable string, never a structured
error code. Status code conventions (see also [Known Issues §5.4](#5-known-issues)):
- **`404`** — reserved for "fetch one named resource by ID, it doesn't
  exist": `GetPlan`, `GetActivity`, SSO `GetConfig`, admin `GetOrgDetail`,
  Report `Poll`, Report `Download`.
- **`400`** — everything else. This includes a "not found" on almost every
  `PUT`/`DELETE` in the API — a bad `pillarID` on `PUT /pillars/{pillarID}`
  is a `400`, not a `404`.
- **`401`** — unauthenticated (missing/invalid/expired JWT), and all
  `/auth/login` and `/auth/refresh` failures specifically (even
  "not found"-shaped ones — see §4.2).
- **`403`** — authenticated but forbidden (wrong role, or a contributor
  editing an unassigned activity).
- **`503`** — AI endpoints only, when Ollama itself is unreachable (see
  §4.15) — distinguishes "try again later" from a genuine bad request.

**Soft vs. hard delete.** Plans and Activities are soft-deleted
(`deleted_at` set; every read filters `WHERE deleted_at IS NULL`; no restore
endpoint exists anywhere in the reviewed source). Everything else — local-plan
sub-resources, org-structure roles, links, sessions — is hard-deleted, no
recovery.

**Ordering.** List-type resources generally carry `user_order int`,
defaulting to `(current max + 1)` on creation. Reordering is manual — send an
explicit `user_order`; nothing auto-renumbers siblings after a delete.

**Dates.** Client-supplied dates use `FlexDate`: accepts either a full
RFC3339 timestamp or a bare `"YYYY-MM-DD"` (so an HTML `<input type="date">`
doesn't need client-side reformatting). An empty string is valid and means
"no date." Responses always emit full RFC3339.

---

## 3. Data Models

Only fields touched by endpoints in this document — not a full schema dump.

### Plan
| Field | Type | Notes |
|---|---|---|
| `id`, `org_id`, `owner_id` | uuid | owner set at creation, not reassignable via any endpoint reviewed |
| `title` | string | required |
| `description` | string \| null | |
| `status` | `draft`\|`active`\|`review`\|`completed`\|`archived` | |
| `start_date`, `end_date` | date \| null | |
| `vision`, `mission` | string \| null | singleton text (§4.13) |
| `created_at`, `updated_at` | timestamp | |

> `plan_type` (`international`\|`local`) existed pre-migration; removed by
> `014_collapse_plan_types`. Every plan now has `vision`/`mission` and
> access to every chapter endpoint in §4.12–4.13 — there's no longer a plan
> that 400s on `POST /plans/{id}/pillars`.

### Activity
| Field | Type | Notes |
|---|---|---|
| `id`, `plan_id`, `org_id` | uuid | |
| `objective_id` | uuid \| null | set for an ordinary activity nested under a Strategic Objective |
| `category` | `advanced_research` \| null | set instead of `objective_id` for a standalone Advanced Research activity |
| `type` | string | free text for objective-nested activities; validated against a fixed 7-value set (§4.8) when `category` is `advanced_research` |
| `title` | string | required |
| `status` | `not_started`\|`in_progress`\|`review`\|`complete` | |
| `content` | object | shape depends on `type` — only meaningful for Advanced Research activities |
| `ai_draft` | object \| null | populated by §4.15, read-only here |
| `assigned_to` | uuid[] | |
| `due_date` | date \| null | |
| `kpis` | `KPI[]` | only meaningful for objective-nested activities — Advanced Research activities always `[]` |
| `user_order`, `created_at`, `updated_at` | | |

A DB constraint enforces exactly one of `objective_id`/`category` set, never
both, never neither — validated at the app layer too, for a readable error.

> `phase` (`P1`\|`P2`\|`P3`) existed pre-migration, set iff the parent plan
> was `international`. Removed by `014_collapse_plan_types` — Activity has
> no `phase` field any more.

### KPI
Embedded inline in `Activity.kpis` — no standalone table/endpoint.

| Field | Type |
|---|---|
| `indicator` | string |
| `target` | string (free text) |
| `target_value`, `actual_value` | number \| null |
| `direction` | `increase`\|`decrease`\|`""` — which way is "better," drives achievement-% |
| `budget` | number \| null |
| `responsibility` | string \| null |
| `target_period` | `monthly`\|`quarterly`\|`annual`\| null |

> **Migration note:** `budget`/`responsibility`/`target_period` moved here
> from `Activity` in migration 013 (a single activity can have several KPIs
> on different cadences/owners/budgets). See [§5.1](#5-known-issues) — not
> every code path was updated for this move.

### StrategicPillar / StrategicObjective
The user-defined top-level grouping for a plan, two levels deep — every
plan has these now (no longer local-plan-only). `{id, plan_id, org_id,
title, user_order, created_at, updated_at}` + `pillar_id` on the objective
(which pillar it nests under).

### CoreValue
`{id, plan_id, org_id, name, description?, user_order}`

### Stakeholder
`{id, plan_id, org_id, name, influence: "high"|"low", interest: "high"|"low", notes?, user_order}`.
Power/interest **quadrant is derived, not stored** — no endpoint returns it;
compute client-side: high/high→`manage_closely`, high/low→`keep_satisfied`,
low/high→`keep_informed`, else→`monitor`.

### SWOTItem
`{id, plan_id, org_id, category: "strength"|"weakness"|"opportunity"|"threat", text, user_order}`
— `user_order` scoped within category.

### PESTELItem
`{id, plan_id, org_id, factor: "political"|"economic"|"social"|"technological"|"environmental"|"legal", implication?, positive?, negative?, user_order}`
— at least one of `implication`/`positive`/`negative` required on create;
`user_order` scoped within factor.

### OrgStructureRole
`{id, plan_id, org_id, title, description?, reports_to_id?, user_order}` —
flat, self-referencing list (not a fixed-depth tree); `reports_to_id: null`
= top of chart. Deleting a role re-parents its children to `null`, doesn't
cascade-delete them.

### MEItem
`{id, plan_id, org_id, category: "objective"|"critical_success_factor"|"review_note"|"conclusion_measure", text, user_order}`
— `user_order` scoped within category.

### ActivityLink
`{id, plan_id, source_id, target_id, link_type: "manual"|"auto"|"ai_suggested", created_by, created_at, updated_at}`
— directional, source → target; `link_type` defaults to `manual`.

### PlanProgress
Returned by `GET /plans/{planID}/progress`. `pillars` is always present now
(every plan has pillars); `advanced_research` is present only once the plan
has at least one Advanced Research activity:
```jsonc
{
  "plan_id": "uuid", "status": "active",
  "pillars": [{ "pillar_id": "uuid", "title": "...", "total": 8, "complete": 3,
                "in_progress": 4, "overdue": 1, "percent_complete": 37.5 }],
  "advanced_research": { "total": 2, "complete": 1, "in_progress": 1,
                          "overdue": 0, "percent_complete": 50.0 },
  "overall": { "total": 10, "complete": 4, "in_progress": 5, "overdue": 1, "percent_complete": 40.0 },
  "milestones": { "total": 5, "reached": 2, "missed": 1, "pending": 2 }
}
```
`percent_complete = complete/total*100`, or `0` if `total` is 0. A pillar
with zero activities still appears (all-zero counts), not dropped.
`overall` covers every activity in the plan — pillar-attached and Advanced
Research combined.

> `plan_type` and `phases` (mutually exclusive with `pillars`, pre-migration)
> no longer exist on this response.

### CompletenessDetail
Computed (`ComputeCompleteness`) but **not currently wired into any response
reviewed** — see [§5.2](#5-known-issues).
`pillar_coverage` (0–60, `pillars_with_work/total_pillars×60`) +
`activity_compl` (0–30, `complete/total×30`) + `link_density` (0–10, capped
credit vs. `total_activities/2` link target) = 0–100 score. Deterministic,
no ML. `total_pillars`/`pillars_with_work` replaced a pre-migration fixed
"3 phases × 20pts" scheme — pillars are user-defined and variable in
number, so coverage is now a ratio rather than a fixed per-phase value.

### FlexDate
Input-only adapter — see [§2](#2-conventions).

### TokenResponse (auth)
```jsonc
{
  "access_token": "string", "refresh_token": "string",
  "expires_at": "RFC3339",
  "user": { "id": "uuid", "name": "string", "email": "string",
            "role": "Role", "org_id": "uuid | omitted for platform-tier" }
}
```

### Organisation
Fields touched across §4.5/§4.6: `id`, `name`, `slug`, `is_active`,
`industry?`, `locale`, `logo_url` *(field exists — see [§5.6](#5-known-issues))*,
plus self-service profile fields (address/country/contact/industry/org
structure/member count — exact JSON keys not confirmed in any batch
reviewed; `orgsvc`'s own source wasn't included).

### SSOConfig
```jsonc
{
  "protocol": "saml | oidc", "default_role": "Role",
  "jit_enabled": true, "local_login_disabled": false,
  "metadata_url": "string?", "entity_id": "string?",
  "client_id": "string?", "discovery_url": "string?"
  // certificate, client_secret: write-only, never returned (json:"-")
}
```

### PlatformStats
```jsonc
{ "orgs_total": 0, "orgs_active": 0, "orgs_new_last_30_days": 0,
  "org_users_total": 0, "platform_team_total": 0,
  "plans_total": 0, "plans_active": 0, "activities_total": 0,
  "reports_generated_total": 0,
  "pending_org_invitations": 0, "pending_platform_invitations": 0 }
```
Each field is an independent `COUNT(*)`; one failing query degrades that
field to `0` rather than failing the request — this endpoint is designed to
never itself return an error.

### models.Report
Fields touched in §4.16: `id`, `plan_id`, `type`, `format`, `status`
(`ReportStatus` — always terminal, `"complete"`, by the time a client sees
one; see §4.16), `file_url`, `created_at`, plus whatever else `reportsvc`
carries (not fully enumerated — `report_service.go`/`render.go` were
available but a full struct dump wasn't extracted for this pass).

---

## 4. Endpoints

### 4.1 Health

#### `GET /health`
Public. No auth. → `{ "status": "ok", "time": "RFC3339" }`

### 4.2 Authentication — `/auth/*`

Public — no `Authorization` header.

#### `POST /auth/login`
Rate-limited. `{ "email", "password" }` → `200` `TokenResponse`.
**Always** `401 invalid credentials` for both a nonexistent email and a wrong
password (anti-enumeration) — plus `401 account is deactivated` and
`401 this account uses SSO — please sign in via your identity provider` (no
`password_hash` on the account — an SSO-provisioned user; distinct from an
org-wide `local_login_disabled` flag on the SSO config).

#### `POST /auth/refresh`
`{ "refresh_token" }` → `200` `TokenResponse`. **Single-use / rotating** —
the presented token is revoked and a new pair issued; the old one is marked
revoked *before* the new pair is written, so a mid-write failure fails
closed (forces re-login) rather than open. `401` on: invalid, already-revoked
(also logs a server-side warning — reuse of a revoked token is the signature
of token theft/replay), expired, or deactivated account.

#### `POST /auth/logout`
`{ "refresh_token" }` → `200 { "message": "logged out" }`. Revokes only the
presented refresh token — the access token isn't invalidated server-side, it
just expires naturally on its own short TTL. Client must also clear local
storage.

#### `POST /auth/password-reset/request`
`{ "email" }` → **always** `200`, always the identical body
(`{ "message": "if that email exists, a reset link has been sent" }`)
regardless of whether the address matches an account. Reset link is
HMAC-signed so it can't be tampered with even without TLS.

#### `POST /auth/password-reset/confirm`
`{ "token", "password" }` → `200 { "message": "password updated" }`. `400`
on invalid/already-used/expired token. **Also revokes every refresh token
for that user** — a reset logs out every other active session immediately.

#### `POST /api/v1/invitations/accept`
Public (invitee has no token yet — hence living under `/api/v1` rather than
bare `/auth`, to avoid colliding with the SPA's own client-side route of the
same name). `{ "token", "name", "password" }` → `201` `TokenResponse` (logged
in immediately). `400 token, name and password are required`;
`400 invalid invitation token`. If the invite's org exists but is currently
inactive (the create-org-then-invite-admin onboarding path, §4.6), also
**activates the org** in the same transaction. If the invite carries
`plan_ids`, writes the corresponding `plan_viewers` rows too.

### 4.3 SSO — SAML & OIDC

Two surfaces: JSON config (authenticated, org_admin) and browser-redirect
login flows (public).

#### Configuration — `/api/v1/org/sso` (org_admin only)
| Method | Path |
|---|---|
| GET | `/api/v1/org/sso` |
| PUT | `/api/v1/org/sso` |
| DELETE | `/api/v1/org/sso` |

At most one config row per org; `PUT` is a full upsert/replace.

**PUT request:**
```jsonc
{
  "protocol": "saml | oidc",
  "default_role": "Role — org-tier only, defaults to viewer",
  "jit_enabled": false, "local_login_disabled": false,
  "metadata_url": "string, SAML — preferred over certificate+entity_id",
  "entity_id": "string, SAML", "certificate": "string (PEM), SAML",
  "client_id": "string, OIDC", "client_secret": "string, OIDC — write-only",
  "discovery_url": "string, OIDC, e.g. https://accounts.google.com"
}
```
`400` if: SAML protocol without either `metadata_url` or both
`certificate`+`entity_id`; OIDC without all three of `client_id`/
`client_secret`/`discovery_url`; `protocol` not `saml`/`oidc`; or
`default_role` is a platform-tier role.

**GET** → `SSOConfig`, `client_secret`/`certificate` always omitted (never
read back). `404 no SSO configuration found for this organisation` if none.

**DELETE** → `200 { "message": "SSO configuration removed" }`; implicitly
re-enables local login. `400` if nothing to delete.

#### Login flows — public, `/auth/saml/*` and `/auth/oidc/*`
Keyed by `{orgSlug}` (the org's slug, not ID).

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/saml/{orgSlug}/metadata` | SP metadata XML, for the org admin to paste into their IdP |
| POST | `/auth/saml/{orgSlug}/acs` | Assertion Consumer Service — IdP posts the assertion here |
| GET | `/auth/oidc/{orgSlug}/login` | Redirects to the IdP with a PKCE challenge |
| GET | `/auth/oidc/{orgSlug}/callback` | Exchanges the code, verifies, issues tokens |

**On success (both):** redirects to
`{FRONTEND_URL}/auth/callback?access_token=...&refresh_token=...&expires_at=...`
— same token pair shape as `/auth/login`.

**SAML validation, in order, before any session exists:**
1. `ParseResponse` — signature, audience, `NotBefore`/`NotOnOrAfter`.
2. **Replay protection** — the assertion ID is inserted into a DB-backed
   replay cache (`UNIQUE (id, org_id)`); a repeat hits a unique-violation →
   `403` rejection. DB-backed specifically so this survives restarts and
   holds across multiple app instances.
3. Attributes are read straight off `AttributeStatements` into a flat map,
   indexed by both friendly name and full URI name, plus `NameID` from the
   subject.

Failure at any step → `403` (validation failure, or the replay/handler
error message).

**OIDC — Authorization Code + PKCE:**
- `/login` — generates a random nonce (doubles as OAuth2 `state` *and* the
  `id_token` nonce claim) + PKCE `code_verifier`; both stored in a signed,
  10-minute, HttpOnly cookie before redirecting to the IdP.
- `/callback` — reads and **immediately clears** the state cookie (before
  any other validation, so a failed callback never leaves a stale cookie);
  checks for an explicit IdP `?error=`; checks `?state=` matches (CSRF
  guard); exchanges `?code=` with the stored PKCE verifier; verifies the ID
  token.

Errors: `400 invalid or expired SSO state`, `401 identity provider returned
an error: <error>`, `400 missing authorization code in callback`,
`400 OAuth2 state mismatch — possible CSRF`.

### 4.4 Self-Service Account — `/api/v1/me`

**No role gate on any route here** — every handler derives the target user
strictly from JWT claims, never a path param, so there's no way to act on
someone else's account through this surface.

#### `GET /api/v1/me`
Caller's own profile. Functionally identical to `GET /api/v1/org/me` (§4.5)
— kept as a separate, tier-agnostic route so the profile page has one stable
endpoint independent of the org-scoped surface, and so future profile-only
fields don't need threading through `GetOrg`'s response shape. → `models.User`.

#### `PATCH /api/v1/me`
Self-service edit of **name, phone, avatar, locale only**. Cannot touch
email, role, org, or active status (enforced service-side, not just by
omission from the request type). → `models.User`.

#### `POST /api/v1/me/change-password`
`{ "current_password", "new_password", "confirm_password" }` → `200
{ "message": "password updated, please sign in again" }`. **Revokes every
one of the caller's sessions, including the current one** — treat `200` here
as a forced logout; route to `/login`, don't keep using the now-stale access
token.

#### `GET /api/v1/me/sessions`
Caller's active sessions. → array (shape not enumerated in this pass —
`orgsvc.ListSessions`'s return type wasn't in the reviewed source).

#### `POST /api/v1/me/sessions/revoke-all`
→ `200 { "message": "signed out of all sessions" }`. Same forced-logout
contract as change-password — including the current session.

### 4.5 Organisation & Users — `/api/v1/org`

#### `GET /api/v1/org/me`
No role gate. Caller's own profile — see the `GET /api/v1/me` note above on
why both exist. → `models.User`.

#### `GET /api/v1/org`
No role gate. The caller's organisation. → `Organisation`.

Everything below requires **`org_admin`**.

#### `PATCH /api/v1/org`
Self-service org profile edit — address, country, contact info, industry,
org structure, total member count (per the handler's doc comment; exact
JSON field names weren't confirmed in this pass — `orgsvc`'s own source
wasn't included). Distinct from the platform-admin
`PATCH /api/v1/admin/orgs/{orgID}` (§4.6), which covers name/`is_active`
instead. This profile data is folded into AI prompt context (§4.15) so
generated drafts are grounded in what the org actually is. → `Organisation`.

#### `GET /api/v1/org/users`
→ `models.User[]`, all users in the caller's org.

#### `PATCH /api/v1/org/users/{userID}`
Update a user's role and/or active status (exact request shape not confirmed
— see [§5.7](#5-known-issues) on a self-modification question worth
checking). → `models.User`.

#### `GET /api/v1/org/invitations`
→ `models.Invitation[]`.

#### `POST /api/v1/org/invitations`
```jsonc
{ "email": "string, required", "role": "Role, required",
  "plan_ids": ["uuid", "..."] }
```
`400` if `email` or `role` missing. `plan_ids` is optional — when present,
accepting the invite (§4.2) writes `plan_viewers` grants for each, in
addition to creating the account. → `201` `models.Invitation`.

#### `DELETE /api/v1/org/invitations/{invitationID}`
→ `200 { "message": "invitation cancelled" }`.

#### `POST /api/v1/org/invitations/{invitationID}/resend`
→ `200 { "message": "invitation resent" }`.

#### `GET /api/v1/org/audit-log`
Query params: `user_id`, `action`, `table_name`, `from`, `to`, `limit`
(default 50, **hard-capped 200**), `offset`. → same `AuditLogResult` shape
as the platform-tier audit log (§4.6), scoped to the caller's org only.

### 4.6 Platform Admin — `/api/v1/admin`

All routes require `super_admin` **or** `platform_support`, except where
marked **super_admin only** (account/org mutations).

#### `GET /api/v1/admin/stats`
No role restriction beyond the group gate. → `PlatformStats` (§3). Designed
to never itself error — a failing count degrades to `0`.

#### `GET /api/v1/admin/orgs`
Query params: `active_only=true`, `limit` (default 50), `offset` (default 0).
→ `Organisation[]`.

#### `POST /api/v1/admin/orgs` — **super_admin only**
```jsonc
{ "name": "string, required", "industry": "string?",
  "locale": "string, default \"en\"", "admin_email": "string?" }
```
Creates an **active** org, `slug = slugify(name) + "-" + first 8 chars of a
new UUID`. If `admin_email` set, also fires an `org_admin` invite in the same
call — **not transactional**: if the invite fails after the org row commits,
the org still exists (active, no admin) and the error return says to retry
the invite separately. → `201` `Organisation`.

#### `PATCH /api/v1/admin/orgs/{orgID}` — **super_admin only**
```jsonc
{ "name": "string?", "is_active": "bool?", "industry": "string?", "locale": "string?" }
```
`400 nothing to update` if empty. **Deactivation** (`is_active: false`, only
when previously `true`) side effects: audit log entry with a before/after
diff, **every refresh token for every user in the org revoked immediately**,
an org-admin email notification sent. → `200` `Organisation`.

#### `GET /api/v1/admin/orgs/{orgID}`
Available to `platform_support` too. → `OrgDetail` = `Organisation` +
`{ "user_count", "plan_count", "active_plan_count" }`, each count
best-effort (a failed count silently stays `0`). `404` if not found.

#### `DELETE /api/v1/admin/orgs/{orgID}` — **super_admin only**
Soft-deletes. **Requires the org already deactivated** —
`400 deactivate this organisation before deleting it` otherwise (deliberate
friction against one-click accidental deletion of a live org). Nothing
cascades at the DB level — plans/activities/users remain, just unreachable
via the org-scoped API once the org itself is gone. → `200`
`{ "message": "organisation deleted" }`.

#### `POST /api/v1/admin/org-invitations` — **super_admin only**
`{ "email", "org_id" }` — `org_id` must reference an existing, non-deleted
org (`400 organisation not found — create it first via POST
/api/v1/admin/orgs` otherwise). Always invites as `org_admin`; 7-day token.
→ `201` `models.Invitation`.

#### `GET /api/v1/admin/audit-log`
Available to `platform_support`. Query params: `org_id` (omit for all orgs),
`user_id`, `action`, `table_name`, `from`, `to`, `limit` (default 50,
hard-capped 200), `offset`. → `AuditLogResult`:
```jsonc
{ "logs": [{ "...AuditLog fields...", "user_name", "user_email", "org_name" }],
  "total": 0, "limit": 0, "offset": 0 }
```

#### Platform-tier user management
All **super_admin only** except the two `GET`s (also `platform_support`).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/platform-users` | `models.User[]` where `org_id IS NULL` |
| GET | `/api/v1/admin/platform-users/invitations` | all statuses, console filters client-side |
| POST | `/api/v1/admin/platform-users/invitations` | `{ email, role: "super_admin"\|"platform_support" }`. `400` if an active platform account already exists for that email. 7-day token. |
| DELETE | `/api/v1/admin/platform-users/invitations/{invitationID}` | only cancels a `pending` invite; `400` otherwise |
| POST | `/api/v1/admin/platform-users/invitations/{invitationID}/resend` | re-issues token + 7-day expiry, works even after cancel/expiry |
| PATCH | `/api/v1/admin/platform-users/{userID}` | `{ role?, is_active? }`. **Cannot target yourself** (`400 cannot change your own platform role or active status`) — prevents self-lockout. Deactivating also revokes all that user's refresh tokens. |

### 4.7 Plans

#### `GET /api/v1/plans`
No role gate — but the *result set* differs: `org_admin`/`planner`/
`contributor` see every plan in the org; a `viewer` sees either all plans
(if they have zero `plan_viewers` grants — an "org-wide viewer") or only
their explicitly granted plans (§4.11) if they have at least one grant. →
`Plan[]` (never `null`).

#### `GET /api/v1/plans/{planID}`
`404` if not found / not in caller's org. → `Plan`.

#### `POST /api/v1/plans` — org_admin, planner
`{ title (required), description?, start_date?, end_date? }`.
Always created `status: "draft"` — there's no `status` field on the create
request at all. → `201` `Plan`.

#### `PUT /api/v1/plans/{planID}` — org_admin, planner
Partial: `{ title?, description?, status?, start_date?, end_date? }`.
`"archived plans cannot be updated"` — but only checked when `status` is in
the request (see [§5.3](#5-known-issues)). → `Plan`.

#### `DELETE /api/v1/plans/{planID}` — org_admin only
Soft-deletes the plan **and cascades to soft-delete every activity in it**
(same transaction). Local-plan sub-resources (pillars, core values, etc.)
are left in place, orphaned but harmless. → `200`
`{ "message": "plan deleted" }`.

#### `POST /api/v1/plans/{planID}/duplicate` — org_admin, planner
Deep-copies the plan row (title `+ " (copy)"`, `status: draft`, owner = the
caller), pillars/objectives (fresh IDs re-linked), and all non-deleted
activities. **Activity links are deliberately not copied** —
rewriting every link's endpoints against new IDs was judged too easy to get
subtly wrong; re-run auto-detect (§4.10) on the new plan instead. → `201`
new `Plan`.

> ⚠️ See [§5.1](#5-known-issues) — this endpoint's SQL references columns
> migration 013 removed; likely broken if that migration has been applied.

### 4.8 Activities

#### `GET /api/v1/plans/{planID}/activities`
No role gate. Query params (combinable): `objective_id`, `category`
(only accepted value: `advanced_research`), `status`. Passing neither
`objective_id` nor `category` returns every activity in the plan.
→ `Activity[]`, sorted `objective_id, user_order`.

#### `POST /api/v1/plans/{planID}/activities` — org_admin, planner
`{ type (required), title (required), content?, assigned_to?, due_date?, kpis? }`
plus **exactly one** of `objective_id`/`category` (wrong/both/neither →
specific error naming what was expected). When `category` is
`advanced_research`: `objective_id` and `kpis` must both be omitted, and
`type` must be one of `business_model_canvas`, `competitive_analysis`,
`risk_register`, `okr_balanced_scorecard`, `operational_roadmap`,
`resource_plan`, `budget_allocation` — anything else 400s. Any KPI with
`target_period` set must use a valid period value. → `201` `Activity`.

#### `GET /api/v1/activities/{activityID}`
No role gate. Direct fetch by ID — removes a client-side list-and-filter
workaround. `404` if not found. → `Activity`.

#### `PUT /api/v1/activities/{activityID}` — org_admin, planner, contributor*
Partial: `{ title?, status?, content?, assigned_to?, due_date?, kpis? }`.
\* contributor restricted to activities they're assigned to (checked before
the service call — `403` otherwise). → `Activity`.

#### `DELETE /api/v1/activities/{activityID}` — org_admin, planner
Soft-deletes, and in the same transaction hard-deletes any `activity_links`
referencing it (source or target) — no dangling link references a deleted
activity. → `200` `{ "message": "activity deleted" }`.

### 4.9 Progress & Completeness

#### `GET /api/v1/plans/{planID}/progress`
No role gate. → `PlanProgress` (§3) — live aggregate, not cached; re-derives
on every call.

> The completeness score is computed elsewhere in the codebase but — per
> everything reviewed across all three batches — **not currently returned by
> this or any other endpoint**. See [§5.2](#5-known-issues) before
> documenting a completeness field/route as live in any downstream guide.

### 4.10 Activity Links

#### `GET /api/v1/plans/{planID}/links`
No role gate. All links for a plan. → `ActivityLink[]`.

#### `GET /api/v1/activities/{activityID}/links`
No role gate. Links where the activity is source or target. → `ActivityLink[]`.

#### `POST /api/v1/activities/{activityID}/links` — org_admin, planner
Path `{activityID}` = `source_id`. Body: `{ target_id (required), link_type? }`
(defaults `manual`). Rejected on: self-link; source/target not both in
caller's org; source/target on **different plans** (intra-plan only);
**would create a cycle** (BFS from proposed target back to proposed source,
bounded 50 hops); duplicate (source, target) pair. → `201` `ActivityLink`.

#### `DELETE /api/v1/activities/{activityID}/links/{linkID}` — org_admin, planner
`{activityID}` scopes the delete to a link that actually touches that
activity — prevents deleting an arbitrary link in the org by ID alone. →
`200` `{ "message": "link deleted" }`.

#### `GET /api/v1/plans/{planID}/auto-links`
No role gate. Rule-based **suggestions only** — nothing written. Matches
Advanced Research activities by `type` against 5 hardcoded `(from, to,
reason)` rules (e.g. `risk_register → operational_roadmap`) — since
migration `014_collapse_plan_types`, ordinary objective-attached activities
have a free-text `type` a planner enters, so only the fixed Advanced
Research vocabulary can ever match either side of a rule. Accepting a
suggestion is a normal `POST .../links` call. → `CandidateLink[]`:
```jsonc
{ "source_id", "target_id", "source_type", "target_type", "reason" }
```

### 4.11 Plan Viewers

Grants/revokes plan-scoped read access for `viewer`-role users (see the
org-wide-vs-scoped distinction in §4.7's `ListPlans` note). **org_admin
only**, both routes.

#### `POST /api/v1/plans/{planID}/viewers`
`{ "user_id" }` — target must already exist in the org (not an invite flow
— that's §4.5/§4.2's `plan_ids`). **Idempotent**: granting twice is a no-op.
→ `201` `{ "message": "viewer access granted" }`.

#### `DELETE /api/v1/plans/{planID}/viewers/{userID}`
**Not** idempotent — `400` if no grant exists for that pair. → `200`
`{ "message": "viewer access revoked" }`.

### 4.12 Strategic Pillars & Objectives

Available on every plan (no longer rejected on a "wrong" plan type — that
distinction no longer exists).

| Method | Path | Role |
|---|---|---|
| GET | `/api/v1/plans/{planID}/pillars` | — |
| GET | `/api/v1/plans/{planID}/objectives` | — (flat, **all** pillars, no per-pillar GET exists) |
| POST | `/api/v1/plans/{planID}/pillars` | org_admin, planner |
| PUT | `/api/v1/pillars/{pillarID}` | org_admin, planner |
| DELETE | `/api/v1/pillars/{pillarID}` | org_admin, planner *(note: planner too — unusual for a delete)* |
| POST | `/api/v1/pillars/{pillarID}/objectives` | org_admin, planner |
| PUT | `/api/v1/objectives/{objectiveID}` | org_admin, planner |
| DELETE | `/api/v1/objectives/{objectiveID}` | org_admin, planner |

Create pillar: `{ "title" }`. Update: `{ title?, user_order? }`. Delete
pillar rejected if any objective still references it — delete those first,
no cascade. Create objective: `{ "title" }` (plan_id looked up from the
pillar server-side). Delete objective rejected if any non-deleted activity
still references it.

> Note the asymmetry: listing objectives is plan-wide and flat; creating one
> is pillar-scoped. A client wanting "objectives under pillar X" filters
> the flat list client-side by `pillar_id`.

### 4.13 Plan Chapters (2, 3, 6, 7)

All follow the identical list/create/update/delete
shape, all confirm the exact delete-message wording below directly from
`local_plan_sections.go`. (Chapter 8, Advanced Research, isn't a
list/create/update/delete resource of its own — it's just Activities with
`category: "advanced_research"`; see §4.8.)

#### Chapter 2 — Strategic Focus (Vision/Mission/Core Values)
| Method | Path | Role |
|---|---|---|
| PUT | `/api/v1/plans/{planID}/strategic-focus` | org_admin, planner |
| GET | `/api/v1/plans/{planID}/core-values` | — |
| POST | `/api/v1/plans/{planID}/core-values` | org_admin, planner |
| PUT | `/api/v1/core-values/{coreValueID}` | org_admin, planner |
| DELETE | `/api/v1/core-values/{coreValueID}` | org_admin, planner |

`PUT .../strategic-focus`: `{ vision?, mission? }`, either/both, returns the
**whole plan**. Core value create: `{ name (required), description? }`.
Update: `{ name?, description?, user_order? }`. Delete → `200
{ "message": "core value deleted" }`.

#### Chapter 3 — Situational Analysis (Stakeholders / SWOT / PESTEL)
| Method | Path | Role |
|---|---|---|
| GET/POST | `/api/v1/plans/{planID}/stakeholders` | — / org_admin, planner |
| PUT/DELETE | `/api/v1/stakeholders/{stakeholderID}` | org_admin, planner |
| GET/POST | `/api/v1/plans/{planID}/swot-items` | — / org_admin, planner |
| PUT/DELETE | `/api/v1/swot-items/{swotItemID}` | org_admin, planner |
| GET/POST | `/api/v1/plans/{planID}/pestel-items` | — / org_admin, planner |
| PUT/DELETE | `/api/v1/pestel-items/{pestelItemID}` | org_admin, planner |

Stakeholder create: `{ name, influence, interest, notes? }`. SWOT create:
`{ category, text }`; **category is not editable after creation** — no
field for it on the update request; delete and recreate to move categories.
PESTEL create: `{ factor, implication?, positive?, negative? }` (≥1 of the
three text fields required); same "factor not editable after creation"
pattern. Deletes → `200 { "message": "stakeholder deleted" }` /
`"swot item deleted"` / `"pestel item deleted"`.

#### Chapter 6 — Organisational Structure
| Method | Path | Role |
|---|---|---|
| GET | `/api/v1/plans/{planID}/org-structure-roles` | — |
| POST | `/api/v1/plans/{planID}/org-structure-roles` | org_admin, planner |
| PUT/DELETE | `/api/v1/org-structure-roles/{roleID}` | org_admin, planner |

Create: `{ title, description?, reports_to_id? }` — if `reports_to_id` set,
verified to exist **on the same plan** first. Update rejects
`reports_to_id == roleID` (direct self-report) — **does not** catch a longer
cycle (A→B→C→A); see [§5.5](#5-known-issues). Delete → `200
{ "message": "role deleted" }`; children re-parented to `null`, not
cascade-deleted.

#### Chapter 7 — Monitoring & Evaluation
| Method | Path | Role |
|---|---|---|
| GET | `/api/v1/plans/{planID}/me-items` | — (optional `?category=` filter) |
| POST | `/api/v1/plans/{planID}/me-items` | org_admin, planner |
| PUT/DELETE | `/api/v1/me-items/{meItemID}` | org_admin, planner |

Create: `{ category, text }`. Update: `{ text?, user_order? }` — category
not editable after creation, same pattern as SWOT/PESTEL. Delete → `200
{ "message": "me item deleted" }`.

### 4.14 Milestones

| Method | Path | Role |
|---|---|---|
| GET | `/api/v1/plans/{planID}/milestones` | — |
| POST | `/api/v1/plans/{planID}/milestones` | org_admin, planner |
| PUT | `/api/v1/milestones/{milestoneID}` | org_admin, planner |
| DELETE | `/api/v1/milestones/{milestoneID}` | org_admin only |

Request/response shapes come from `milestonesvc`, whose own source wasn't
in any batch reviewed — confirm field names before documenting a body shape
downstream. List → `models.Milestone[]` (never `null`).

### 4.15 AI Assistant — `/api/v1/ai`

All three routes: **org_admin, planner**. Ollama-backed, 90-second timeout
per call, no external API calls, no data leaves the deployment.
Connectivity failures (error text containing `"unreachable"`, or a handler
timeout) → `503`; everything else → `400` — lets the frontend distinguish
"Ollama is down" from a genuine bad request.

#### `POST /api/v1/ai/draft`
```jsonc
{
  "plan_id": "uuid, required",
  "activity_id": "uuid — omit for plan-wide/chapter-level drafts, or drafting before an activity exists",
  "activity_type": "string, required",
  "keywords": ["string", "..."]
}
```
`400 plan_id and activity_type are required` if either missing. →
`{ "draft": {...shape depends on activity_type...}, "model": "string", "warning": "string, optional" }`.
`warning` is currently only set for `okr_balanced_scorecard`
when the plan has no Strategic Objectives for the drafted KPIs to track —
the draft still comes back usable, never blocked outright, but the frontend
should surface the warning prominently.

`activity_type` → draft shape (selected highlights — anything unrecognized
falls back to `{content, notes}` rather than erroring):

| `activity_type` | Shape |
|---|---|
| `risk_register` | `{rows: [{risk, likelihood, impact, mitigation}]}` — likelihood/impact normalized to 1–5 |
| `okr_balanced_scorecard` | `{rows: [{kpi, target, current, objective_id}]}` |
| `local_pillars`, `local_core_values`, `local_stakeholders`, `local_pestel`, `local_org_structure`, `local_me` | chapter-specific — plan-wide, no `activity_id` |
| `local_activity_kpis` | `{kpis: [{indicator, target, target_value, direction, budget?, responsibility?, target_period?}]}` — budget/responsibility/target_period explicitly optional; model instructed to omit rather than guess |
| anything else | `{content, notes}` fallback |

> `swot`, `kpi_framework`, and `action_items` no longer reach this endpoint
> as `activity_type` values — SWOT drafting moved to the `local_swot`-style
> chapter draft, `kpi_framework` was dropped (redundant with per-activity
> KPIs), and `action_items` was dropped (redundant with ordinary
> objective-attached activities). `phase` is also no longer a request
> field — it was already optional/omitted for chapter-level drafts, and
> Activity has no `phase` to pass through for anything else now.

#### `POST /api/v1/ai/summary`
`{ "plan_id": "uuid, required" }` →
`{ "summary": "string", "model": "string" }`. Also invoked internally
(no HTTP hop) by Reports' AI Summary section (§4.16), via a closure
`router.go` wires so `reportsvc` never imports `aisvc` directly.

#### `POST /api/v1/ai/suggest-links`
Read-only — never writes to `activity_links`. Distinct from the
deterministic rule-based `auto-links` (§4.10); this asks the model to
propose links freeform. `{ "plan_id": "uuid, required" }` →
```jsonc
{ "suggestions": [{ "source_id", "target_id", "source_title", "target_title",
                     "source_type", "target_type", "reason" }],
  "model": "string" }
```
Empty `suggestions` (not an error) if <2 activities, or if the model's
output isn't parseable JSON — "nothing to suggest" and "model output
unusable" are indistinguishable from the caller's side. Capped at 8
suggestions regardless of model output. Existing links excluded **in both
directions** (a reversed existing link isn't a "new" suggestion). Never
suggests a self-link. Accepting one is a normal
`POST /activities/{id}/links` call with `link_type: "ai_suggested"`.

### 4.16 Reports

| Method | Path | Role |
|---|---|---|
| POST | `/api/v1/plans/{planID}/reports` | org_admin, planner |
| GET | `/api/v1/plans/{planID}/reports` | — (history) |
| GET | `/api/v1/reports/{jobID}` | — (poll) |
| GET | `/api/v1/reports/{jobID}/download` | — (download) |

#### `POST /api/v1/plans/{planID}/reports` — Generate
```jsonc
{
  "type": "full_plan | executive_summary | per_phase | progress_status | activity_detail | custom",
  "format": "pdf | docx | xlsx",
  "date_range": { "from": "string", "to": "string" },
  "sections": { "...SectionConfig, required and only used when type == \"custom\"..." }
}
```
`SectionConfig` (all bool except `phases`):
`{ executive_summary, vision_mission, situational_analysis, phase_activities,
phases: ["P1","P2","P3"], scorecard, org_structure, progress_status,
monitoring_evaluation, milestones, dependency_links, ai_summary }`.
Non-`custom` types use a fixed `SectionConfig` (`sections` in the request is
ignored): `full_plan`=everything, `executive_summary`={executive_summary,
vision_mission, scorecard, progress_status}, `per_phase`={phase_activities,
all 3 phases}, `progress_status`={progress_status, scorecard, milestones},
`activity_detail`={phase_activities all 3 phases, milestones}.

> ⚠️ **Open item, not yet reconciled with `014_collapse_plan_types`:**
> `phase_activities`/`phases`/`ReportType.per_phase` still reference the
> retired P1/P2/P3 phase model, which no longer means anything now that
> activities are pillar/objective-only. This wasn't addressed as part of
> the plan-type collapse — report generation needs a follow-up design pass
> (most likely: a Strategic Pillars section replacing `phase_activities`,
> covering both ordinary and Advanced Research activities) before this
> section of the doc can be trusted.

`400` on invalid `type`/`format`, or (for `custom`) an all-false/empty
`sections` (`"at least one section must be selected for a custom report"`).

> ⚠️ **Correction to an earlier draft of this documentation:** the response
> here is **`201 { "job_id": "<uuid>" }` only** — confirmed directly from
> `reports.go`:
> `response.JSON(w, http.StatusCreated, map[string]string{"job_id": report.ID.String()})`.
> It does **not** return the full `Report` object, despite generation being
> synchronous under the hood. Poll the returned `job_id` (below) to get the
> full object.

**Behavior:** generation is fully synchronous — by the time `Generate`
returns, the report is already in a terminal `complete` state; `Poll` below
exists for API-shape symmetry with an eventually-async model, not because
anything is actually async today. Content is assembled once into an
intermediate tree, then rendered to the requested format — a section broken
in one format is broken in all three. File written to
`{storageDir}/{report.ID}.{format}`; if the DB insert fails after the file
write, the orphaned file is best-effort removed. `date_range` is accepted
for shape compatibility but **not currently applied as a filter** — every
section reports the plan's full current state, not a windowed slice.

**Sections affected by migration 013** (Budget/Responsibility/TargetPeriod
now per-KPI): Scorecard — one row per `(activity, KPI)`; Phase Activities —
one row per `(activity, KPI)` with columns `Activity /
Status / KPI / Target Period / Responsible / Budget`, and an activity with
zero KPIs still gets one placeholder row so it isn't silently dropped.

**AI Summary section:** when `sections.ai_summary` is true, calls back into
`aisvc.Summary` via the closure noted in §4.15 — a failed/unreachable AI
service degrades to a placeholder note in just that section, not a failed
report.

#### `GET /api/v1/plans/{planID}/reports` — History
No role gate. → `models.Report[]` (never `null`), completed reports for the
plan, most recent first.

#### `GET /api/v1/reports/{jobID}` — Poll
No role gate. `404` on invalid/not-found. → `ReportJobStatus`:
`{ "status": "ReportStatus", "file_url": "string, only when complete", "report": "models.Report, only when complete" }`.
Since `Generate` is synchronous, polling a `job_id` it successfully returned
will only ever observe a terminal state.

#### `GET /api/v1/reports/{jobID}/download` — Download
No role gate. `404` on invalid/not-found. Streams the file directly, with
`Content-Type` and `Content-Disposition: attachment; filename="..."` headers
set from `FileForDownload`'s return values — confirmed directly from
`reports.go` (this closes an open item from an earlier documentation pass).

---

## 5. Known Issues

Flagged rather than silently smoothed over — worth resolving with the code
owner before any of these become load-bearing facts in a user guide or SDK.

1. **`DuplicatePlan` references dropped columns.** Its SQL selects/inserts
   `budget`, `responsibility`, `target_period` as direct columns on
   `activities` (`plan_service.go`). Migration 013 dropped exactly those
   three columns in favor of per-KPI fields (§3, **KPI**) — `models.go`'s
   own comment confirms it. If migration 013 is applied,
   `POST /plans/{planID}/duplicate` on a plan with any activities will fail
   with a SQL error, not actually duplicate anything. Needs a code fix, not
   just a doc note.

2. **Completeness score has no confirmed live endpoint.** `completeness.go`'s
   doc comment claims it's returned as extra fields on `GetProgress`'s
   response; `PlanProgress` (§3) has no such fields, and nothing reviewed
   across any batch calls `ComputeCompleteness`. Either it's wired up
   somewhere not yet reviewed, or it's unfinished/dead code — confirm before
   documenting a completeness field/route as live anywhere downstream.

3. **`UpdatePlan`'s archived-plan guard is conditionally bypassed.** The
   `"archived plans cannot be updated"` check only runs when the request
   includes a `status` field — a request that only changes, say,
   `description` on an archived plan currently sails through untouched.
   Might be intentional (archived plans could reasonably still allow
   non-status edits) or might be a gap — worth confirming intent.

4. **Error status codes are inconsistent, but in a learnable pattern.**
   `404` is reserved for exactly six single-resource `GET`s across the
   entire API (`GetPlan`, `GetActivity`, SSO `GetConfig`, admin
   `GetOrgDetail`, Report `Poll`, Report `Download`); every other "not
   found" anywhere in the API — including a bad ID on almost any `PUT` or
   `DELETE` — surfaces as `400`. A generated SDK or a "how to detect a
   not-found error" guide needs to hard-code this list rather than trust
   HTTP status alone.

5. **Org-structure roles only catch a direct self-report cycle.**
   `UpdateOrgStructureRole` rejects `reports_to_id == roleID` but not a
   longer cycle (A→B→C→A) — unlike the activity-link graph, which has full
   BFS cycle detection. A client building an org-chart UI shouldn't assume
   the API guarantees an acyclic `reports_to_id` graph.

6. **`logo_url` exists on the org model with no endpoint that sets it.**
   Per the (admittedly stale) README's own "known gaps" list — not
   independently re-verified in this pass, but nothing in `org.go` or
   `admin.go` writes it, consistent with the claim. Relevant to anyone
   planning branded-report work.

7. **Self-modification protection on org-tier users is unconfirmed.** The
   platform-tier `PATCH /api/v1/admin/platform-users/{userID}` explicitly
   blocks a `super_admin` from changing their own role/active status
   (`400 cannot change your own platform role or active status`). The
   org-tier equivalent, `PATCH /api/v1/org/users/{userID}`, shows no
   analogous check in `org.go` — it may live in `orgsvc` instead (not
   reviewed), or it may genuinely be absent, meaning an `org_admin` could
   demote or deactivate themselves with no one left to reverse it. Worth a
   direct check before assuming either way.

---

## 6. Appendix: Full Route Table

Every route across all reviewed handlers. **Role** blank = any authenticated
user (no `RequireRole` gate) or, for `/auth/*` and `/health`, fully public.
All paths relative to the shown prefix.

### Public
| Method | Path |
|---|---|
| GET | `/health` |
| POST | `/auth/login` |
| POST | `/auth/refresh` |
| POST | `/auth/logout` |
| POST | `/auth/password-reset/request` |
| POST | `/auth/password-reset/confirm` |
| GET | `/auth/saml/{orgSlug}/metadata` |
| POST | `/auth/saml/{orgSlug}/acs` |
| GET | `/auth/oidc/{orgSlug}/login` |
| GET | `/auth/oidc/{orgSlug}/callback` |
| POST | `/api/v1/invitations/accept` |

### Authenticated — `/api/v1/*`
| Method | Path | Role |
|---|---|---|
| GET | `/me` | — |
| PATCH | `/me` | — |
| POST | `/me/change-password` | — |
| GET | `/me/sessions` | — |
| POST | `/me/sessions/revoke-all` | — |
| GET | `/org/me` | — |
| GET | `/org` | — |
| PATCH | `/org` | org_admin |
| GET | `/org/users` | org_admin |
| PATCH | `/org/users/{userID}` | org_admin |
| GET | `/org/invitations` | org_admin |
| POST | `/org/invitations` | org_admin |
| DELETE | `/org/invitations/{invitationID}` | org_admin |
| POST | `/org/invitations/{invitationID}/resend` | org_admin |
| GET | `/org/sso` | org_admin |
| PUT | `/org/sso` | org_admin |
| DELETE | `/org/sso` | org_admin |
| GET | `/org/audit-log` | org_admin |
| GET | `/admin/stats` | super_admin, platform_support |
| GET | `/admin/orgs` | super_admin, platform_support |
| GET | `/admin/orgs/{orgID}` | super_admin, platform_support |
| GET | `/admin/audit-log` | super_admin, platform_support |
| GET | `/admin/platform-users` | super_admin, platform_support |
| GET | `/admin/platform-users/invitations` | super_admin, platform_support |
| POST | `/admin/orgs` | super_admin |
| PATCH | `/admin/orgs/{orgID}` | super_admin |
| DELETE | `/admin/orgs/{orgID}` | super_admin |
| POST | `/admin/org-invitations` | super_admin |
| POST | `/admin/platform-users/invitations` | super_admin |
| DELETE | `/admin/platform-users/invitations/{invitationID}` | super_admin |
| POST | `/admin/platform-users/invitations/{invitationID}/resend` | super_admin |
| PATCH | `/admin/platform-users/{userID}` | super_admin |
| GET | `/plans` | — |
| GET | `/plans/{planID}` | — |
| GET | `/plans/{planID}/progress` | — |
| GET | `/plans/{planID}/activities` | — |
| GET | `/plans/{planID}/links` | — |
| GET | `/plans/{planID}/auto-links` | — |
| GET | `/plans/{planID}/pillars` | — |
| GET | `/plans/{planID}/objectives` | — |
| GET | `/plans/{planID}/core-values` | — |
| GET | `/plans/{planID}/stakeholders` | — |
| GET | `/plans/{planID}/swot-items` | — |
| GET | `/plans/{planID}/pestel-items` | — |
| GET | `/plans/{planID}/org-structure-roles` | — |
| GET | `/plans/{planID}/me-items` | — |
| GET | `/plans/{planID}/milestones` | — |
| GET | `/plans/{planID}/reports` | — |
| POST | `/plans` | org_admin, planner |
| PUT | `/plans/{planID}` | org_admin, planner |
| DELETE | `/plans/{planID}` | org_admin |
| POST | `/plans/{planID}/duplicate` | org_admin, planner |
| POST | `/plans/{planID}/activities` | org_admin, planner |
| POST | `/plans/{planID}/viewers` | org_admin |
| DELETE | `/plans/{planID}/viewers/{userID}` | org_admin |
| POST | `/plans/{planID}/pillars` | org_admin, planner |
| POST | `/plans/{planID}/milestones` | org_admin, planner |
| POST | `/plans/{planID}/reports` | org_admin, planner |
| PUT | `/plans/{planID}/strategic-focus` | org_admin, planner |
| POST | `/plans/{planID}/core-values` | org_admin, planner |
| POST | `/plans/{planID}/stakeholders` | org_admin, planner |
| POST | `/plans/{planID}/swot-items` | org_admin, planner |
| POST | `/plans/{planID}/pestel-items` | org_admin, planner |
| POST | `/plans/{planID}/org-structure-roles` | org_admin, planner |
| POST | `/plans/{planID}/me-items` | org_admin, planner |
| GET | `/activities/{activityID}` | — |
| GET | `/activities/{activityID}/links` | — |
| PUT | `/activities/{activityID}` | org_admin, planner, contributor* |
| DELETE | `/activities/{activityID}` | org_admin, planner |
| POST | `/activities/{activityID}/links` | org_admin, planner |
| DELETE | `/activities/{activityID}/links/{linkID}` | org_admin, planner |
| PUT | `/pillars/{pillarID}` | org_admin, planner |
| DELETE | `/pillars/{pillarID}` | org_admin, planner |
| POST | `/pillars/{pillarID}/objectives` | org_admin, planner |
| PUT | `/objectives/{objectiveID}` | org_admin, planner |
| DELETE | `/objectives/{objectiveID}` | org_admin, planner |
| PUT | `/core-values/{coreValueID}` | org_admin, planner |
| DELETE | `/core-values/{coreValueID}` | org_admin, planner |
| PUT | `/stakeholders/{stakeholderID}` | org_admin, planner |
| DELETE | `/stakeholders/{stakeholderID}` | org_admin, planner |
| PUT | `/swot-items/{swotItemID}` | org_admin, planner |
| DELETE | `/swot-items/{swotItemID}` | org_admin, planner |
| PUT | `/pestel-items/{pestelItemID}` | org_admin, planner |
| DELETE | `/pestel-items/{pestelItemID}` | org_admin, planner |
| PUT | `/org-structure-roles/{roleID}` | org_admin, planner |
| DELETE | `/org-structure-roles/{roleID}` | org_admin, planner |
| PUT | `/me-items/{meItemID}` | org_admin, planner |
| DELETE | `/me-items/{meItemID}` | org_admin, planner |
| PUT | `/milestones/{milestoneID}` | org_admin, planner |
| DELETE | `/milestones/{milestoneID}` | org_admin |
| POST | `/ai/draft` | org_admin, planner |
| POST | `/ai/summary` | org_admin, planner |
| POST | `/ai/suggest-links` | org_admin, planner |
| GET | `/reports/{jobID}` | — |
| GET | `/reports/{jobID}/download` | — |

\* contributor restricted to activities assigned to them — see §2.

**Total: 11 public + 95 authenticated = 106 routes**, all cross-checked
directly against the `router.go` included in this batch.