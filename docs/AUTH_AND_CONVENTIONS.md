# Authentication, Authorization & Conventions

Companion to `API_REFERENCE.md`. This document covers everything that applies *across* endpoints rather than to one specific route: how to authenticate, the full role/permission matrix, token lifecycle, SSO, and integration recipes.

Updated through **Sprint A** — reflects all auth fixes from Sprint B (org activation on invite acceptance, plan_viewers wiring) and Sprint A (SSO config endpoints, RLS middleware).

---

## 1. The token model

StratPlan uses a standard **access token + refresh token** pair.

| Token | Lifetime (default) | Where it lives | Purpose |
|---|---|---|---|
| Access token | 15 minutes | `Authorization: Bearer <token>` header on every request | Proves identity + carries role/org claims |
| Refresh token | 30 days | Request body, only on `/auth/refresh` and `/auth/logout` | Exchanged for a new access+refresh pair |

Both lifetimes are server-configurable (`JWT_ACCESS_EXPIRY_MIN`, `JWT_REFRESH_EXPIRY_DAYS`) — don't hardcode 15/30 in client logic; treat the `expires_at` field on the login/refresh response as the source of truth for the refresh token's expiry, and decode the access token's own `exp` claim if you need its expiry specifically.

### Claims inside the access token

The JWT payload (decode client-side if useful — it's signed, not encrypted, so it's readable but not forgeable) contains:

```json
{
  "sub": "<user id>",
  "user_id": "<user id>",
  "org_id": "<org id, or absent for platform-tier roles>",
  "role": "org_admin",
  "email": "admin@acme.test",
  "iat": 1781674049,
  "exp": 1781674949
}
```

### Refresh token rotation

Every call to `/auth/refresh` **consumes** the presented refresh token (marks it revoked) and issues a brand-new pair. This means:

- You cannot refresh the same token twice — the second attempt gets `401 refresh token has been revoked`.
- Store only the *latest* refresh token client-side; discard the old one immediately after a successful refresh.
- If you see `refresh token has been revoked` unexpectedly (not from a double-refresh bug in your own client), treat it as a signal the token may have been stolen and force a full re-login. The server logs a `WARN` for the same reason.

### What "logged out" actually means

`POST /auth/logout` revokes the refresh token only. The access token issued alongside it **is not revoked** and continues to authenticate requests until it naturally expires (≤15 minutes). This is a deliberate tradeoff (no server-side access-token blocklist to check on every request). If "logout must be instant everywhere" is a hard requirement, the closest equivalent is deactivating the user (`PATCH /api/v1/org/users/{userID}` with `is_active: false`) — obviously not appropriate for a routine logout, but that's the current ceiling without a token blocklist.

---

## 2. Role & permission matrix

There are two tiers of role. **Platform-tier** roles have no `org_id` and operate across every organisation. **Organisation-tier** roles are scoped to exactly one org via the `org_id` claim in the JWT.

### Platform tier

| Role | Read orgs | Mutate orgs | Send org invitations | Org-level data |
|---|---|---|---|---|
| `super_admin` | ✓ | ✓ | ✓ | No access — platform admin is separate from org-level work |
| `platform_support` | ✓ | — | — | No access — read-only, orgs list only |

### Organisation tier

| Action | `org_admin` | `planner` | `contributor` | `viewer` |
|---|---|---|---|---|
| List/view plans | ✓ | ✓ | ✓ | ✓ (possibly scoped) |
| Create/update plans | ✓ | ✓ | — | — |
| Delete plans | ✓ | — | — | — |
| List/view activities | ✓ | ✓ | ✓ | ✓ |
| Create activities | ✓ | ✓ | — | — |
| Update **any** activity | ✓ | ✓ | — | — |
| Update **assigned** activity | ✓ | ✓ | Only if in `assigned_to` | — |
| Create activity links | ✓ | ✓ | — | — |
| View links / auto-links | ✓ | ✓ | ✓ | ✓ |
| View progress | ✓ | ✓ | ✓ | ✓ |
| Create/update milestones | ✓ | ✓ | — | — |
| Delete milestones | ✓ | — | — | — |
| List milestones | ✓ | ✓ | ✓ | ✓ |
| Grant/revoke plan viewers | ✓ | — | — | — |
| List/manage org users | ✓ | — | — | — |
| Send/cancel/resend invitations | ✓ | — | — | — |
| Manage SSO config | ✓ | — | — | — |

**Viewer scoping (now fully wired as of Sprint B):**
A `viewer` sees every plan in the org *unless* they have at least one row in `plan_viewers`, in which case they see only those specific plans. `plan_viewers` rows are now created in two ways:
1. Automatically when a viewer invitation with `plan_ids` set is accepted (`POST /invitations/accept`).
2. Directly by an org admin via `POST /api/v1/plans/{planID}/viewers`.

### How role checks fail

| Response | Meaning |
|---|---|
| `401 missing or invalid authorization header` | No `Bearer` token, or failed to parse |
| `401 invalid or expired token` | Token parsed but signature/expiry check failed |
| `403 forbidden` | Token valid, but role isn't in the allowed set for this route |
| `403 no organisation context` | Token valid and role-permitted, but route requires an org-scoped user and this token has no `org_id` (platform-tier token used against an org-tier route) |

---

## 3. Multi-tenancy model

Every plan, activity, and user belongs to exactly one organisation (`org_id`). The application enforces this at two layers:

**Application layer:** every service method filters by `org_id` explicitly. This is complete and independently sufficient for tenant isolation.

**Database layer (now active):** PostgreSQL row-level security (migration `002`) is now wired into the request path via `middleware.WithRLS`. At the start of every authenticated request, a dedicated connection is acquired from the pool and `SET app.current_org_id = '<uuid>'` is called on it. Platform-tier users get `SET app.bypass_rls = 'true'` instead.

> **Partial coverage note:** Service methods currently call `s.db.Query/Exec` (pool), not the RLS-pinned connection from context. The middleware sets the session variables, but they only apply to the *pinned* connection — pool-direct queries in service methods still bypass RLS. Migrating service methods to use `middleware.ConnFrom(ctx)` is the remaining work. See `internal/middleware/rls.go` for the migration pattern and priority order. This does not weaken security — the application-layer filters are complete — but RLS isn't yet providing its intended second layer.

---

## 4. SSO model ✨ Updated in Sprint A

SSO is optional per organisation. The configuration endpoints are fully implemented. The authentication flows (SAML ACS, OIDC callback) are `501` stubs until the library integration is complete.

### How SSO fits the token model

Regardless of how a user authenticates (password or SSO), the server issues the same JWT access + refresh token pair on success. There is no separate SSO session — from the client's perspective, the token lifecycle is identical.

### SSO configuration endpoints

An org admin configures SSO via `PUT /api/v1/org/sso`. The config is an upsert — one row per org, one protocol at a time. Switching from SAML to OIDC means PUTting a new config; the old one is fully replaced.

**SAML setup flow:**
1. Org admin calls `PUT /api/v1/org/sso` with `protocol: "saml"` and either `metadata_url` or `entity_id` + `certificate`.
2. Org admin copies the SP metadata URL (`GET /auth/saml/{orgSlug}/metadata` — currently `501`) into the IdP.
3. Users can then log in via `GET /auth/oidc/{orgSlug}/login` — `501` until Sprint A SSO auth flows land.

**OIDC setup flow:**
1. Create an application in the IdP (Google, Okta, Azure, etc.) with the callback URL `{APP_URL}/auth/oidc/{orgSlug}/callback`.
2. Org admin calls `PUT /api/v1/org/sso` with `protocol: "oidc"`, `client_id`, `client_secret`, and `discovery_url`.
3. Users log in via `GET /auth/oidc/{orgSlug}/login` — `501` until Sprint A SSO auth flows land.

### JIT provisioning

When `jit_enabled: true` (the default), on a user's first SSO login the server auto-creates an account with the `default_role` from the config. Subsequent logins find the existing account. The org admin can change the role afterwards via `PATCH /api/v1/org/users/{userID}`.

When `jit_enabled: false`, only users with pre-existing accounts (created via invitation) can log in via SSO.

### Disabling local login

Setting `local_login_disabled: true` in the SSO config blocks `POST /auth/login` for that org's users — the server returns `401 this account uses SSO`. If the SSO config is later deleted (`DELETE /api/v1/org/sso`), local login is immediately re-enabled regardless of what `local_login_disabled` was.

---

## 5. Invite flows

All user onboarding is invite-based — no open self-registration.

| Invite type | Initiated by | Recipient | Expiry | Key flow |
|---|---|---|---|---|
| **Platform invite** | `super_admin` | New org admin contact | 7 days | Super admin calls `POST /api/v1/admin/org-invitations`. Recipient accepts via `POST /invitations/accept`. **Org is now activated automatically on acceptance** (Sprint B fix). |
| **Org user invite** | `org_admin` | New user (any org role) | 72 hours | Org admin calls `POST /api/v1/org/invitations`. `plan_ids` restricts viewer scope. **plan_viewers rows are now created on acceptance** (Sprint B fix). |
| **SSO JIT** | IdP | User in IdP directory | n/a | Auto-creates account on first SSO login. No invite email. Requires `jit_enabled: true` in SSO config. `[501 — Sprint A auth flows pending]` |

### Invitation lifecycle

```
pending → accepted  (recipient clicks link, signs up)
pending → cancelled (org admin cancels)
pending → expired   (TTL passes)
expired → pending   (org admin resends — new token, new expiry)
```

Accepted is terminal — once accepted, the invitation cannot be modified. Cancelled invitations can be resent (they transition back to pending with a new token).

---

## 6. Integration recipes

### 6.1 Basic login then authenticated request

```
POST /auth/login
  { "email": "...", "password": "..." }
  → { access_token, refresh_token, expires_at, user }

Store access_token in memory.
Store refresh_token in a secure store (httpOnly cookie or platform secure storage — NOT localStorage).

GET /api/v1/plans
  Authorization: Bearer <access_token>
  → [ ...plans ]
```

### 6.2 Handling access token expiry

Attempt the request first; on `401 invalid or expired token` specifically, try a silent refresh once, then retry. Don't retry on other `401` causes — those are terminal states requiring re-login.

```
function apiRequest(path, options):
  response = fetch(path, withAuthHeader(options))
  if response.status == 401 and response.body.error == "invalid or expired token":
    newTokens = POST /auth/refresh { refresh_token: stored }
    if newTokens.ok:
      store(newTokens)
      return fetch(path, withAuthHeader(options, newTokens.access_token))
    else:
      redirectToLogin()
  return response
```

### 6.3 Creating a plan with activities across all three phases

Phase is a label only — no ordering enforced.

```
POST /api/v1/plans
  { "title": "2026 Growth Strategy" }
  → plan { id: "P" }

POST /api/v1/plans/P/activities
  { "phase": "P1", "type": "swot", "title": "SWOT Analysis" }

POST /api/v1/plans/P/activities
  { "phase": "P3", "type": "roadmap", "title": "Q1 Roadmap" }   ← P3 before P2, that's fine

POST /api/v1/plans/P/activities
  { "phase": "P2", "type": "okr", "title": "Q1 OKRs" }

GET /api/v1/plans/P/progress
  → { phases: [P1: 1 total, P2: 1 total, P3: 1 total], completeness_score: 60.0, ... }
```

### 6.4 Using the auto-link engine

After activities are created, check whether the engine suggests any links:

```
GET /api/v1/plans/P/auto-links
  → [
      { source_id: "<swot-id>", target_id: "<okr-id>",
        source_type: "swot", target_type: "okr",
        reason: "SWOT analysis contextualises OKR definition" }
    ]

# If the suggestion looks good, accept it:
POST /api/v1/activities/<swot-id>/links
  { "target_id": "<okr-id>", "link_type": "auto" }
```

### 6.5 Linking activities manually

```
POST /api/v1/activities/<swot-id>/links
  { "target_id": "<risk-register-id>", "link_type": "manual" }
  → ActivityLink { id, source_id, target_id, link_type, ... }

# See all links for a plan:
GET /api/v1/plans/P/links
  → [ ...ActivityLink ]

# Or for a specific activity (source or target):
GET /api/v1/activities/<swot-id>/links
  → [ ...ActivityLink ]
```

### 6.6 Contributor self-service update

A `contributor` can update an activity only if their user ID is in `assigned_to`. The server enforces this, but check client-side too to avoid a visible 403:

```
GET /api/v1/plans/P/activities
  → activities, each with assigned_to: [...]

// Only show "Edit" if currentUser.id is in activity.assigned_to

PUT /api/v1/activities/<id>
  { "status": "in_progress", "content": { ... } }
```

### 6.7 Configuring SSO

```
# 1. Set up OIDC config
PUT /api/v1/org/sso
  Authorization: Bearer <org_admin_token>
  {
    "protocol": "oidc",
    "client_id": "stratplan-prod",
    "client_secret": "...",
    "discovery_url": "https://accounts.google.com",
    "default_role": "viewer",
    "jit_enabled": true,
    "local_login_disabled": false
  }
  → SSOConfig (client_secret omitted)

# 2. Verify it's stored
GET /api/v1/org/sso
  → SSOConfig

# 3. Remove if needed (re-enables local login immediately)
DELETE /api/v1/org/sso
  → { "message": "SSO configuration removed" }
```

### 6.8 Granting plan-scoped viewer access to an existing user

```
# User already has an account with role "viewer" in the org.
# Restrict them to specific plans:

POST /api/v1/plans/P/viewers
  Authorization: Bearer <org_admin_token>
  { "user_id": "<viewer-user-id>" }
  → { "message": "viewer access granted" }

# Revoke:
DELETE /api/v1/plans/P/viewers/<viewer-user-id>
  → { "message": "viewer access revoked" }
```

---

## 7. Things to watch for when integrating

1. **Status code inconsistency for "not found."** Only `GET /api/v1/plans/{planID}` and `GET /api/v1/org/sso` return a real `404`. Every other "this ID doesn't exist" case returns `400` with a descriptive `error` string. Check the `error` message text, or treat 400 and 404 the same way for missing-resource UX.

2. **`PATCH /api/v1/org/users/{userID}` response is missing `last_login_at`.** If your client renders a user list and then patches one user in place, you'll lose that field unless you merge rather than replace.

3. **Archived plans are a one-way door.** Once `status` is set to `archived` via `PUT /api/v1/plans/{planID}`, no further updates are accepted — including trying to revert to `active`. Make sure your UI communicates this clearly.

4. **The rate limiter is per-process, in-memory.** With a single API instance this is fine. Behind a load balancer with N instances, a client gets up to `10 × N` attempts before universally hitting 429. Replace with a Redis-backed limiter before multi-instance deployment.

5. **`org_id` is absent, not null, for platform-tier users.** `response.user.org_id === null` won't detect platform users — the field is omitted from the JSON entirely (`omitempty`). Use `'org_id' in response.user` or branch on `role` instead.

6. **`client_secret` and `certificate` are never returned** by `GET /api/v1/org/sso`. These are write-only fields. To check whether a certificate is configured, use the presence of `entity_id` as a proxy.

7. **Auto-links are suggestions, not actions.** `GET /api/v1/plans/{planID}/auto-links` is read-only. Nothing is written until you `POST /api/v1/activities/{id}/links` with the suggested pair.

8. **Cycle detection is server-enforced.** Creating a link that would result in a cycle (A→B→C→A) returns `400 this link would create a cycle`. The schema's `CHECK (source_id <> target_id)` still catches self-links at the DB level as a second defence.

9. **SSO auth flows return 501.** The SSO config endpoints (GET/PUT/DELETE `/api/v1/org/sso`) are fully functional. The authentication flows (`/auth/saml/*`, `/auth/oidc/*`) return `501` until Sprint A completes. Don't surface SSO login buttons to users yet.