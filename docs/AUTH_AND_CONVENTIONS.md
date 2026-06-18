# Authentication, Authorization & Conventions

Companion to `API_REFERENCE.md`. This document covers everything that applies *across* endpoints rather than to one specific route: how to authenticate, the full role/permission matrix, token lifecycle, and a couple of integration recipes.

---

## 1. The token model

StratPlan uses a standard **access token + refresh token** pair.

| Token | Lifetime (default) | Where it lives | Purpose |
|---|---|---|---|
| Access token | 15 minutes | `Authorization: Bearer <token>` header on every request | Proves identity + carries role/org claims |
| Refresh token | 30 days | Request body, only on `/auth/refresh` and `/auth/logout` | Exchanged for a new access+refresh pair |

Both lifetimes are server-configurable (`JWT_ACCESS_EXPIRY_MIN`, `JWT_REFRESH_EXPIRY_DAYS`) — don't hardcode 15/30 in client logic; treat the `expires_at` field on the login/refresh response as the source of truth for the refresh token's expiry, and decode the access token's own `exp` claim if you need its expiry specifically.

### Claims inside the access token

The JWT payload (decode it client-side if useful — it's signed, not encrypted, so it's readable but not forgeable) contains:

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

Every call to `/auth/refresh` **consumes** the presented refresh token (marks it revoked) and issues a brand new pair. This means:

- You cannot refresh the same token twice — the second attempt gets `401 refresh token has been revoked`.
- Store only the *latest* refresh token client-side; discard the old one immediately after a successful refresh.
- If you ever see `refresh token has been revoked` unexpectedly (not from a double-refresh bug in your own client), treat it as a signal the token may have been stolen and force a full re-login — the server logs this server-side as a `WARN` for the same reason.

### What "logged out" actually means

`POST /auth/logout` revokes the refresh token only. The access token that was issued alongside it is **not** revoked and will continue to authenticate requests until it naturally expires (≤15 minutes later). This is a deliberate tradeoff (no server-side access-token blocklist to check on every request) — if your application has a strict "logout must be instant everywhere" requirement, that's not what this implements; the closest equivalent in the current API is deactivating the user entirely (`PATCH /api/v1/org/users/{userID}` with `is_active: false`), which is obviously not appropriate for a routine logout.

---

## 2. Role & permission matrix

There are two tiers of role. **Platform tier** roles have no `org_id` and operate across every organisation. **Organisation tier** roles are scoped to exactly one org via the `org_id` claim.

### Platform tier

| Role | Read orgs | Create/update orgs | Send org invitations | Everything else |
|---|---|---|---|---|
| `super_admin` | Yes | Yes | Yes | No access to any org's plans/activities/users — platform admin is a separate concern from org-level work in this API |
| `platform_support` | Yes | No | No | Same — read-only, orgs list only |

### Organisation tier

| Action | `org_admin` | `planner` | `contributor` | `viewer` |
|---|---|---|---|---|
| List/view plans | Yes | Yes | Yes | Yes (possibly scoped — see below) |
| Create/update plans | Yes | Yes | No | No |
| Delete plans | Yes | No | No | No |
| List/view activities | Yes | Yes | Yes | Yes |
| Create activities | Yes | Yes | No | No |
| Update **any** activity | Yes | Yes | No | No |
| Update **assigned** activity | Yes | Yes | Only if `assigned_to` includes them | No |
| Create activity links | Yes | Yes | No | No |
| View progress | Yes | Yes | Yes | Yes |
| List/manage org users | Yes | No | No | No |
| Send/cancel/resend invitations | Yes | No | No | No |

**Viewer scoping:** a `viewer` sees every plan in the org *unless* they have at least one row in `plan_viewers`, in which case they see only those specific plans. There is currently no API endpoint that directly manages `plan_viewers` rows — the intended path is via `plan_ids` on an invitation (see `API_REFERENCE.md` section 2.4), though that wiring has a known gap (the rows aren't actually created on acceptance yet).

### How role checks fail

Two distinct failure modes, easy to confuse:

| Response | Meaning |
|---|---|
| `401 missing or invalid authorization header` | No `Bearer` token at all, or it failed to parse |
| `401 invalid or expired token` | Token parsed but signature/expiry check failed |
| `403 forbidden` | Token is valid, but the role isn't in the allowed set for this route |
| `403 no organisation context` | Token is valid and role-permitted, but the route requires an org-scoped user and this token has no `org_id` (i.e. a platform-tier token was used against an org-tier route) |

---

## 3. Multi-tenancy model

Every plan, activity, and user belongs to exactly one organisation (`org_id`). The application enforces this by filtering **every** query explicitly by `org_id` server-side — you never need to (and never should) pass an org ID in the request body or query string for org-tier routes; it's always derived from the caller's JWT.

There is also a database-level defense-in-depth layer (PostgreSQL row-level security, added in migration `002`), but as of this document it is **not yet wired into the live connection pool** — see `internal/database/rls.go` in the codebase for the specific gap. This does not weaken current tenant isolation (the application-level filtering is complete and independently sufficient); it just means RLS isn't yet providing its intended second layer of protection.

---

## 4. Integration recipes

### 4.1 Basic login then authenticated request flow

```
POST /auth/login
  { "email": "...", "password": "..." }
  -> { access_token, refresh_token, expires_at, user }

Store access_token in memory, refresh_token in a secure store
(httpOnly cookie or platform secure storage -- NOT localStorage if avoidable).

GET /api/v1/plans
  Header: Authorization: Bearer <access_token>
  -> [ ...plans ]
```

### 4.2 Handling access token expiry

The cleanest approach: attempt the request, and on `401 invalid or expired token` specifically, try a silent refresh once, then retry the original request. Don't retry on other `401` causes (e.g. `account is deactivated`) — that's a terminal state requiring re-login, not a refresh.

```
function apiRequest(path, options):
  response = fetch(path, withAuthHeader(options))
  if response.status == 401 and response.error == "invalid or expired token":
    newTokens = POST /auth/refresh { refresh_token: stored }
    if newTokens succeeded:
      store(newTokens)
      response = fetch(path, withAuthHeader(options, newTokens.access_token))
    else:
      redirectToLogin()
  return response
```

### 4.3 Creating a plan with activities across all three phases

Phase is a label only — there's no ordering requirement. A natural flow that takes advantage of this:

```
POST /api/v1/plans
  { "title": "2026 Growth Strategy" }
  -> plan { id: "P" }

POST /api/v1/plans/P/activities
  { "phase": "P1", "type": "swot", "title": "SWOT Analysis" }

POST /api/v1/plans/P/activities
  { "phase": "P2", "type": "okr", "title": "Q1 OKRs" }

POST /api/v1/plans/P/activities
  { "phase": "P3", "type": "roadmap", "title": "Q1 Roadmap" }

GET /api/v1/plans/P/progress
  -> { phases: [P1: 1 total, P2: 1 total, P3: 1 total], overall: {...} }
```

### 4.4 Linking related activities

```
POST /api/v1/activities/<swot-id>/links
  { "target_id": "<okr-id>", "link_type": "manual" }
```

Remember: there's no "list links for activity X" endpoint yet. If you need to render a link graph for a plan, the current workaround is fetching all activities for the plan and separately querying the database directly, or waiting for that endpoint to be added.

### 4.5 Contributor self-service update

A `contributor` can update an activity only if their own user ID is present in that activity's `assigned_to` array. This is checked server-side, but if you're building a UI, check `assigned_to` client-side too so you can simply not show an edit button rather than letting the user hit a 403.

```
GET /api/v1/plans/P/activities
  -> activities, each with assigned_to: [...]

// client-side: only show "Edit" if currentUser.id is in activity.assigned_to
```

---

## 5. Things to watch for when integrating

1. **Status code inconsistency for "not found."** Only `GET /api/v1/plans/{planID}` returns a real `404`. Every other "this ID doesn't exist" case returns `400` with a descriptive `error` string. Don't branch your error handling on status code alone for these cases — check the `error` message text, or treat 400 and 404 the same way for "resource missing" UX.

2. **`PATCH /api/v1/org/users/{userID}` response is missing `last_login_at`.** If your client renders a user list and then patches one user in place from this response, you'll lose that field unless you merge rather than replace.

3. **Plan-scoped viewer invitations don't fully work yet.** Sending an invite with `plan_ids` populated stores the intent but doesn't currently restrict the resulting viewer's visibility — they'll see all plans in the org until the `plan_viewers` wiring is completed server-side.

4. **Archived plans are a one-way door.** Once a plan's `status` is set to `archived` via `PUT /api/v1/plans/{planID}`, no further updates to that plan are accepted — including trying to set it back to `active`. If your UI offers an "archive" action, make sure it's clearly communicated as (currently) irreversible.

5. **The rate limiter is per-process, in-memory.** If StratPlan is ever deployed with more than one API instance behind a load balancer, each instance tracks its own counts — a client could get up to `10 x N` attempts across `N` instances before universally hitting 429. Not a client-side concern today (single instance), but worth knowing if login-related UX (e.g. "you've been locked out, try again in 5 minutes") needs to be perfectly accurate later.

6. **`org_id` is absent, not null, for platform-tier users.** If your client does `response.user.org_id === null` to detect platform-tier users, that check will fail — the field isn't present in the JSON at all (`omitempty`). Use `'org_id' in response.user` or equivalent, or just branch on `role` instead, which is more direct anyway.
