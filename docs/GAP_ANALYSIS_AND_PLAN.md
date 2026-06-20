# StratPlan API — Gap Analysis & Completion Plan (against SRS v1.1)

**Scope of this document:** backend/API only. Frontend (React SPA, i18n locale files, offline SQLite cache, UI screens) is out of scope — owned by a separate developer.

**Method:** every requirement ID below was checked directly against the current codebase (handlers, services, models, migrations), not inferred from memory. Where something is partially built, that's stated explicitly rather than rounded up or down.

---

## 1. Where things actually stand

### 1.1 Fully done

| Area | SRS refs | Notes |
|---|---|---|
| Email+password auth, JWT access+refresh, bcrypt | REQ-F-001, F-002, REQ-NF-012 | Refresh rotation, revocation on logout, all implemented |
| Org/user invite flow (org-tier) | REQ-F-004 | Send, list, cancel, resend all work; 72h expiry matches spec |
| Platform org invite + manual org create/deactivate | REQ-F-005 | Implemented, with one gap noted in 2.1 below |
| Role change / user deactivation by org admin | REQ-F-010, F-011 | Session revocation on deactivation confirmed working |
| Password reset flow | REQ-F-012 | 1-hour expiry, enumeration-safe, sessions revoked on reset |
| Login rate limiting | REQ-F-013, REQ-NF-015 | 10/5min per IP — see 2.2 for a spec-literal mismatch |
| Plan CRUD, status lifecycle | REQ-F-020, F-021, F-024 (partial) | Draft→Active→Review→Completed→Archived all present |
| Order-independent activity creation across phases | REQ-F-030 to F-034 | Verified by integration test — this was the trickiest requirement and it works correctly |
| Manual activity linking, self-link/cross-plan rejection | REQ-F-041, F-042 (partial), F-043 | Directional links stored correctly |
| Progress dashboard metrics (per-phase, overall, overdue) | REQ-F-060 to F-063 | Working; milestone counts wired but always zero (no milestone writer yet — see 2.4) |
| Multi-tenancy via explicit org_id filtering | REQ-F-003 | Every query scoped; RLS exists as an additional, not-yet-wired layer (see 2.6) |
| Some audit logging | REQ-NF-016 (partial) | 4 of ~14 mutation points covered — see 2.7 |
| Bcrypt cost factor 12 | REQ-NF-012 | Matches "≥ 12" requirement exactly |
| Invitation token hashing | REQ-NF-019 | SHA-256, 32-byte random, plaintext never stored — matches spec exactly |
| HMAC link signing primitive | REQ-NF-020 | `SignLink`/`VerifyLink` exist in `internal/auth`, but nothing in the codebase calls them yet — see 2.8 |
| Health check | REQ-NF-055 | `GET /health` returns 200 |

### 1.2 Stubbed (route exists, returns 501)

| Route | SRS req |
|---|---|
| `POST /api/v1/ai/draft` | REQ-AI-001 |
| `POST /api/v1/ai/summary` | REQ-AI-004 |
| `POST /api/v1/plans/{id}/reports` | REQ-F-070 |
| `GET /api/v1/reports/{jobID}` | REQ-F-070 |

### 1.3 Not started at all (no route, no service, no stub)

This is the bulk of the remaining work. Grouped by SRS section:

- **SSO** — SAML 2.0, OIDC, JIT provisioning (REQ-F-006 to F-009, REQ-NF-017, REQ-NF-018). The `sso_configs` table and `SSOConfig` model exist; nothing else does. This is Sprint 2 in the SRS's own build order and is the single largest remaining body of work.
- **Generative AI** — every REQ-AI item except the route stubs above. No Ollama client exists anywhere in the code.
- **Report generation** — no PDF/Word/Excel rendering exists. The `reports` table exists; nothing writes to it.
- **Milestones** — no create/update/delete endpoints. Read-only zero counts in the progress endpoint.
- **Plan-scoped viewer grants** — `plan_viewers` table is read (in `ListPlans`) but never written. There is no `POST /plans/{id}/viewers` or `DELETE /plans/{id}/viewers/{userID}` (REQ-F-027, and the dedicated endpoints listed in SRS section 8).
- **Notifications (email triggers beyond invite/reset)** — overdue activity, milestone reached, org deactivated (this one partially exists — see 2.1), role changed, user deactivated, sync conflict (REQ-F-N-003 to N-009). The `email.Service` has the *templates* for some of these already (`SendOverdueAlert`, `SendRoleChanged`) but nothing calls them on a schedule or event trigger.
- **`notification_log` table** — exists, never written to. No delivery tracking at all currently.
- **Offline sync** — `sync_queue` table exists; zero references anywhere in the Go code. This is explicitly frontend-driven per the SRS (SQLite lives client-side), but the *server* still needs a sync endpoint to accept/replay queued writes and the conflict-log surface — neither exists.
- **Plan duplication** — REQ-F-022. No deep-copy logic anywhere.
- **Plan templates** — REQ-F-026. No template save/reuse mechanism.
- **Custom activity types** — REQ-F-035. Currently `type` is a free-text string with no per-org registry or validation; "custom activity types added by org admin" implies some admin-managed list, which doesn't exist.
- **Activity edit history** — REQ-F-054. No versioning/history table or endpoint.
- **Bulk activity status update** — REQ-F-056.
- **AI-assisted and automatic linkage suggestions** — REQ-F-040 (auto-detected links), F-044 (completeness score), F-046 (AI-suggested links). Only the manual link path (F-041) exists. The `link_type` enum already includes `auto` and `ai_suggested` values in the schema, ready for this work, but nothing populates them.
- **Cross-org audit log / usage stats for platform tier** — REQ-F-005 area ("View all orgs and usage stats" for `platform_support`) only covers listing orgs today; no usage stats, no audit log *viewing* endpoint for either platform tier (writing happens, but there's no `GET .../audit-log`).
- **Locale-aware emails** — REQ-NF-045. All emails are currently English-only, hardcoded in the Go templates.
- **golang-migrate auto-run on startup** — REQ-NF-052/053 implies migrations run automatically; currently they're a manual `migrate` CLI step per the README.
- **Structured JSON logs** — REQ-NF-056. The app currently uses `slog` with the default text handler, not JSON.

---

## 2. Gaps inside things that look "done" (worth fixing before building on top of them)

These are bugs or partial implementations within already-built features — not new functionality, but things that should be fixed early since other Sprint 3+ work will build on top of them.

### 2.1 Org invite acceptance doesn't activate the org
`POST /api/v1/admin/org-invitations` creates the org with `is_active: false`. Accepting that invite (`POST /invitations/accept`) only creates the user and marks the invitation accepted — it never flips the org to active. Per REQ-F-005 ("Org is activated and the recipient becomes Org admin"), this is a direct spec mismatch, not just a nice-to-have. **Fix size: small** — a few lines in `AcceptInvite` to check `inv.OrgID` and, if the org is currently inactive, activate it as part of the same transaction.

### 2.2 Rate limit window doesn't match the spec literally
REQ-F-013 / REQ-NF-015 both say **"max 10 attempts/minute per IP."** The implementation is 10 attempts per **5 minutes**. This is a stricter limit than spec, not a missing feature, so it's a judgment call whether to tighten it to match exactly or keep the more conservative window — but it should be a deliberate decision, documented, not silently different. **Fix size: trivial** (one constant), but flagging because "10/minute" and "10/5min" produce very different lockout UX and it's currently undocumented that we deviated.

### 2.3 Plan-scoped viewer invites are accepted but don't restrict anything
Covered in the existing API docs as a known gap: `SendInviteRequest.PlanIDs` is stored on the invitation row, but `AcceptInvite` never writes the corresponding `plan_viewers` rows. The `ListPlans` *read* path already correctly checks `plan_viewers` — only the *write* path on acceptance is missing. **Fix size: small.**

### 2.4 Milestones are read-only and always empty
`GetProgress` queries the `milestones` table correctly, but there is no way to ever insert a row into it, so every plan permanently reports `{total: 0, reached: 0, missed: 0, pending: 0}`. This isn't a bug exactly — it's an incomplete feature masquerading as a working one, because the endpoint returns a plausible-looking (if empty) response instead of erroring. **Fix size: medium** — needs a full milestone CRUD service.

### 2.5 Audit log covers ~4 of ~18 mutation methods
REQ-NF-016 says **"all data mutations,"** not "the most sensitive ones." Right now `auditlog.Record` is only called from `UpdateUser` (role/active changes), `UpdateOrg` (active changes), and `DeletePlan`. Every other mutation — `CreatePlan`, `UpdatePlan`, `CreateActivity`, `UpdateActivity`, `CreateActivityLink`, `SendUserInvite`, `CancelInvitation`, `ResendInvitation`, `CreateOrg`, `SendOrgInvite` — writes no audit trail at all. **Fix size: medium**, mechanical but touches every service file.

### 2.6 Row-level security exists in the database but isn't active
Migration 002 creates the RLS policies and the helper functions; `internal/database/rls.go` documents exactly how to wire it in (acquire a dedicated connection per request, run `SELECT set_config(...)`, route subsequent queries through that connection). Nobody has done that wiring yet. The app is *not* currently vulnerable because every query already filters by `org_id` explicitly in Go — but REQ-NF-011 says RLS should be "enforced at database level," and right now it's enforced at application level only, with the DB-level policies sitting inert. **Fix size: medium-to-large** — this is a connection-management refactor across every service, not a quick patch.

### 2.7 HMAC link signing exists but is unused
`SignLink`/`VerifyLink` in `internal/auth` are fully implemented and match REQ-NF-020's intent, but no email-generating code path calls them. Invite links and password reset links are currently just `?token=<plaintext>` with no HMAC wrapper — the token itself is unguessable (32 random bytes, hashed at rest), so this isn't a live vulnerability, but it's a "should" requirement that's silently unmet despite the primitive being ready to use. **Fix size: small.**

### 2.8 "View all orgs and usage stats" is half-built
`GET /api/v1/admin/orgs` covers "view all orgs." There are no usage stats (active user counts, plan counts, storage, etc. — the SRS doesn't define exactly what "usage stats" means, so this needs a quick product clarification before building it).

---

## 3. Proposed completion plan

The original SRS build order (section 11) sequenced SSO right after Sprint 1, before any plan/activity work. Since Sprints 1 and 2 (their numbering) are functionally done except for SSO, the cleanest path is to **slot SSO in now as its own sprint**, fix the small/medium gaps from section 2 alongside the sprint they're most related to, and then proceed through AI, linkage, reports, and notifications in roughly the SRS's original order. Offline sync stays last since it's the most frontend-coupled piece and benefits from everything else being stable first.

### Sprint A — Close out Sprint 1/2 gaps + SSO (REQ-F-006 to F-009, REQ-NF-017/018)

This is the immediate next sprint. SSO is large enough to justify being its own block, and the SRS explicitly calls out why it should come early ("auth is the gateway to everything").

**SSO work:**
- `sso_configs` CRUD service + handlers: `GET/PUT/DELETE /api/v1/org/sso` (currently *zero* code exists for this despite being in the SRS's API surface table).
- SAML 2.0 service-provider flow using `crewjam/saml` (per the SRS's own stack choice): `GET /auth/saml/:org_slug/metadata`, `POST /auth/saml/:org_slug/acs`. Must validate signature, audience, and timestamp on every assertion (REQ-NF-017) and reject replays.
- OIDC relying-party flow using `coreos/go-oidc`: `GET /auth/oidc/:org_slug/login` (PKCE challenge), `GET /auth/oidc/:org_slug/callback`. Must validate issuer, audience, expiry, and signature against the JWKS endpoint (REQ-NF-018).
- JIT provisioning: on first successful SSO login with no matching local user, auto-create one with the org's configured `default_role`, store `sso_subject`. Needs a new service method, not just a handler — this touches the same "create user" logic path as invite acceptance, so it should probably share code with `AcceptInvite` rather than duplicate it.
- Auto-detection on the login screen ("SSO login button shown when org's domain matches an SSO config") needs a small public lookup endpoint — something like `GET /auth/sso-config-for-domain?email=...` — that the SRS's UI section implies but the API surface table doesn't explicitly list. Flag this for product/frontend alignment before building.
- `local_login_disabled` enforcement: when set, `/auth/login` must reject local credentials for that org's users even if a password hash exists.

**Gap fixes bundled into this sprint (small, auth-adjacent):**
- 2.1 — activate org on invite acceptance.
- 2.2 — decide and align the rate-limit window to the literal spec (or document the deviation explicitly in the SRS or a decision log).
- 2.7 — wrap invite/reset links with HMAC signing using the existing `SignLink` helper.

**Why bundle these here:** all three touch the auth/invite code path that's already being opened up for SSO/JIT work, so fixing them alongside avoids a second pass through the same files.

---

### Sprint B — Plan-scoped viewers, milestones, audit log completeness

These three are independent of each other but are all "finish what Sprint 1/2 started" work, so they're grouped for efficiency rather than because they're related features.

- **Plan-scoped viewers (REQ-F-027, gap 2.3):** write `plan_viewers` rows on invite acceptance when `plan_ids` is present; add `POST /api/v1/plans/{id}/viewers` and `DELETE /api/v1/plans/{id}/viewers/{userID}` per the SRS's own API surface table (these are listed there but don't exist in code at all — a separate, smaller gap from 2.3, since 2.3 is about the *invite* path and this is about *direct* grant/revoke independent of invites).
- **Milestones (gap 2.4):** full CRUD service — create, update status, delete, list per plan. Needs to slot into `GetProgress`'s existing query (already correct) and into the report-rendering work in Sprint D (milestones appear in the "Milestone tracker" UI screen per SRS section 9).
- **Audit log completeness (gap 2.5):** add `auditlog.Record` calls to the remaining ~14 mutation methods listed in 2.5. Mechanical work; a good candidate to batch into a single PR with a checklist derived directly from the method list in that section.

---

### Sprint C — Generative AI (REQ-AI-001 to AI-013)

Blocked on nothing else in this plan — can run in parallel with Sprint B if there's a second engineer available, since it touches almost entirely new files (`internal/ai/ollama.go` doesn't exist yet).

- Ollama HTTP client (`internal/ai`): wraps `OLLAMA_URL`/`OLLAMA_MODEL` from config (already present, just unused) into a simple request/response wrapper. Per REQ-AI-009, calls must be non-blocking with cancellation support — likely needs a job-style pattern (return a handle immediately, poll or stream for the result) rather than a synchronous HTTP handler, since REQ-NF-002 allows up to 30s for a draft and synchronous 30s HTTP handlers are a poor pattern under load.
- `POST /api/v1/ai/draft` — real implementation (currently 501). Takes 1–10 keywords, generates a full activity draft scoped to org/industry/plan context (REQ-AI-011 — no PII in the prompt).
- `POST /api/v1/ai/summary` — real implementation. Narrative summary from completed activities.
- Additional AI surface not yet routed at all: gap analysis (REQ-AI-005), KPI suggestion (REQ-AI-003), PESTLE generation (REQ-AI-007), translation (REQ-AI-008 — Could priority, can slip), risk narrative (REQ-AI-013 — Should). Each of these needs its own route; none currently exist even as stubs, so this sprint should start by adding the missing routes to the router (currently only `draft` and `summary` are wired).
- `ai_draft` JSON field on `Activity` already exists in the schema and model — the AI draft endpoint should populate that field, and a separate "accept draft" action (REQ-AI-010 — explicit acceptance before it becomes the real `content`) needs a small endpoint or a flag on the existing `PUT /activities/{id}`.

### Sprint D — Linkage engine completion + report generation

These are grouped because reports need a complete, accurate linkage graph to render coherently per REQ-F-072/F-045 ("reports render linked activities in coherent narrative regardless of creation order") — building reports before auto-linking exists means reports will only ever show manually-created links.

**Linkage:**
- Auto-detection (REQ-F-040): rule-based matching by activity type pairs (e.g. SWOT threats → Risk Register). This is deterministic logic, not AI — can be built independently of Sprint C.
- Circular link prevention (REQ-F-042) — currently only self-links and cross-plan links are rejected; nothing checks for cycles in longer chains (A→B→C→A). Needs a graph traversal check on link creation.
- Completeness score (REQ-F-044, Should) — derived metric from phase coverage + link density; natural fit alongside the existing `GetProgress` endpoint.
- AI-suggested links (REQ-AI-006/F-046, Could/lowest priority in both lists) — depends on Sprint C's Ollama client existing first.

**Reports:**
- PDF generation — SRS specifies `chromedp` or a Go PDF library; either choice needs a rendering template per report type (Full plan, Per-phase, Executive summary, Progress status, Activity detail — 5 distinct templates).
- Word (.docx) and Excel (.xlsx) export — separate rendering paths from PDF.
- Async job pattern: `POST /plans/{id}/reports` returns a `job_id` immediately (already the documented contract); `GET /reports/{jobID}` polls status. Needs a job table/queue — the existing `reports` table has the right columns (`status: pending|ready|failed`) but nothing populates or transitions them yet.
- Org branding on reports (REQ-F-074, Should) — depends on `logo_url` actually being settable somewhere (currently it's in the `Organisation` model but no endpoint sets it).
- AI narrative summary per phase in reports (REQ-AI-004/REQ-F-075) — depends on Sprint C.
- Scheduled report delivery (REQ-F-076, Should) — needs a scheduler (cron-style background job) and ties into the notification work in Sprint E.

### Sprint E — Notifications, bulk operations, remaining polish

- Wire the event triggers the SRS requires (REQ-F-N-003 to N-009): overdue activity (needs a background sweep job, since nothing currently runs periodic checks — the app has no scheduler/cron mechanism at all today), milestone reached (depends on Sprint B's milestone CRUD existing), role changed / user deactivated (the email templates already exist — `SendRoleChanged` is unused, this is just wiring two existing service methods to call it), sync conflict (depends on the offline sync work in Sprint F existing first, so this specific trigger may need to slip to Sprint F).
- `notification_log` writes — every email send should also write a row here; currently `email.Service.send()` doesn't touch that table at all.
- Bulk activity status update (REQ-F-056, Could) — single new endpoint, e.g. `PATCH /api/v1/activities/bulk-status`.
- Activity edit history (REQ-F-054, Should) — either a new `activity_history` table + trigger, or repurpose the audit log (once Sprint B makes it comprehensive) and add a query endpoint that filters it by `record_id` — the latter is less work and reuses Sprint B's output, so it's the recommended approach.
- Plan duplication (REQ-F-022, Should) — deep-copy service method; needs care around what to do with `assigned_to` and `due_date` on copied activities (SRS doesn't specify — flag for product decision: clear assignees/dates on duplicate, or carry them over?).
- Plan templates (REQ-F-026, Should) — likely reuses the duplication logic above, saving a plan as a template rather than copying an existing one.
- Custom activity types (REQ-F-035, Should) — needs an org-scoped registry table (doesn't exist yet) since right now `type` is unvalidated free text.

### Sprint F — Offline sync (server side) + ops/deployment hardening

Last, per the SRS's own ordering, and because it benefits most from everything else being stable (a sync endpoint that has to reconcile writes against plans/activities/links/milestones is much simpler to build once those are all finished and not still changing shape).

- Server-side sync endpoint(s) to accept queued offline writes and apply last-write-wins resolution (REQ-NF-031/032). The `sync_queue` table exists but the server has zero code referencing it — this needs design discussion with the frontend dev first, since the SQLite cache and queue format are entirely client-owned per the SRS's architecture, and the API just needs a contract for "replay this batch of operations."
- Conflict log surfaced to users (REQ-NF-032) — likely a simple `GET /api/v1/sync/conflicts` once the above exists.

**Ops/deployment hardening (not feature work, but blocking REQ-NF compliance):**
- Migrations auto-run on startup (REQ-NF-052/053) — currently a manual CLI step; should be folded into `cmd/server/main.go`'s startup sequence using `golang-migrate`'s library (not just the CLI).
- Structured JSON logs (REQ-NF-056) — swap `slog`'s default handler for `slog.NewJSONHandler`; trivial change, but should happen before this goes anywhere near a real log aggregator.
- RLS wiring (gap 2.6) — this is the natural point to finally do the connection-per-request refactor documented in `internal/database/rls.go`, since by this sprint the service layer is otherwise feature-complete and won't be churning while the refactor lands.
- Docker Compose file (REQ-NF-051) — not currently in the repo at all; needs Go binary + Postgres + Ollama + optional reverse proxy services defined.
- systemd unit file (REQ-NF-054, Should) — referenced in the original README but the actual file was never created.

---

## 4. Things that need a product decision before engineering starts

Flagging these now so they don't block a sprint mid-way:

1. **"Usage stats" for platform_support (REQ-F area, section 3.2 matrix)** — undefined in the SRS. Needs a one-line spec (active users? plan counts? storage used?) before Sprint A/B work touches the admin console further.
2. **Plan duplication semantics (REQ-F-022)** — should assignees and due dates carry over to the copy, or reset? Affects Sprint E.
3. **Custom activity type registry shape (REQ-F-035)** — is this a simple per-org string allowlist, or does it need its own structured-editor-template metadata (icon, default content schema, etc.)? The SRS's UI section implies activity types drive which editor renders, so a custom type may need more than just a name.
4. **Rate-limit window (gap 2.2)** — confirm whether "10/minute" (spec-literal) or the current "10/5min" (implemented) is correct, and update whichever document is wrong.
5. **SSO auto-detection endpoint (Sprint A)** — confirm the exact contract for the login screen's "auto-detect SSO by email domain" behavior; the SRS describes the UI behavior but the API surface table in section 8 doesn't list a matching endpoint.

---

## 5. Suggested sequencing summary

```
Sprint A — SSO (SAML + OIDC + JIT) + small auth gap fixes      [large]
Sprint B — Plan-scoped viewers + milestones + audit log fill   [medium]
Sprint C — Generative AI (Ollama integration, all REQ-AI)      [large, parallelizable with B]
Sprint D — Linkage engine completion + report generation       [large, depends on C for AI-suggested links + narrative summaries]
Sprint E — Notifications + bulk ops + edit history + templates [medium]
Sprint F — Offline sync (server side) + ops/deployment harden  [medium, depends on B/D being stable]
```

Sprints C and B touch almost entirely disjoint code (new `internal/ai` package vs. existing `plan`/`org` services), so if there are two engineers available, running B and C concurrently is the fastest path to the SRS's full v1.0 scope. D should not start until C is at least functionally complete, since report narrative summaries and AI-suggested links both depend on the Ollama client existing.
