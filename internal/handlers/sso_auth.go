// sso_auth.go — SSO authentication HTTP handlers.
//
// These four handlers implement the public SSO routes, replacing the 501
// stubs from Sprint A.
//
// Routes (all public — no Bearer JWT):
//
//	GET  /auth/saml/{orgSlug}/metadata   — SAML SP metadata XML for IdP setup
//	POST /auth/saml/{orgSlug}/acs        — SAML Assertion Consumer Service
//	GET  /auth/oidc/{orgSlug}/login      — OIDC: redirect to IdP with PKCE challenge
//	GET  /auth/oidc/{orgSlug}/callback   — OIDC: exchange code, verify token, issue JWT
//
// Post-login redirect:
//
//	On success both SAML and OIDC redirect the browser to:
//	  {APP_URL}/auth/callback?access_token=...&refresh_token=...&expires_at=...
//	The React SPA reads these params, stores the tokens, and navigates to the
//	dashboard. To use httpOnly cookies instead, replace redirectWithTokens().
//
// OIDC state cookie:
//
//	The nonce + PKCE code-verifier are stored in a signed, 10-minute,
//	HttpOnly cookie during the redirect round-trip. The cookie value is
//	base64(JSON) + "." + HMAC-SHA256(base64(JSON)) signed with the JWT secret.
package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"spe-light/internal/auth"
	"spe-light/internal/response"
	ssosvc "spe-light/internal/services/sso"

	"github.com/crewjam/saml/samlsp"
	"github.com/go-chi/chi/v5"
	"golang.org/x/oauth2"
)

// SSOAuth groups the SSO authentication HTTP handlers.
type SSOAuth struct {
	svc    *ssosvc.AuthService
	appURL string
	secret string // JWT secret — used to HMAC-sign the OIDC state cookie
}

// NewSSOAuth creates an SSOAuth handler group.
func NewSSOAuth(svc *ssosvc.AuthService, appURL, jwtSecret string) *SSOAuth {
	return &SSOAuth{svc: svc, appURL: appURL, secret: jwtSecret}
}

// ── SAML ──────────────────────────────────────────────────────────────────

// GET /auth/saml/{orgSlug}/metadata
//
// Returns the SP's SAML metadata XML. The org admin pastes this URL (or its
// XML content) into their IdP during SSO setup. No authentication required.
func (h *SSOAuth) SAMLMetadata(w http.ResponseWriter, r *http.Request) {
	orgSlug := chi.URLParam(r, "orgSlug")

	sp, _, _, err := h.svc.BuildSAMLSP(r.Context(), orgSlug, r)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}

	// crewjam/saml's ServeMetadata writes the XML with the correct Content-Type.
	sp.ServeMetadata(w, r)
}

// POST /auth/saml/{orgSlug}/acs
//
// SAML Assertion Consumer Service. The IdP POST-backs here after the user
// authenticates. crewjam/saml's middleware validates the assertion (signature,
// audience, NotBefore/NotOnOrAfter, replay cache) before this handler body
// runs — any invalid assertion is rejected with 403 by the library.
//
// On success: redirects to {APP_URL}/auth/callback with tokens in the query.
func (h *SSOAuth) SAMLAssertionConsumer(w http.ResponseWriter, r *http.Request) {
	orgSlug := chi.URLParam(r, "orgSlug")

	sp, ssoConfig, org, err := h.svc.BuildSAMLSP(r.Context(), orgSlug, r)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Wrap our business logic in the crewjam/saml middleware chain.
	// The middleware validates the assertion and injects the session into ctx.
	sp.ServeHTTP(w, r, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, ok := r.Context().Value(samlsp.SessionContextKey).(samlsp.Session)
		if !ok {
			response.ErrorJSON(w, "SAML session missing from context after assertion", http.StatusInternalServerError)
			return
		}

		jwtSession, ok := session.(samlsp.JWTSessionClaims)
		if !ok {
			response.ErrorJSON(w, "unexpected SAML session type", http.StatusInternalServerError)
			return
		}

		// Build a flat attribute map from the assertion's AttributeStatement.
		attributes := make(map[string]string)
		for _, attr := range jwtSession.Attributes {
			if len(attr.Values) > 0 {
				// Index by both friendly name and full URI name for broad IdP compatibility.
				if attr.FriendlyName != "" {
					attributes[attr.FriendlyName] = attr.Values[0].Value
				}
				attributes[attr.Name] = attr.Values[0].Value
			}
		}
		// NameID is the most reliable stable subject identifier.
		if jwtSession.Subject != "" {
			attributes["NameID"] = jwtSession.Subject
		}

		tokens, err := h.svc.HandleSAMLAssertion(r.Context(), org.ID, ssoConfig, attributes)
		if err != nil {
			slog.Warn("SAML assertion handling failed", "org", orgSlug, "err", err)
			response.ErrorJSON(w, err.Error(), http.StatusUnauthorized)
			return
		}

		redirectWithTokens(w, r, h.appURL, tokens)
	}))
}

// ── OIDC ──────────────────────────────────────────────────────────────────

// GET /auth/oidc/{orgSlug}/login
//
// Starts the Authorization Code + PKCE flow. Generates a cryptographically
// random nonce and code verifier, stores them in a signed cookie, and
// redirects to the IdP's authorization endpoint.
func (h *SSOAuth) OIDCLogin(w http.ResponseWriter, r *http.Request) {
	orgSlug := chi.URLParam(r, "orgSlug")

	oauthCfg, _, _, _, err := h.svc.BuildOIDCConfig(r.Context(), orgSlug)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}

	nonce, err := randomHex(16)
	if err != nil {
		response.ErrorJSON(w, "failed to generate nonce", http.StatusInternalServerError)
		return
	}
	codeVerifier, err := randomHex(32)
	if err != nil {
		response.ErrorJSON(w, "failed to generate PKCE verifier", http.StatusInternalServerError)
		return
	}

	state := oidcCookieState{
		Nonce:        nonce,
		CodeVerifier: codeVerifier,
		OrgSlug:      orgSlug,
		ExpiresAt:    time.Now().Add(10 * time.Minute),
	}
	if err := h.setOIDCStateCookie(w, state); err != nil {
		response.ErrorJSON(w, "failed to set state cookie", http.StatusInternalServerError)
		return
	}

	// Build the IdP authorization URL with the PKCE S256 challenge.
	// The nonce serves double duty: OAuth2 state param (anti-CSRF) and the
	// id_token nonce claim (anti-replay for the token itself).
	authURL := oauthCfg.AuthCodeURL(
		nonce, // OAuth2 state
		oauth2.S256ChallengeOption(codeVerifier),
		oauth2.SetAuthURLParam("nonce", nonce),
	)

	http.Redirect(w, r, authURL, http.StatusFound)
}

// GET /auth/oidc/{orgSlug}/callback
//
// Handles the authorization code callback from the IdP. Validates the state
// cookie, exchanges the code (with PKCE verifier), verifies the ID token,
// looks up or provisions the user, and redirects with StratPlan tokens.
func (h *SSOAuth) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	orgSlug := chi.URLParam(r, "orgSlug")

	// Validate and consume the state cookie first — do this before any other
	// work so we clear it even if subsequent steps fail.
	state, err := h.readOIDCStateCookie(r)
	clearOIDCStateCookie(w)
	if err != nil {
		response.ErrorJSON(w, "invalid or expired SSO state — please try logging in again", http.StatusBadRequest)
		return
	}

	// Check for explicit errors from the IdP (e.g. user cancelled, access denied).
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		desc := r.URL.Query().Get("error_description")
		slog.Warn("OIDC IdP error", "org", orgSlug, "error", errParam, "description", desc)
		response.ErrorJSON(w, fmt.Sprintf("identity provider returned an error: %s", errParam), http.StatusUnauthorized)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		response.ErrorJSON(w, "missing authorization code in callback", http.StatusBadRequest)
		return
	}

	// The OAuth2 state param must match the nonce we generated at login.
	if r.URL.Query().Get("state") != state.Nonce {
		response.ErrorJSON(w, "OAuth2 state mismatch — possible CSRF", http.StatusBadRequest)
		return
	}

	oauthCfg, provider, ssoConfig, org, err := h.svc.BuildOIDCConfig(r.Context(), orgSlug)
	if err != nil {
		response.ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Thread the PKCE code verifier into the token exchange.
	// oauth2.Exchange accepts extra options so we patch the config here.
	tokens, err := h.svc.HandleOIDCCallback(
		r.Context(), org.ID, ssoConfig,
		oauthCfg, provider,
		code, state.Nonce, state.CodeVerifier,
	)
	if err != nil {
		slog.Warn("OIDC callback failed", "org", orgSlug, "err", err)
		response.ErrorJSON(w, err.Error(), http.StatusUnauthorized)
		return
	}

	redirectWithTokens(w, r, h.appURL, tokens)
}

// ── Cookie helpers ────────────────────────────────────────────────────────

// oidcCookieState is the payload stored in the signed OIDC state cookie.
type oidcCookieState struct {
	Nonce        string    `json:"nonce"`
	CodeVerifier string    `json:"cv"` // PKCE verifier
	OrgSlug      string    `json:"org"`
	ExpiresAt    time.Time `json:"exp"`
}

const oidcStateCookieName = "sso_state"

// setOIDCStateCookie serialises the state, HMAC-signs it, and sets the cookie.
// Cookie format: base64url(JSON) + "." + hex(HMAC-SHA256(base64url(JSON)))
func (h *SSOAuth) setOIDCStateCookie(w http.ResponseWriter, state oidcCookieState) error {
	payload, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}

	encoded := base64.RawURLEncoding.EncodeToString(payload)
	sig := auth.SignLink(h.secret, encoded) // HMAC-SHA256 hex string
	cookieVal := encoded + "." + sig

	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookieName,
		Value:    cookieVal,
		Path:     "/auth/oidc/",
		MaxAge:   600, // 10 minutes
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		// Secure: true — set this in production behind TLS.
		// The config/middleware layer enforces HTTPS in production;
		// setting it here would break local HTTP dev.
	})
	return nil
}

// readOIDCStateCookie reads, signature-verifies, and decodes the state cookie.
func (h *SSOAuth) readOIDCStateCookie(r *http.Request) (oidcCookieState, error) {
	var zero oidcCookieState

	cookie, err := r.Cookie(oidcStateCookieName)
	if err != nil {
		return zero, fmt.Errorf("state cookie missing")
	}

	// Split at the last "." — sig is always 64 hex chars.
	val := cookie.Value
	if len(val) < 66 { // at least 1 char of payload + "." + 64 char sig
		return zero, fmt.Errorf("state cookie too short")
	}
	splitAt := len(val) - 65 // position of the separator "."
	if val[splitAt] != '.' {
		return zero, fmt.Errorf("state cookie malformed")
	}
	encoded := val[:splitAt]
	sig := val[splitAt+1:]

	if !auth.VerifyLink(h.secret, encoded, sig) {
		return zero, fmt.Errorf("state cookie signature invalid")
	}

	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return zero, fmt.Errorf("state cookie decode: %w", err)
	}

	var state oidcCookieState
	if err := json.Unmarshal(payload, &state); err != nil {
		return zero, fmt.Errorf("state cookie unmarshal: %w", err)
	}

	if time.Now().After(state.ExpiresAt) {
		return zero, fmt.Errorf("state cookie expired")
	}

	return state, nil
}

func clearOIDCStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:    oidcStateCookieName,
		Value:   "",
		Path:    "/auth/oidc/",
		MaxAge:  -1,
		Expires: time.Unix(0, 0),
	})
}

// ── Post-login redirect ───────────────────────────────────────────────────

// redirectWithTokens sends the browser to {APP_URL}/auth/callback with the
// StratPlan token pair in the query string. The React SPA reads these, stores
// them, and navigates to the dashboard.
//
// To switch to httpOnly cookie delivery instead, replace this function body —
// the callers don't care about the delivery mechanism.
func redirectWithTokens(w http.ResponseWriter, r *http.Request, appURL string, tokens *ssosvc.TokenResponse) {
	dest, err := url.Parse(appURL + "/auth/callback")
	if err != nil {
		response.ErrorJSON(w, "invalid APP_URL configuration", http.StatusInternalServerError)
		return
	}
	q := dest.Query()
	q.Set("access_token", tokens.AccessToken)
	q.Set("refresh_token", tokens.RefreshToken)
	q.Set("expires_at", tokens.ExpiresAt.UTC().Format(time.RFC3339))
	dest.RawQuery = q.Encode()
	http.Redirect(w, r, dest.String(), http.StatusFound)
}

// ── Utilities ─────────────────────────────────────────────────────────────

// randomHex returns n cryptographically random bytes as a lowercase hex string.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand.Read: %w", err)
	}
	return hex.EncodeToString(b), nil
}
