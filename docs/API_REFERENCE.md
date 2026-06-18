# StratPlan API Reference

**Version:** Sprint 1 + Sprint 2 (as of this document)
**Base URL (local dev):** `http://localhost:8080`
**Format:** All requests and responses are `application/json`.

This document is generated from the actual handler and service code, not from a spec written ahead of implementation — every field name, status code, and error string below is what the server actually does. If something here ever drifts from the code, the code wins; please flag it so this doc can be corrected.

For a narrative walkthrough (auth lifecycle, RBAC table, response envelope rules) see `AUTH_AND_CONVENTIONS.md`. For a ready-to-import request collection see `stratplan.postman_collection.json`.

---

## Table of contents

1. [Response conventions](#response-conventions)
2. [Authentication](#1-authentication)
3. [Organisation admin](#2-organisation-admin)
4. [Platform admin](#3-platform-admin)
5. [Plans](#4-plans)
6. [Activities](#5-activities)
7. [Not yet implemented](#6-not-yet-implemented-sprint-3)
8. [Data model reference](#7-data-model-reference)

---

## Response conventions

StratPlan does **not** use one envelope shape for every response. This is intentional, not an inconsistency — read this section before integrating.

### Success responses

Successful responses (`2xx`) return the **raw resource or array directly** — there is no `{"data": ...}` wrapper.

```http
GET /api/v1/plans
200 OK

[
  { "id": "...", "title": "2026 Growth Strategy", ... }
]
```

A small number of action endpoints (logout, cancel invitation, etc.) that don't return a resource respond with a plain message object:

```json
{ "message": "logged out" }
```

### Error responses

All errors use a consistent envelope:

```json
{
  "success": false,
  "error": "invalid credentials"
}
```

`error` is always a lower-case, human-readable sentence (it is literally `err.Error()` from the Go service layer in most cases). It is safe to show directly to end users for validation-style errors (400), but for 500s you should show a generic message instead — the raw text may include internal details.

### Status codes used across the API

| Code | Meaning here |
|------|--------------|
| `200` | Success (read or update) |
| `201` | Resource created |
| `400` | Validation error, malformed body, or a business-rule rejection (e.g. "nothing to update") |
| `401` | Missing/invalid/expired JWT, or bad login credentials |
| `403` | Authenticated but not authorized for this action (role check failed, or no org context) |
| `404` | Resource not found (currently only used by `GET /plans/{planID}`) |
| `429` | Rate limited (currently only `/auth/login`) |
| `500` | Unexpected server error |
| `501` | Route exists but isn't built yet (Sprint 3 stubs) |

Note the inconsistency the codebase currently has: most "not found" cases inside nested resources (e.g. updating an activity that doesn't exist) return **400**, not 404, because the service layer returns a generic `error` and the handler always maps service errors to 400 except for the single `GetPlan` case. Don't rely on 404 vs 400 to distinguish "not found" from "invalid input" anywhere except `GET /api/v1/plans/{planID}`.

### Request body parsing

All `POST`/`PUT`/`PATCH` bodies are decoded with `DisallowUnknownFields()` — sending a field the server doesn't recognise returns `400` with an error like `invalid request body: json: unknown field "foo"`. Body size is capped at 1 MB.

### Empty list semantics

List endpoints (`GET /api/v1/plans`, `GET /api/v1/plans/{id}/activities`) always return `[]`, never `null`, when there are no results.

---

## 1. Authentication

Base path: none (`/auth/*` and `/invitations/accept` are top-level, not under `/api/v1`).

All endpoints in this section are **public** (no `Authorization` header) except where noted.

### 1.1 `POST /auth/login`

Email + password login. **Rate-limited**: 10 attempts per 5 minutes per client IP, in-memory (see [Rate limiting](#rate-limiting) below).

**Request body**

```json
{
  "email": "admin@acme.test",
  "password": "password123"
}
```

**Response `200`**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "77ae343455fd054eaa4399e3a07606b...",
  "expires_at": "2026-07-17T05:27:29.32360863Z",
  "user": {
    "id": "22222222-2222-2222-2222-222222222222",
    "name": "Acme Admin",
    "email": "admin@acme.test",
    "role": "org_admin",
    "org_id": "11111111-1111-1111-1111-111111111111"
  }
}
```

`org_id` is **absent** (omitted, not null) for `super_admin` and `platform_support` users — they are platform-tier and not scoped to a single org.

`expires_at` is the **refresh token's** expiry (30 days by default), not the access token's. The access token's own expiry (15 minutes by default) is embedded in its JWT payload (`exp` claim) — decode the JWT client-side if you need it, or just refresh proactively rather than relying on this field for access-token timing.

**Errors (`401`)**

| `error` value | Cause |
|---|---|
| `invalid credentials` | Email not found, **or** password incorrect — deliberately identical message for both to prevent account enumeration |
| `account is deactivated` | User exists but `is_active = false` |
| `this account uses SSO — please sign in via your identity provider` | User has no `password_hash` set (SSO-only account) |

**Errors (`400`)** — if `email` or `password` is empty: `email and password are required`.

**Errors (`429`)** — `too many requests — please try again later` after 10 attempts in 5 minutes from the same IP, regardless of whether those attempts were against the same account.

---

### 1.2 `POST /auth/refresh`

Rotates a refresh token: the presented token is immediately revoked and a new access + refresh pair is issued. There is no way to "peek" at a refresh token without consuming it.

**Request body**

```json
{ "refresh_token": "77ae343455fd054eaa4399e3a07606b..." }
```

**Response `200`** — same shape as login's `200` response.

**Errors**

| Status | `error` | Cause |
|---|---|---|
| `400` | `refresh_token is required` | Empty/missing field |
| `401` | `invalid refresh token` | Token not found in the DB |
| `401` | `refresh token has been revoked` | Token was already used once (rotation) or explicitly logged out. **This is a signal of possible token theft** — the server logs a `WARN` (`refresh token reuse detected`) when this happens. |
| `401` | `refresh token has expired` | Past its `expires_at` |
| `401` | `account is deactivated` | The owning user was deactivated since the token was issued |

---

### 1.3 `POST /auth/logout`

Revokes the presented refresh token server-side. Does **not** invalidate the access token — it will continue to work until its own 15-minute TTL expires. There is no access-token revocation list in this version; if you need immediate full revocation, deactivate the user instead (see [2.2](#22-patch-apiv1orgusersuserid)), which revokes all of that user's refresh tokens and is checked on every subsequent refresh.

**Request body**

```json
{ "refresh_token": "77ae343455fd054eaa4399e3a07606b..." }
```

**Response `200`**

```json
{ "message": "logged out" }
```

**Errors** — `400` if `refresh_token` is empty; `500` on a DB failure during revocation.

---

### 1.4 `POST /auth/password-reset/request`

Always returns `200` regardless of whether the email exists, to prevent account enumeration. If the email belongs to an active, non-deleted user, a reset email is sent with a link valid for **1 hour**.

**Request body**

```json
{ "email": "admin@acme.test" }
```

**Response `200`** (always, even for unknown emails)

```json
{ "message": "if that email exists, a reset link has been sent" }
```

---

### 1.5 `POST /auth/password-reset/confirm`

Consumes the one-time token from the reset email and sets a new password. **All of the user's existing refresh tokens are revoked** as part of this — they are logged out everywhere.

**Request body**

```json
{
  "token": "<plaintext token from the email link>",
  "password": "newSecurePassword123"
}
```

**Response `200`**

```json
{ "message": "password updated" }
```

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `invalid or expired reset token` | Token not found |
| `reset token has already been used` | `used_at` already set |
| `reset token has expired` | Past 1-hour window |
| `password must be at least 8 characters` | From the bcrypt hashing helper's own validation |

---

### 1.6 `POST /invitations/accept`

Accepts an invitation token (sent via `POST /api/v1/org/invitations` or `POST /api/v1/admin/org-invitations`), creates the user account, and immediately logs them in. Public endpoint — the token itself is the credential.

**Request body**

```json
{
  "token": "<plaintext invite token>",
  "name": "Jane Doe",
  "password": "securePassword123"
}
```

**Response `201`** — same shape as login's response (full token pair + user).

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `token, name and password are required` | Any of the three fields empty |
| `invalid invitation token` | Token not found |
| `invitation is no longer valid (status: <status>)` | Already accepted, cancelled, or previously marked expired |
| `invitation has expired` | Past `expires_at` (the row is also flipped to `status = 'expired'` as a side effect of this check) |
| `password must be at least 8 characters` | bcrypt validation |

---

## 2. Organisation admin

Base path: `/api/v1/org`
**Role required:** `org_admin` only, for every route in this section.
Every route also requires an org context — since `org_admin` is always org-scoped, this is automatically satisfied, but the handler still explicitly checks and returns `403 no organisation context` defensively.

### 2.1 `GET /api/v1/org/users`

Lists all non-deleted users in the caller's org, sorted by name.

**Response `200`**

```json
[
  {
    "id": "22222222-2222-2222-2222-222222222222",
    "org_id": "11111111-1111-1111-1111-111111111111",
    "email": "admin@acme.test",
    "name": "Acme Admin",
    "role": "org_admin",
    "locale": "en",
    "is_active": true,
    "last_login_at": "2026-06-17T05:27:29Z",
    "created_at": "2026-06-17T05:27:23Z",
    "updated_at": "2026-06-17T05:27:23Z"
  }
]
```

`password_hash` and `sso_subject` are never present (tagged `json:"-"` server-side).

---

### 2.2 `PATCH /api/v1/org/users/{userID}`

Partial update of a user's `role` and/or `is_active`. Supply only the field(s) you want to change.

**Request body** (both optional, at least one required)

```json
{
  "role": "planner",
  "is_active": false
}
```

**Behavior notes:**
- Cannot set `role` to `super_admin` or `platform_support` — rejected with `400 cannot assign platform roles via org admin`.
- Setting `is_active: false` immediately revokes **all** of that user's refresh tokens server-side (they're logged out everywhere on next refresh attempt).
- Both the role change and the active-status change are written to the audit log (`user.role_changed`, `user.active_status_changed`) with a before/after diff, attributed to the calling org_admin.

**Response `200`** — the updated user object. Note: this particular query does not re-select `last_login_at`, so that field is absent here even though it appears in the list endpoint (2.1) — a minor asymmetry worth knowing about if your client expects the field to always be present.

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `nothing to update` | Both fields omitted |
| `cannot assign platform roles via org admin` | `role` was `super_admin`/`platform_support` |
| `user not found in this organisation` | `userID` doesn't exist or belongs to a different org |

---

### 2.3 `GET /api/v1/org/invitations`

Lists all invitations ever sent for the caller's org (any status), newest first.

**Response `200`**

```json
[
  {
    "id": "...",
    "org_id": "11111111-1111-1111-1111-111111111111",
    "email": "newhire@acme.test",
    "role": "contributor",
    "invited_by": "22222222-2222-2222-2222-222222222222",
    "expires_at": "2026-06-20T05:27:23Z",
    "accepted_at": null,
    "status": "pending",
    "plan_ids": [],
    "created_at": "2026-06-17T05:27:23Z",
    "updated_at": "2026-06-17T05:27:23Z"
  }
]
```

`status` is one of `pending`, `accepted`, `cancelled`, `expired`. `plan_ids` is non-empty only for plan-scoped viewer invites (see 2.4).

---

### 2.4 `POST /api/v1/org/invitations`

Sends an invitation email to a new or existing-but-not-yet-onboarded user. Token expires in **72 hours**.

**Request body**

```json
{
  "email": "newhire@acme.test",
  "role": "contributor",
  "plan_ids": []
}
```

`plan_ids` is optional. If non-empty **and** `role` is `viewer`, the intent is that the invited user becomes a plan-scoped viewer (see [4.1](#41-get-apiv1plans) for how that affects what they can list). **Known gap:** the current `AcceptInvite` flow stores `plan_ids` on the invitation row but does not yet write corresponding rows into `plan_viewers` on acceptance — so plan-scoped viewer invites currently don't actually restrict visibility end-to-end yet. Flag this if plan-scoped viewer invites are a near-term priority.

**Allowed `role` values:** `org_admin`, `planner`, `contributor`, `viewer`. Anything else (including `super_admin`/`platform_support`) is rejected.

**Response `201`** — the created invitation object (same shape as 2.3's array items).

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `invalid role for org invite: <role>` | Role not in the allowed set above |
| `a pending invitation already exists for <email> — resend or cancel it first` | Duplicate pending invite for the same email in this org |

---

### 2.5 `DELETE /api/v1/org/invitations/{invitationID}`

Cancels a pending invitation. Only works on invitations with `status = pending`.

**Response `200`**

```json
{ "message": "invitation cancelled" }
```

**Errors (`400`)** — `invitation not found or already actioned` if the ID doesn't exist, belongs to another org, or isn't currently pending.

---

### 2.6 `POST /api/v1/org/invitations/{invitationID}/resend`

Generates a fresh token, extends expiry by another 72 hours from now, resets `status` to `pending`, and re-sends the invite email. Works even on expired invitations (i.e. this both "resends" and "un-expires").

**Response `200`**

```json
{ "message": "invitation resent" }
```

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `invitation not found` | Bad ID or wrong org |
| `invitation has already been accepted` | Cannot resend a completed invite |

---

## 3. Platform admin

Base path: `/api/v1/admin`
**Role required:** `super_admin` or `platform_support` can read (`GET`). All mutations (`POST`, `PATCH`) require `super_admin` specifically.

These users have **no `org_id`** in their JWT — they are not members of any single organisation.

### 3.1 `GET /api/v1/admin/orgs`

Lists organisations across the entire platform.

**Query parameters** (all optional)

| Param | Default | Notes |
|---|---|---|
| `active_only` | `false` | Pass `active_only=true` to filter to `is_active = true` only |
| `limit` | `50` | Negative or non-numeric values silently fall back to the default |
| `offset` | `0` | Same fallback behavior |

**Response `200`**

```json
[
  {
    "id": "11111111-1111-1111-1111-111111111111",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "locale": "en",
    "is_active": true,
    "created_at": "2026-06-17T05:27:23Z",
    "updated_at": "2026-06-17T05:27:23Z"
  }
]
```

(`logo_url` and `industry` appear when set; omitted via `omitempty` when null.)

---

### 3.2 `POST /api/v1/admin/orgs`

Creates a new, immediately **active** organisation directly — no invitation flow, no initial admin user. Use this when you'll add users separately (e.g. by seeding the database, or via a future "add first admin to org" endpoint).

**Request body**

```json
{
  "name": "Globex Inc",
  "industry": "Manufacturing",
  "locale": "en"
}
```

`industry` and `locale` are optional; `locale` defaults to `"en"`.

**Response `201`** — the created org. `slug` is auto-generated as `slugify(name) + "-" + first-8-chars-of-uuid` (e.g. `globex-inc-ba93ef8f`) to guarantee uniqueness without a collision-retry loop.

**Errors (`400`)** — `organisation name is required` if `name` is empty.

---

### 3.3 `PATCH /api/v1/admin/orgs/{orgID}`

Partial update of an organisation. Supply only the fields you want to change.

**Request body** (all optional, at least one required)

```json
{
  "name": "Globex International",
  "is_active": false,
  "industry": "Conglomerate",
  "locale": "fr"
}
```

**Behavior notes — deactivation is the important case here:**

Setting `is_active: false` (when it was previously `true`) triggers:
1. **Every refresh token belonging to every user in that org is revoked** in a single query (`UPDATE refresh_tokens ... FROM users WHERE u.org_id = $1`).
2. An email is sent to every user in the org whose role is `org_admin`, using the `org_deactivated` template.
3. An audit log entry (`organisation.active_status_changed`) is written.

Re-activating (`is_active: true`) does **not** automatically restore sessions — affected users simply log in again normally; nothing else needs to happen server-side.

**Response `200`** — the updated org.

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `nothing to update` | All four fields omitted |
| `organisation not found` | Bad ID, or `deleted_at` is set (soft-deleted orgs are invisible here — though note there is currently no endpoint that soft-deletes an org; this check exists defensively for future use) |

---

### 3.4 `POST /api/v1/admin/org-invitations`

The platform-level equivalent of "sign up a new customer." Creates a **new organisation in an inactive state** (`is_active = false`) and emails an invitation to a designated org-admin contact.

**Known gap:** accepting this invitation (via 1.6) only creates the user row and marks the invitation accepted — it does **not** flip the org's `is_active` to `true`. A `super_admin` currently has to separately call 3.3 to activate the org after the invite is accepted, if "auto-activate on first admin signup" is the expected behavior.

**Request body**

```json
{
  "email": "newcustomer@example.com",
  "org_name": "New Customer LLC"
}
```

**Response `201`** — the created invitation (role is always `org_admin`, `expires_at` is 7 days out — longer than the 72-hour user-invite window, since onboarding a whole new company is a bigger ask than joining an existing one).

**Errors (`400`)** — `email and org_name are required` if either is empty.

---

## 4. Plans

Base path: `/api/v1/plans`
All routes require an authenticated org-scoped user (any role). Write operations are further role-gated as noted per-route. `viewer` may be restricted to specific plans — see 4.1.

### 4.1 `GET /api/v1/plans`

Lists plans in the caller's org.

**Viewer scoping rule:** if the calling user is a `viewer` **and** has at least one row in `plan_viewers` (i.e. they've been explicitly granted access to specific plans), they see *only* those plans. If a `viewer` has **zero** `plan_viewers` rows, they are treated as an "org-wide viewer" and see every plan in the org. All other roles (`org_admin`, `planner`, `contributor`) always see every plan in the org regardless of `plan_viewers`.

**Response `200`**

```json
[
  {
    "id": "6f7bf728-a3c2-4577-850a-1622d13822b9",
    "org_id": "11111111-1111-1111-1111-111111111111",
    "title": "2026 Growth Strategy",
    "description": "Our first strategic plan",
    "status": "draft",
    "owner_id": "22222222-2222-2222-2222-222222222222",
    "start_date": null,
    "end_date": null,
    "created_at": "2026-06-17T05:27:39Z",
    "updated_at": "2026-06-17T05:27:39Z"
  }
]
```

Sorted newest-first (`created_at DESC`).

---

### 4.2 `POST /api/v1/plans`

**Role required:** `org_admin` or `planner`.

Creates a new plan with `status = "draft"` and `owner_id` set to the calling user.

**Request body**

```json
{
  "title": "2026 Growth Strategy",
  "description": "Our first strategic plan",
  "start_date": "2026-01-01T00:00:00Z",
  "end_date": "2026-12-31T00:00:00Z"
}
```

`description`, `start_date`, `end_date` are optional.

**Response `201`** — the created plan.

**Errors (`400`)** — `title is required` if empty.

---

### 4.3 `GET /api/v1/plans/{planID}`

Fetches a single plan. **This is the one endpoint in the entire API that correctly returns `404`** (everywhere else, "not found" comes back as `400` — see the [response conventions](#status-codes-used-across-the-api) note above).

**Response `200`** — the plan object (same shape as 4.1's array items).

**Errors (`404`)** — `plan not found` (covers: wrong ID, wrong org, or soft-deleted).

---

### 4.4 `PUT /api/v1/plans/{planID}`

**Role required:** `org_admin` or `planner`.

Partial update. Supply only the fields you want to change.

**Request body** (all optional, at least one required)

```json
{
  "title": "2026 Growth Strategy (Revised)",
  "description": "Updated scope",
  "status": "active",
  "start_date": "2026-02-01T00:00:00Z",
  "end_date": "2026-12-31T00:00:00Z"
}
```

`status` must be one of `draft`, `active`, `review`, `completed`, `archived`.

**Response `200`** — the updated plan.

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `nothing to update` | All fields omitted |
| `plan not found` | Bad ID / wrong org (note: `400` here, not `404`, unlike 4.3) |
| `archived plans cannot be updated` | Attempting any update — including re-activating — once `status = archived`. There is currently no "un-archive" path; this is a one-way door. |
| `title cannot be empty` | `title` provided as an empty string |

---

### 4.5 `DELETE /api/v1/plans/{planID}`

**Role required:** `org_admin` only.

Soft-deletes the plan (`deleted_at = NOW()`) and cascades the soft-delete to every activity in it. This is **not reversible via the API** — there's no "undelete" endpoint; restoring would currently require a direct DB update.

**Response `200`**

```json
{ "message": "plan deleted" }
```

**Errors (`400`)** — `plan not found`.

---

### 4.6 `GET /api/v1/plans/{planID}/activities`

Lists activities within a plan, sorted by `phase` then `user_order`.

**Query parameters**

| Param | Required | Notes |
|---|---|---|
| `phase` | No | Filter to one phase: `P1`, `P2`, or `P3`. Any other value → `400 phase must be P1, P2, or P3`. |

**Response `200`**

```json
[
  {
    "id": "69adcc0c-1053-46cc-926e-78bc6784b90a",
    "plan_id": "6f7bf728-a3c2-4577-850a-1622d13822b9",
    "org_id": "11111111-1111-1111-1111-111111111111",
    "phase": "P1",
    "type": "swot",
    "title": "Initial SWOT Analysis",
    "user_order": 1,
    "status": "not_started",
    "content": { "strengths": ["Strong brand"] },
    "due_date": null,
    "created_at": "2026-06-17T05:27:45Z",
    "updated_at": "2026-06-17T05:27:45Z"
  }
]
```

`ai_draft` and `assigned_to` are omitted when empty/null (`omitempty`).

**Errors (`400`)** — `plan not found` if the plan ID is invalid or belongs to another org; `phase must be P1, P2, or P3` for an invalid filter value.

---

### 4.7 `POST /api/v1/plans/{planID}/activities`

**Role required:** `org_admin` or `planner`.

Creates an activity. **Phase is a label, not a sequence constraint** — you can create a `P3` activity before any `P1` or `P2` activity exists in the plan. `user_order` is computed server-side as `(current max user_order in this plan) + 1`, so it tracks creation order across the whole plan regardless of phase, and is assigned automatically — don't send it.

**Request body**

```json
{
  "phase": "P1",
  "type": "swot",
  "title": "Initial SWOT Analysis",
  "content": { "strengths": ["Strong brand"] },
  "assigned_to": [],
  "due_date": "2026-03-01T00:00:00Z"
}
```

| Field | Required | Notes |
|---|---|---|
| `phase` | Yes | Must be `P1`, `P2`, or `P3` |
| `type` | Yes | Free text — the SRS suggests values like `swot`, `okr`, `roadmap`, `risk_register`, etc., but the server does not enforce an enum here. This is intentionally open-ended for Sprint 3's AI drafting to populate arbitrary activity types. |
| `title` | Yes | |
| `content` | No | Arbitrary JSON object — this is where phase-specific structured data lives (SWOT quadrants, KPI definitions, etc.) |
| `assigned_to` | No | Array of user UUIDs |
| `due_date` | No | ISO 8601 |

**Response `201`** — the created activity, with `status: "not_started"` and the computed `user_order`.

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `title is required` | Empty |
| `type is required` | Empty |
| `phase must be P1, P2, or P3` | Invalid/missing phase |
| `plan not found` | Bad plan ID or wrong org |

---

### 4.8 `GET /api/v1/plans/{planID}/progress`

Returns aggregated completion metrics for a plan: totals per phase, an overall rollup, and milestone counts.

**Response `200`**

```json
{
  "plan_id": "6f7bf728-a3c2-4577-850a-1622d13822b9",
  "status": "draft",
  "phases": [
    { "phase": "P1", "total": 1, "complete": 0, "in_progress": 0, "overdue": 0, "percent_complete": 0 },
    { "phase": "P2", "total": 1, "complete": 0, "in_progress": 1, "overdue": 1, "percent_complete": 0 },
    { "phase": "P3", "total": 1, "complete": 0, "in_progress": 0, "overdue": 0, "percent_complete": 0 }
  ],
  "overall": { "phase": "", "total": 3, "complete": 0, "in_progress": 1, "overdue": 1, "percent_complete": 0 },
  "milestones": { "total": 0, "reached": 0, "missed": 0, "pending": 0 }
}
```

**Field notes:**
- `phases` always contains exactly 3 entries, for `P1`, `P2`, `P3` in that order, even if a phase has zero activities (`total: 0`).
- `overall.phase` is always an empty string — it's the same `PhaseProgress` struct reused for a phase-less rollup, so the `phase` field is meaningless there and can be ignored client-side.
- `overdue` counts activities where `due_date < today AND status != 'complete'`, for that phase (or overall).
- `percent_complete` is `complete / total * 100`, or `0` if `total` is `0` (no division-by-zero `NaN`).
- `milestones` is currently always zeros for every plan — there is no endpoint yet to create milestones (see the project README's "Known gaps" section); the query is wired up and will start returning real numbers the moment milestone rows exist for the plan.

**Errors (`400`)** — `plan not found`.

---

## 5. Activities

Base path: `/api/v1/activities/{activityID}`

### 5.1 `PUT /api/v1/activities/{activityID}`

**Role required:** `org_admin`, `planner`, or `contributor`.

**Contributor restriction:** if the caller's role is `contributor`, the server checks whether their user ID appears in the activity's `assigned_to` array. If not, it returns `403 you are not assigned to this activity` **before** even calling the update logic. `org_admin` and `planner` can update any activity in their org unconditionally.

**Request body** (all optional, at least one required)

```json
{
  "title": "Initial SWOT Analysis (v2)",
  "status": "in_progress",
  "content": { "strengths": ["Strong brand", "Loyal customers"] },
  "assigned_to": ["22222222-2222-2222-2222-222222222222"],
  "due_date": "2026-04-01T00:00:00Z"
}
```

`status` must be one of `not_started`, `in_progress`, `review`, `complete`.

**Response `200`** — the updated activity.

**Errors**

| Status | `error` | Cause |
|---|---|---|
| `403` | `you are not assigned to this activity` | Contributor not in `assigned_to` |
| `400` | `nothing to update` | All fields omitted |
| `400` | `activity not found` | Bad ID or wrong org |
| `400` | `title cannot be empty` | `title` sent as empty string |

---

### 5.2 `POST /api/v1/activities/{activityID}/links`

**Role required:** `org_admin` or `planner`.

Creates a directional link from the `{activityID}` in the URL (the **source**) to a `target_id` in the body. There is currently no dedicated "list links for an activity" endpoint — this is a gap worth a small follow-up if the frontend needs to render link graphs.

**Request body**

```json
{
  "target_id": "7af97d94-b9bc-479b-93cd-90e3d6619a4e",
  "link_type": "manual"
}
```

`link_type` is optional and defaults to `"manual"` if omitted or sent as an empty string. Valid values: `auto` (system-detected), `manual` (user-created), `ai_suggested` (from Sprint 3's AI feature, pending user acceptance).

**Response `201`**

```json
{
  "id": "ba3a0c15-458b-46fc-9295-be229d2d476a",
  "plan_id": "6f7bf728-a3c2-4577-850a-1622d13822b9",
  "source_id": "69adcc0c-1053-46cc-926e-78bc6784b90a",
  "target_id": "7af97d94-b9bc-479b-93cd-90e3d6619a4e",
  "link_type": "manual",
  "created_by": "22222222-2222-2222-2222-222222222222",
  "created_at": "2026-06-17T05:27:59Z",
  "updated_at": "2026-06-17T05:27:59Z"
}
```

**Errors (`400`)**

| `error` | Cause |
|---|---|
| `an activity cannot link to itself` | `target_id` equals the URL's `activityID` |
| `source activity not found` | URL's `activityID` invalid or wrong org |
| `target activity not found` | `target_id` invalid or wrong org |
| `cannot link activities across different plans` | Source and target belong to different plans |
| `link already exists between these activities` | Unique constraint on `(source_id, target_id)`. Note this only blocks the *exact same direction* — a reverse link (swapping source/target) currently succeeds and creates a second, independent row. There's no application-level check preventing that reverse-direction duplicate. |

---

## 6. Not yet implemented (Sprint 3)

These routes exist in the router (so the frontend can build against stable URLs and get a clear signal rather than a routing 404) but currently always return:

```http
501 Not Implemented

{ "success": false, "error": "not yet implemented" }
```

| Method | Path | Role gate already wired |
|---|---|---|
| `POST` | `/api/v1/plans/{planID}/reports` | `org_admin`, `planner` |
| `POST` | `/api/v1/ai/draft` | `org_admin`, `planner` |
| `POST` | `/api/v1/ai/summary` | `org_admin`, `planner` |
| `GET` | `/api/v1/reports/{jobID}` | any authenticated user |

Also not yet built at all (no route, no stub): SSO configuration, milestone CRUD.

---

## 7. Data model reference

This section documents the JSON shape of every resource type returned by the API. Fields marked **(nullable)** are sent as `null` when unset and **(omit)** are omitted from the JSON entirely when unset (Go's `omitempty`) — this distinction matters if your client does strict schema validation.

### User

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `org_id` | UUID **(omit)** | Absent for `super_admin`/`platform_support` |
| `email` | string | |
| `name` | string | |
| `role` | string enum | `super_admin`, `platform_support`, `org_admin`, `planner`, `contributor`, `viewer` |
| `locale` | string | e.g. `"en"` |
| `is_active` | bool | |
| `last_login_at` | timestamp **(omit)** | Present on `GET /api/v1/org/users`; absent on the object returned by `PATCH /api/v1/org/users/{userID}` (see note in 2.2) |
| `created_at` / `updated_at` | timestamp | |

`password_hash` and `sso_subject` exist in the database but are never serialised (`json:"-"`).

### Organisation

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | string | |
| `slug` | string | Auto-generated, URL-safe |
| `logo_url` | string **(omit)** | Not currently settable via any endpoint |
| `locale` | string | |
| `industry` | string **(omit)** | |
| `is_active` | bool | |
| `created_at` / `updated_at` | timestamp | |

### Invitation

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `org_id` | UUID **(omit)** | In the current implementation this is set for both user invites (2.4) and org invites (3.4), since 3.4 pre-creates the org row. The field stays nullable in the schema for possible future invite types. |
| `email` | string | |
| `role` | string enum | Same Role enum as User |
| `invited_by` | UUID | |
| `expires_at` | timestamp | 72h for user invites, 7 days for org invites |
| `accepted_at` | timestamp **(omit)** | |
| `status` | string enum | `pending`, `accepted`, `cancelled`, `expired` |
| `plan_ids` | UUID array **(omit)** | Only meaningful for `viewer`-role invites; see 2.4 caveat about acceptance not yet wiring this into `plan_viewers` |
| `created_at` / `updated_at` | timestamp | |

`token_hash` exists in the database but is never serialised.

### Plan

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `org_id` | UUID | |
| `title` | string | |
| `description` | string **(omit)** | |
| `status` | string enum | `draft`, `active`, `review`, `completed`, `archived` |
| `owner_id` | UUID | Set once at creation to the creator; not currently changeable via any endpoint |
| `start_date` / `end_date` | date **(omit)** | |
| `created_at` / `updated_at` | timestamp | |

### Activity

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `plan_id` | UUID | |
| `org_id` | UUID | |
| `phase` | string enum | `P1`, `P2`, `P3` — a label only, not a sequencing constraint |
| `type` | string | Free text, not enum-validated server-side |
| `title` | string | |
| `user_order` | int | Server-computed at creation; reflects creation order within the plan across all phases |
| `status` | string enum | `not_started`, `in_progress`, `review`, `complete` |
| `content` | object | Arbitrary JSON — phase/type-specific structured data |
| `ai_draft` | object **(omit)** | Reserved for Sprint 3; always absent currently since nothing writes it yet |
| `assigned_to` | UUID array **(omit)** | |
| `due_date` | timestamp **(omit)** | |
| `created_at` / `updated_at` | timestamp | |

### ActivityLink

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `plan_id` | UUID | Inherited from the source/target activity (both must match) |
| `source_id` | UUID | |
| `target_id` | UUID | |
| `link_type` | string enum | `auto`, `manual`, `ai_suggested` |
| `created_by` | UUID | |
| `created_at` / `updated_at` | timestamp | |

### PlanProgress (response-only type, not a stored entity)

See [4.8](#48-get-apiv1plansplanidprogress) for full field-by-field notes and an example. Top-level shape:

```
{
  plan_id, status,
  phases: [ { phase, total, complete, in_progress, overdue, percent_complete } × 3 ],
  overall: { phase: "", total, complete, in_progress, overdue, percent_complete },
  milestones: { total, reached, missed, pending }
}
```

---

## Rate limiting

Currently applied only to `POST /auth/login`: **10 attempts per 5 minutes per client IP**, sliding window, in-memory (resets on server restart, does not coordinate across multiple API instances). Client IP is read from `X-Real-IP`, then `X-Forwarded-For` (first entry if comma-separated), then the raw connection address. If you're running behind a proxy/load balancer, make sure it sets one of those headers correctly or every client will appear to share one IP and rate-limit each other.

---

## Things this document deliberately does not cover

- **Authentication mechanics** (how to attach the Bearer token, what happens on expiry, the full RBAC matrix as a single table) — see `AUTH_AND_CONVENTIONS.md`.
- **Database schema** (column types, constraints, indexes) — see the SQL files in `migrations/`.
- **Anything under `/api/v1/ai`, SSO routes, or report generation** — not built yet; see section 6.
