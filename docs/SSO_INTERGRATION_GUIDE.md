# SSO Integration Guide

How to configure SAML 2.0 or OIDC for your organisation in StratPlan.

This guide is written for the person who administers the Identity Provider (Okta, Azure AD, Google Workspace, Auth0, Keycloak, etc.) and the StratPlan org admin who needs to enter the config. Both roles are sometimes the same person.

---

## How SSO fits into StratPlan's auth model

Whether a user logs in with a password or via SSO, StratPlan issues the same JWT access + refresh token pair on success. SSO is purely a *verification mechanism* — the token lifecycle, session management, and role model are identical after login.

SSO is optional and per-organisation. Local email+password login remains available unless an org admin explicitly disables it in the SSO config.

---

## SAML 2.0

### What StratPlan acts as

StratPlan is the **Service Provider (SP)**. Your existing identity system (Okta, Azure AD, ADFS, etc.) is the **Identity Provider (IdP)**.

### Step 1 — Get the SP metadata URL

StratPlan exposes an SP metadata XML document at:

```
GET {APP_URL}/auth/saml/{orgSlug}/metadata
```

`orgSlug` is your organisation's URL slug — shown in the Platform Admin console or derived from your org name (e.g. "Acme Inc" → `acme-inc-<8chars>`).

You can give this URL directly to most IdPs (Okta, Azure, etc.) so they can auto-import the SP config. Alternatively, download the XML and upload it to IdPs that require a file.

### Step 2 — Configure the IdP

In your IdP, create a new SAML application and set:

| IdP field | Value |
|-----------|-------|
| ACS URL / SSO URL | `{APP_URL}/auth/saml/{orgSlug}/acs` |
| Entity ID / Audience | `{APP_URL}/auth/saml/{orgSlug}/metadata` |
| NameID format | EmailAddress (preferred) or Persistent |
| Attribute mapping | See table below |

**Required attribute mappings** (StratPlan reads these from the assertion):

| SAML Attribute | Value to map |
|----------------|-------------|
| `email` or `emailAddress` or the URI `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | User's email address |

**Recommended attribute mappings:**

| SAML Attribute | Value to map |
|----------------|-------------|
| `displayName` or `name` | User's full name |

StratPlan falls back to the NameID value for email if none of the above attributes are present, and uses email as display name if no name attribute is provided.

### Step 3 — Configure StratPlan

As org admin, call:

```
PUT /api/v1/org/sso
Authorization: Bearer <org_admin_token>

{
  "protocol": "saml",
  "metadata_url": "https://your-idp.example.com/app/metadata",
  "default_role": "viewer",
  "jit_enabled": true,
  "local_login_disabled": false
}
```

If your IdP doesn't publish a metadata URL, provide the certificate and entity ID directly instead:

```json
{
  "protocol": "saml",
  "entity_id": "https://your-idp.example.com/issuer",
  "certificate": "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
  "default_role": "viewer",
  "jit_enabled": true,
  "local_login_disabled": false
}
```

### Step 4 — Test

Send users to your IdP's dashboard or to a deep link your IdP provides. After authenticating at the IdP, they are redirected to `{APP_URL}/auth/callback?access_token=...`.

The first login for a new user provisions their account with `default_role` (if `jit_enabled: true`). Subsequent logins find the existing account by `sso_subject` (the assertion's NameID).

### Security notes

- StratPlan validates the assertion signature, audience, NotBefore, NotOnOrAfter, and replay using crewjam/saml (REQ-NF-017).
- Replay protection is backed by PostgreSQL (migration 004) — durable across restarts and multi-instance deployments.
- Unsigned assertions are rejected.
- StratPlan does not currently sign outgoing `AuthnRequest` messages (no SP private key is configured). Most IdPs don't require signed requests for SP-initiated flows, but if yours does, contact support.

---

## OIDC

### What StratPlan uses

Authorization Code Flow with PKCE (REQ-F-007). No implicit flow, no client credentials. The client secret is used for the server-side code exchange — it never leaves the backend.

### Step 1 — Register the application in your IdP

Create an OIDC application (also called "OAuth2 client" in some systems) and set:

| Field | Value |
|-------|-------|
| Application type | Web application (not SPA — the code exchange happens server-side) |
| Redirect URI / Callback URL | `{APP_URL}/auth/oidc/{orgSlug}/callback` |
| Allowed scopes | `openid`, `profile`, `email` |
| Grant types | Authorization Code |

Note the **Client ID** and **Client Secret** — you'll need them in step 2.

### Step 2 — Configure StratPlan

```
PUT /api/v1/org/sso
Authorization: Bearer <org_admin_token>

{
  "protocol": "oidc",
  "client_id": "your-client-id",
  "client_secret": "your-client-secret",
  "discovery_url": "https://accounts.google.com",
  "default_role": "viewer",
  "jit_enabled": true,
  "local_login_disabled": false
}
```

**Discovery URL by provider:**

| Provider | Discovery URL |
|----------|--------------|
| Google | `https://accounts.google.com` |
| Microsoft / Azure AD | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| Okta | `https://{your-okta-domain}` |
| Auth0 | `https://{your-auth0-domain}` |
| Keycloak | `https://{keycloak-host}/realms/{realm-name}` |

### Step 3 — Test

Direct users to: `{APP_URL}/auth/oidc/{orgSlug}/login`

They are redirected to the IdP, authenticate, and return to `{APP_URL}/auth/callback?access_token=...`.

### Security notes

- StratPlan uses PKCE (S256) on every login — the code verifier is generated fresh per request, stored in a signed cookie, and verified at the callback.
- The OIDC state parameter doubles as the anti-CSRF token and the nonce for the ID token — both are verified at the callback endpoint.
- The state cookie is HMAC-signed with the JWT secret and expires after 10 minutes.
- go-oidc validates issuer, audience, expiry, and the RS256/ES256 signature against the IdP's JWKS endpoint (REQ-NF-018).
- `client_secret` is never returned by `GET /api/v1/org/sso` — it is write-only.

---

## JIT provisioning

When `jit_enabled: true` (the default), the first login from an unknown email address automatically creates a user account with `default_role`.

When `jit_enabled: false`, only users with pre-existing StratPlan accounts (created via invitation) can log in via SSO. Users without an account receive: `no account found for <email> — contact your organisation admin`.

**Linking invite accounts to SSO:**

If a user was invited before SSO was configured, their first SSO login links their existing account (matched by email) to their SSO identity (`sso_subject`). Subsequent logins use `sso_subject` directly, which is more reliable than email matching (survives email address changes at the IdP).

---

## Disabling local login

Setting `local_login_disabled: true` blocks `POST /auth/login` for all users in the org. The login endpoint returns:

```json
{ "error": "this account uses SSO — please sign in via your identity provider" }
```

**Important:** If you lock yourself out (e.g. SSO misconfigured + local login disabled), a `super_admin` can delete the SSO config via the platform admin API:

```
DELETE /api/v1/org/sso
```

This immediately re-enables local login regardless of what `local_login_disabled` was.

---

## Role management

SSO does not automatically sync roles from the IdP. The `default_role` in the SSO config is used only at JIT provisioning time. After that, role changes are made by the org admin via `PATCH /api/v1/org/users/{userID}`.

SCIM provisioning (automatic role sync from Okta, Azure AD, etc.) is planned for v1.2.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `SAML assertion is missing an email attribute` | The IdP isn't sending an email attribute. Check attribute mappings in the IdP config. |
| `SAML assertion replay detected` | The same assertion was submitted twice. Normal browsers never do this; indicates a double-submit or replay attempt. |
| `SAML config incomplete: provide metadata_url or both entity_id and certificate` | The SSO config in StratPlan is missing required fields. Re-PUT with the correct fields. |
| `OIDC provider discovery failed` | The `discovery_url` is unreachable from the StratPlan server, or the URL is wrong. Test with `curl {discovery_url}/.well-known/openid-configuration`. |
| `OIDC id_token is missing the email claim` | The IdP didn't include the email in the token. Ensure the `email` scope is granted and the app has permission to share email. |
| `OIDC nonce mismatch` | The state cookie expired (>10 min round-trip) or was tampered with. User should try logging in again. |
| `OAuth2 state mismatch — possible CSRF` | As above, or the cookie was lost (SameSite=Lax may block it on some cross-origin redirects in unusual browser configs). |
| `no account found for X — contact your organisation admin` | `jit_enabled: false` and the user doesn't have a pre-existing account. Either enable JIT or send the user an invitation. |
| `this organisation uses SAML, not OIDC` | The login URL (`/auth/oidc/...`) was used for an org configured with SAML, or vice versa. The frontend should detect the protocol from `GET /api/v1/org/sso` and route accordingly. |