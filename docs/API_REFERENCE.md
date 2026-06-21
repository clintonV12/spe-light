# StratPlan API Reference

**Version:** Sprint 1 + Sprint 2 + Sprint A (as of this document)
**Base URL (local dev):** `http://localhost:8080`
**Format:** All requests and responses are `application/json`.

This document is generated from the actual handler and service code — every field name, status code, and error string below reflects what the server actually does. If something here drifts from the code, the code wins.

For the auth lifecycle, full RBAC matrix, and integration recipes see `AUTH_AND_CONVENTIONS.md`. For a ready-to-import request collection see `stratplan.postman_collection.json`.

---

## Table of contents

1. [Response conventions](#response-conventions)
2. [Authentication](#1-authentication)
3. [Organisation admin](#2-organisation-admin)
4. [Platform admin](#3-platform-admin)
5. [Plans](#4-plans)
6. [Activities](#5-activities)
7. [Milestones](#6-milestones)
8. [Not yet implemented](#7-not-yet-implemented)
9. [Data model reference](#8-data-model-reference)

---

## Response conventions

### Success responses

Successful responses (`2xx`) return the **raw resource or array directly** — no `{"data": ...}` wrapper.

Action endpoints that don't return a resource (logout, cancel, delete, etc.) return:

```json
{ "message": "..." }
```

### Error responses

```json
{ "success": false, "error": "human-readable message" }
```

`error` is always lowercase and safe to display for `400`/`401`/`403` responses. For `500`, show a generic message instead — the raw text may contain internal detail.

### Status codes

| Code | Meaning |
|------|---------|
| `200` | Success (read or update) |
| `201` | Resource created |
| `400` | Validation, malformed body, or business-rule rejection |
| `401` | Missing/invalid/expired JWT or bad credentials |
| `403` | Authenticated but not authorised (role check or no org context) |
| `404` | Not found — **only used by `GET /api/v1/plans/{planID}` and `GET /api/v1/org/sso`** |
| `429` | Rate limited (login only) |
| `500` | Unexpected server error |
| `501` | Route exists but not yet built |

> **Note on 400 vs 404:** Most "resource not found" cases return `400`, not `404`. Only `GET /api/v1/plans/{planID}` and `GET /api/v1/org/sso` return a real `404`. Don't branch on status code alone for missing-resource detection — check the `error` string.

### Request body parsing

All `POST`/`PUT`/`PATCH` bodies are parsed with `DisallowUnknownFields()` — unknown fields return `400`. Body size is capped at 1 MB.

### Empty list semantics

All list endpoints return `[]`, never `null`, when there are no results.

---

## 1. Authentication

Base path: `/auth/*` and `/invitations/accept` — all top-level, not under `/api/v1`.
All endpoints here are **public** (no `Authorization` header) except where noted.

### 1.1 `POST /auth/login`

Email + password login. Rate-limited: 10 attempts per 5 minutes per IP, in-memory.

**Request**
```json
{ "email": "admin@acme.test", "password": "password123" }
```

**Response `200`**
```json
{
  "access_token": "eyJhbGci...",
  "refresh_token": "77ae343455fd...",
  "expires_at": "2026-07-17T05:27:29Z",
  "user": {
    "id": "22222222-2222-2222-2222-222222222222",
    "name": "Acme Admin",
    "email": "admin@acme.test",
    "role": "org_admin",
    "org_id": "11111111-1111-1111-1111-111111111111"
  }
}
```

`org_id` is **absent** (not null) for `super_admin` / `platform_support`. `expires_at` is the refresh token's expiry — the access token's own expiry is in its JWT `exp` claim.

**Errors `401`:** `invalid credentials` · `account is deactivated` · `this account uses SSO — please sign in via your identity provider`
**Errors `400`:** `email and password are required`
**Errors `429`:** `too many requests — please try again later`

---

### 1.2 `POST /auth/refresh`

Rotates the refresh token. The presented token is immediately revoked; a new pair is issued.

**Request** `{ "refresh_token": "..." }`

**Response `200`** — same shape as 1.1.

**Errors:** `400 refresh_token is required` · `401 invalid refresh token` · `401 refresh token has been revoked` · `401 refresh token has expired` · `401 account is deactivated`

---

### 1.3 `POST /auth/logout`

Revokes the refresh token. Access token continues to work until its 15-minute TTL expires.

**Request** `{ "refresh_token": "..." }`
**Response `200`** `{ "message": "logged out" }`

---

### 1.4 `POST /auth/password-reset/request`

Always returns `200` regardless of whether the email exists. If the account is active, a reset email is sent with a 1-hour link.

**Request** `{ "email": "admin@acme.test" }`
**Response `200`** `{ "message": "if that email exists, a reset link has been sent" }`

---

### 1.5 `POST /auth/password-reset/confirm`

Consumes the one-time token and sets a new password. All existing refresh tokens for the user are revoked.

**Request**
```json
{ "token": "<from email link>", "password": "newSecurePassword123" }
```
**Response `200`** `{ "message": "password updated" }`

**Errors `400`:** `invalid or expired reset token` · `reset token has already been used` · `reset token has expired` · `password must be at least 8 characters`

---

### 1.6 `POST /invitations/accept`

Accepts an invite token, creates the user account, and returns a token pair.

**Request**
```json
{ "token": "<invite token>", "name": "Jane Doe", "password": "securePassword123" }
```
**Response `201`** — same shape as 1.1 login response.

**Errors `400`:** `token, name and password are required` · `invalid invitation token` · `invitation is no longer valid (status: <status>)` · `invitation has expired` · `password must be at least 8 characters`

---

### 1.7 SSO flows `[501 — Sprint A in progress]`

The SSO routes are registered and return `501` until the SAML/OIDC library integration is complete. The config endpoints (2.7–2.9 below) are **fully implemented** and ready to use; the authentication flows that consume those configs are next.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/auth/saml/{orgSlug}/metadata` | SAML SP metadata XML |
| `POST` | `/auth/saml/{orgSlug}/acs` | SAML Assertion Consumer Service |
| `GET`  | `/auth/oidc/{orgSlug}/login` | Redirect to OIDC provider |
| `GET`  | `/auth/oidc/{orgSlug}/callback` | OIDC authorization code callback |

---

## 2. Organisation admin

Base path: `/api/v1/org`
**Role required:** `org_admin` only.

### 2.1 `GET /api/v1/org/users`

Lists all non-deleted users in the caller's org, sorted by name.

**Response `200`** — array of User objects. `password_hash` and `sso_subject` are never present.

---

### 2.2 `PATCH /api/v1/org/users/{userID}`

Partial update of `role` and/or `is_active`. At least one field required.

**Request** (both optional)
```json
{ "role": "planner", "is_active": false }
```

Deactivating a user immediately revokes all their refresh tokens. Role changes and status changes are both written to the audit log. Cannot set `role` to `super_admin` or `platform_support`.

**Response `200`** — updated User. Note: `last_login_at` is absent here (query doesn't re-select it); merge client-side if needed.

**Errors `400`:** `nothing to update` · `cannot assign platform roles via org admin` · `user not found in this organisation`

---

### 2.3 `GET /api/v1/org/invitations`

Lists all invitations for the caller's org (any status), newest first.

**Response `200`** — array of Invitation objects.

---

### 2.4 `POST /api/v1/org/invitations`

Sends an invitation email. Token expires in 72 hours.

**Request**
```json
{ "email": "newhire@acme.test", "role": "contributor", "plan_ids": [] }
```

`plan_ids` is optional; only meaningful for `viewer` role (restricts which plans they see). **As of Sprint B this is now fully wired** — plan_viewers rows are created when the invite is accepted via 1.6.

Allowed roles: `org_admin`, `planner`, `contributor`, `viewer`.

**Response `201`** — the created Invitation.

**Errors `400`:** `invalid role for org invite: <role>` · `a pending invitation already exists for <email> — resend or cancel it first`

---

### 2.5 `DELETE /api/v1/org/invitations/{invitationID}`

Cancels a pending invitation.

**Response `200`** `{ "message": "invitation cancelled" }`
**Errors `400`:** `invitation not found or already actioned`

---

### 2.6 `POST /api/v1/org/invitations/{invitationID}/resend`

Generates a fresh token, extends expiry by 72 hours, and re-sends. Works on expired invitations too.

**Response `200`** `{ "message": "invitation resent" }`
**Errors `400`:** `invitation not found` · `invitation has already been accepted`

---

### 2.7 `GET /api/v1/org/sso` ✨ New in Sprint A

Returns the current SSO configuration for the caller's org.

`client_secret` and `certificate` are **never returned** (write-only). If you need to verify a certificate is set, check that `entity_id` is present as a proxy.

**Response `200`** — SSOConfig object.
**Errors `404`:** `no SSO configuration found for this organisation`

---

### 2.8 `PUT /api/v1/org/sso` ✨ New in Sprint A

Creates or replaces the SSO configuration (upsert — one config per org, one protocol at a time).

**Request — SAML**
```json
{
  "protocol": "saml",
  "metadata_url": "https://idp.example.com/metadata",
  "entity_id": "https://stratplan.example.com/saml/sp",
  "default_role": "viewer",
  "jit_enabled": true,
  "local_login_disabled": false
}
```

**Request — OIDC**
```json
{
  "protocol": "oidc",
  "client_id": "stratplan-client",
  "client_secret": "secret",
  "discovery_url": "https://accounts.google.com",
  "default_role": "viewer",
  "jit_enabled": true,
  "local_login_disabled": false
}
```

| Field | Notes |
|-------|-------|
| `protocol` | Required: `saml` or `oidc` |
| `default_role` | Role assigned to JIT-provisioned users. Defaults to `viewer`. Cannot be a platform-tier role. |
| `jit_enabled` | Auto-create accounts on first SSO login. |
| `local_login_disabled` | Block email+password login for this org while SSO is active. |
| SAML: `metadata_url` | Preferred — supply the IdP's metadata URL and the SP will fetch it. |
| SAML: `entity_id` + `certificate` | Alternative if the IdP doesn't publish metadata at a URL. |
| OIDC: `client_id`, `client_secret`, `discovery_url` | All three required for OIDC. |

**Response `200`** — the stored SSOConfig (client_secret and certificate omitted).

**Errors `400`:** `protocol must be 'saml' or 'oidc'` · `SAML configuration requires either metadata_url or both entity_id and certificate` · `OIDC configuration requires client_id, client_secret, and discovery_url` · `default_role cannot be a platform-tier role`

---

### 2.9 `DELETE /api/v1/org/sso` ✨ New in Sprint A

Removes the SSO configuration. Local email+password login is immediately re-enabled.

**Response `200`** `{ "message": "SSO configuration removed" }`
**Errors `400`:** `no SSO configuration found for this organisation`

---

## 3. Platform admin

Base path: `/api/v1/admin`
**Role required:** `super_admin` or `platform_support` (read). Mutations: `super_admin` only.

### 3.1 `GET /api/v1/admin/orgs`

Lists all organisations. Query params: `active_only=true`, `limit` (default 50), `offset` (default 0).

**Response `200`** — array of Organisation objects.

---

### 3.2 `POST /api/v1/admin/orgs`

Creates an immediately active org. `slug` is auto-generated.

**Request** `{ "name": "Globex Inc", "industry": "Manufacturing", "locale": "en" }`
**Response `201`** — created Organisation.
**Errors `400`:** `organisation name is required`

---

### 3.3 `PATCH /api/v1/admin/orgs/{orgID}`

Partial update. Deactivating (`is_active: false`) revokes all users' refresh tokens and emails org admins.

**Request** `{ "name": "...", "is_active": false, "industry": "...", "locale": "fr" }`
**Response `200`** — updated Organisation.
**Errors `400`:** `nothing to update` · `organisation not found`

---

### 3.4 `POST /api/v1/admin/org-invitations`

Creates a pending org and emails an org-admin invite (7-day expiry). **As of Sprint B, accepting this invite now automatically activates the org** — the super_admin no longer needs to separately call 3.3.

**Request** `{ "email": "newcustomer@example.com", "org_name": "New Customer LLC" }`
**Response `201`** — created Invitation.

---

## 4. Plans

Base path: `/api/v1/plans`

### 4.1 `GET /api/v1/plans`

Lists plans in the caller's org. Viewer-scoping applies: viewers with `plan_viewers` rows see only those plans; viewers with no rows see all plans.

**Response `200`** — array of Plan objects, newest first.

---

### 4.2 `POST /api/v1/plans`

**Role:** `org_admin` or `planner`. Creates a plan with `status = "draft"`.

**Request**
```json
{
  "title": "2026 Growth Strategy",
  "description": "...",
  "start_date": "2026-01-01T00:00:00Z",
  "end_date": "2026-12-31T00:00:00Z"
}
```
**Response `201`** — created Plan.
**Errors `400`:** `title is required`

---

### 4.3 `GET /api/v1/plans/{planID}`

Returns a single plan. **This is the only endpoint that returns `404`** for a missing resource.

**Response `200`** — Plan.
**Errors `404`:** `plan not found`

---

### 4.4 `PUT /api/v1/plans/{planID}`

**Role:** `org_admin` or `planner`. Partial update.

**Request**
```json
{ "title": "...", "description": "...", "status": "active", "start_date": "...", "end_date": "..." }
```

`status` values: `draft`, `active`, `review`, `completed`, `archived`. Archived plans cannot be updated (one-way door).

**Errors `400`:** `nothing to update` · `plan not found` · `archived plans cannot be updated` · `title cannot be empty`

---

### 4.5 `DELETE /api/v1/plans/{planID}`

**Role:** `org_admin` only. Soft-deletes the plan and all its activities. Not reversible via the API.

**Response `200`** `{ "message": "plan deleted" }`

---

### 4.6 `GET /api/v1/plans/{planID}/activities`

Lists activities, sorted by phase then `user_order`.

**Query params:** `phase=P1|P2|P3` (optional filter).

**Response `200`** — array of Activity objects.

---

### 4.7 `POST /api/v1/plans/{planID}/activities`

**Role:** `org_admin` or `planner`. Phase is a label — creation order is unconstrained.

**Request**
```json
{
  "phase": "P1",
  "type": "swot",
  "title": "SWOT Analysis",
  "content": {},
  "assigned_to": [],
  "due_date": "2026-03-01T00:00:00Z"
}
```

`user_order` is server-computed (creation sequence within the plan). `type` is free text — not enum-validated.

**Response `201`** — created Activity.

**Errors `400`:** `title is required` · `type is required` · `phase must be P1, P2, or P3` · `plan not found`

---

### 4.8 `GET /api/v1/plans/{planID}/progress`

Returns completion metrics, overdue counts, and milestone stats.

**Response `200`**
```json
{
  "plan_id": "...",
  "status": "active",
  "phases": [
    { "phase": "P1", "total": 2, "complete": 1, "in_progress": 1, "overdue": 0, "percent_complete": 50 },
    { "phase": "P2", "total": 1, "complete": 0, "in_progress": 1, "overdue": 1, "percent_complete": 0 },
    { "phase": "P3", "total": 0, "complete": 0, "in_progress": 0, "overdue": 0, "percent_complete": 0 }
  ],
  "overall": { "phase": "", "total": 3, "complete": 1, "in_progress": 2, "overdue": 1, "percent_complete": 33.3 },
  "milestones": { "total": 2, "reached": 1, "missed": 0, "pending": 1 },
  "completeness_score": 56.7,
  "completeness_detail": {
    "phase_coverage": 40.0,
    "activity_compl": 10.0,
    "link_density": 6.7,
    "phases_with_work": 2,
    "total_activities": 3,
    "complete_count": 1,
    "link_count": 2
  }
}
```

**New in Sprint A:** `completeness_score` (0–100) and `completeness_detail` are now included. See scoring model in `internal/services/plan/completeness.go`. Milestones now return real counts — the CRUD endpoints are live (see section 6).

`overall.phase` is always `""` — it's a reused struct field, ignore it.

---

### 4.9 `GET /api/v1/plans/{planID}/links` ✨ New in Sprint A

Returns all activity links for a plan.

**Response `200`** — array of ActivityLink objects, ordered by `created_at`.

---

### 4.10 `GET /api/v1/plans/{planID}/auto-links` ✨ New in Sprint A

Returns candidate links that the auto-detection engine suggests but that don't yet exist. Read-only — nothing is written until the caller POSTs to `/api/v1/activities/{id}/links`.

**Response `200`**
```json
[
  {
    "source_id": "...",
    "target_id": "...",
    "source_type": "swot",
    "target_type": "risk_register",
    "reason": "SWOT threats feed into the Risk Register"
  }
]
```

Returns `[]` if no candidates are found. Empty response is normal for plans that already have all natural links created, or whose activity types don't match any rule.

---

## 5. Activities

### 5.1 `PUT /api/v1/activities/{activityID}`

**Role:** `org_admin`, `planner`, or `contributor` (contributors: only activities where their ID is in `assigned_to`).

**Request**
```json
{
  "title": "...",
  "status": "in_progress",
  "content": {},
  "assigned_to": ["22222222-..."],
  "due_date": "2026-04-01T00:00:00Z"
}
```

`status` values: `not_started`, `in_progress`, `review`, `complete`.

**Errors:** `403 you are not assigned to this activity` · `400 nothing to update` · `400 activity not found` · `400 title cannot be empty`

---

### 5.2 `POST /api/v1/activities/{activityID}/links`

**Role:** `org_admin` or `planner`. Creates a directional link from the URL activity (source) to `target_id`.

**Request** `{ "target_id": "...", "link_type": "manual" }`

`link_type` defaults to `"manual"`. Valid: `auto`, `manual`, `ai_suggested`. Circular links are now rejected (A→B→C→A) — the BFS cycle check was added in Sprint B.

**Response `201`** — ActivityLink.

**Errors `400`:** `an activity cannot link to itself` · `source activity not found` · `target activity not found` · `cannot link activities across different plans` · `link already exists between these activities` · `this link would create a cycle`

---

### 5.3 `GET /api/v1/activities/{activityID}/links` ✨ New in Sprint A

Returns all links where this activity is either source or target.

**Response `200`** — array of ActivityLink objects.

---

## 6. Milestones ✨ New in Sprint B

Base path: `/api/v1/plans/{planID}/milestones` (list/create) and `/api/v1/milestones/{milestoneID}` (update/delete).

Milestones are key-date markers within a plan. The progress endpoint (4.8) counts them — those counts were always `0` before Sprint B since there was no way to create rows.

### 6.1 `GET /api/v1/plans/{planID}/milestones`

Lists milestones for a plan, ordered by `due_date` ascending.

**Response `200`**
```json
[
  {
    "id": "...",
    "plan_id": "...",
    "title": "Phase 1 Review",
    "due_date": "2026-03-31T00:00:00Z",
    "status": "pending",
    "linked_activity_id": null,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

### 6.2 `POST /api/v1/plans/{planID}/milestones`

**Role:** `org_admin` or `planner`.

**Request**
```json
{
  "title": "Phase 1 Review",
  "due_date": "2026-03-31T00:00:00Z",
  "linked_activity_id": "69adcc0c-..."
}
```

`linked_activity_id` is optional.

**Response `201`** — created Milestone. `status` is always `"pending"` on creation.

**Errors `400`:** `title is required` · `due_date is required` · `plan not found`

### 6.3 `PUT /api/v1/milestones/{milestoneID}`

**Role:** `org_admin` or `planner`. Partial update — all fields optional.

**Request**
```json
{ "title": "...", "due_date": "...", "status": "reached", "linked_activity_id": "..." }
```

`status` values: `pending`, `reached`, `missed`.

**Errors `400`:** `nothing to update` · `milestone not found` · `title cannot be empty` · `status must be one of: pending, reached, missed`

### 6.4 `DELETE /api/v1/milestones/{milestoneID}`

**Role:** `org_admin` only. Hard delete (no soft-delete for milestones).

**Response `200`** `{ "message": "milestone deleted" }`
**Errors `400`:** `milestone not found`

---

## 7. Not yet implemented

These routes return `501 Not Implemented`. Role gates are already wired so the frontend can build against stable URLs.

| Method | Path | Sprint | Role gate |
|--------|------|--------|-----------|
| `POST` | `/api/v1/ai/draft` | C | `org_admin`, `planner` |
| `POST` | `/api/v1/ai/summary` | C | `org_admin`, `planner` |
| `POST` | `/api/v1/plans/{planID}/reports` | D | `org_admin`, `planner` |
| `GET`  | `/api/v1/reports/{jobID}` | D | any authenticated |
| `GET`  | `/auth/saml/{orgSlug}/metadata` | A | public |
| `POST` | `/auth/saml/{orgSlug}/acs` | A | public |
| `GET`  | `/auth/oidc/{orgSlug}/login` | A | public |
| `GET`  | `/auth/oidc/{orgSlug}/callback` | A | public |

---

## 8. Data model reference

### User

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `org_id` | UUID **(omit)** | Absent for platform-tier users |
| `email` | string | |
| `name` | string | |
| `role` | enum | `super_admin` `platform_support` `org_admin` `planner` `contributor` `viewer` |
| `locale` | string | |
| `is_active` | bool | |
| `last_login_at` | timestamp **(omit)** | Present in list; absent in PATCH response |
| `created_at` / `updated_at` | timestamp | |

### Organisation

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `name` | string | |
| `slug` | string | Auto-generated |
| `logo_url` | string **(omit)** | Not settable via API yet |
| `locale` | string | |
| `industry` | string **(omit)** | |
| `is_active` | bool | |
| `created_at` / `updated_at` | timestamp | |

### SSOConfig ✨ New in Sprint A

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `org_id` | UUID | |
| `protocol` | enum | `saml` or `oidc` |
| `metadata_url` | string **(omit)** | SAML only |
| `entity_id` | string **(omit)** | SAML only |
| `certificate` | — | Never returned (write-only) |
| `client_id` | string **(omit)** | OIDC only |
| `client_secret` | — | Never returned (write-only) |
| `discovery_url` | string **(omit)** | OIDC only |
| `default_role` | enum | Role assigned to JIT-provisioned users |
| `jit_enabled` | bool | |
| `local_login_disabled` | bool | |
| `created_at` / `updated_at` | timestamp | |

### Invitation

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `org_id` | UUID **(omit)** | |
| `email` | string | |
| `role` | enum | |
| `invited_by` | UUID | |
| `expires_at` | timestamp | 72h (user) or 7 days (org) |
| `accepted_at` | timestamp **(omit)** | |
| `status` | enum | `pending` `accepted` `cancelled` `expired` |
| `plan_ids` | UUID array **(omit)** | Viewer scope — now fully wired as of Sprint B |
| `created_at` / `updated_at` | timestamp | |

### Plan

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `org_id` | UUID | |
| `title` | string | |
| `description` | string **(omit)** | |
| `status` | enum | `draft` `active` `review` `completed` `archived` |
| `owner_id` | UUID | Creator; not changeable via API |
| `start_date` / `end_date` | date **(omit)** | |
| `created_at` / `updated_at` | timestamp | |

### Activity

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `plan_id` | UUID | |
| `org_id` | UUID | |
| `phase` | enum | `P1` `P2` `P3` — label only |
| `type` | string | Free text |
| `title` | string | |
| `user_order` | int | Server-computed creation sequence |
| `status` | enum | `not_started` `in_progress` `review` `complete` |
| `content` | object | Arbitrary JSON |
| `ai_draft` | object **(omit)** | Reserved for Sprint C |
| `assigned_to` | UUID array **(omit)** | |
| `due_date` | timestamp **(omit)** | |
| `created_at` / `updated_at` | timestamp | |

### ActivityLink

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `plan_id` | UUID | |
| `source_id` | UUID | |
| `target_id` | UUID | |
| `link_type` | enum | `auto` `manual` `ai_suggested` |
| `created_by` | UUID | |
| `created_at` / `updated_at` | timestamp | |

### Milestone ✨ New in Sprint B

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `plan_id` | UUID | |
| `title` | string | |
| `due_date` | date | |
| `status` | enum | `pending` `reached` `missed` |
| `linked_activity_id` | UUID **(omit)** | Optional connection to an activity |
| `created_at` / `updated_at` | timestamp | |

### PlanProgress (response-only)

```
{
  plan_id, status,
  phases: [ { phase, total, complete, in_progress, overdue, percent_complete } × 3 ],
  overall: { phase: "", total, complete, in_progress, overdue, percent_complete },
  milestones: { total, reached, missed, pending },
  completeness_score: float,
  completeness_detail: { phase_coverage, activity_compl, link_density,
                         phases_with_work, total_activities, complete_count, link_count }
}
```

### CandidateLink (response-only, auto-links endpoint)

```
{ source_id, target_id, source_type, target_type, reason }
```

---

## Rate limiting

`POST /auth/login` only: 10 attempts per 5 minutes per IP, sliding window, in-memory. Resets on server restart; does not coordinate across multiple API instances. Replace with a Redis-backed implementation before running more than one API server behind a load balancer.