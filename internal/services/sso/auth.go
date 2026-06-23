// auth.go — SSO authentication service methods.
//
// This file contains the business logic behind the four SSO HTTP handlers.
// It is separate from service.go (SSO config CRUD) so the two concerns
// don't entangle each other.
//
// Both SAML and OIDC share a single final step — ssoLogin — which does the
// user lookup, optional JIT provisioning, and token issuance.
//
// Security requirements met by this file:
//
//	REQ-NF-017  SAML:  crewjam/saml validates signature, audience,
//	            timestamps, and replay protection on every assertion.
//	REQ-NF-018  OIDC:  go-oidc verifies issuer, audience, expiry, and
//	            JWKS signature on every ID token.
//	REQ-F-008   JIT:   on first SSO login with no matching account,
//	            ssoProvisionUser creates one with the org's default_role.
package ssosvc

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"spe-light/internal/auth"
	"spe-light/internal/config"
	"spe-light/internal/models"

	crewjamsaml "github.com/crewjam/saml"
	"github.com/crewjam/saml/samlsp"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// AuthService handles SSO authentication flows (SAML + OIDC + JIT).
type AuthService struct {
	db  *pgxpool.Pool
	cfg *config.Config
	svc *Service // config service — looks up SSOConfig by org slug
}

// NewAuth creates an SSO AuthService.
func NewAuth(db *pgxpool.Pool, cfg *config.Config, configSvc *Service) *AuthService {
	return &AuthService{db: db, cfg: cfg, svc: configSvc}
}

// TokenResponse is the same JSON shape as authsvc.TokenResponse, duplicated
// here to avoid an import cycle between authsvc and ssosvc.
type TokenResponse struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	User         UserDTO   `json:"user"`
}

// UserDTO is the public user payload returned alongside tokens.
type UserDTO struct {
	ID    uuid.UUID   `json:"id"`
	Name  string      `json:"name"`
	Email string      `json:"email"`
	Role  models.Role `json:"role"`
	OrgID *uuid.UUID  `json:"org_id,omitempty"`
}

// ── SAML ──────────────────────────────────────────────────────────────────

// BuildSAMLSP constructs a crewjam/saml ServiceProvider for the given org.
// The SP is used for both metadata generation and assertion validation.
// It is intentionally not cached because config can change at any time and
// building it is cheap (no network call unless MetadataURL is used).
func (s *AuthService) BuildSAMLSP(ctx context.Context, orgSlug string, r *http.Request) (*samlsp.Middleware, *models.SSOConfig, *models.Organisation, error) {
	ssoConfig, org, err := s.svc.GetConfigByOrgSlug(ctx, orgSlug)
	if err != nil {
		return nil, nil, nil, err
	}
	if ssoConfig.Protocol != models.SSOSaml {
		return nil, nil, nil, fmt.Errorf("this organisation uses OIDC, not SAML")
	}

	proto := "http"
	if r.TLS != nil {
		proto = "https"
	}
	if fwd := r.Header.Get("X-Forwarded-Proto"); fwd != "" {
		proto = fwd
	}

	spBase := fmt.Sprintf("%s://%s/auth/saml/%s", proto, r.Host, orgSlug)
	spURL, err := url.Parse(spBase)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("build SP URL: %w", err)
	}

	opts := samlsp.Options{
		URL:      *spURL,
		EntityID: spBase + "/metadata",
	}

	switch {
	case ssoConfig.MetadataURL != nil:
		metaURL, err := url.Parse(*ssoConfig.MetadataURL)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("parse metadata URL: %w", err)
		}
		idpMeta, err := samlsp.FetchMetadata(ctx, http.DefaultClient, *metaURL)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("fetch SAML IdP metadata from %s: %w", *ssoConfig.MetadataURL, err)
		}
		opts.IDPMetadata = idpMeta

	case ssoConfig.Certificate != nil && ssoConfig.EntityID != nil:
		opts.IDPMetadata = buildInlineMetadata(*ssoConfig.EntityID, *ssoConfig.Certificate)

	default:
		return nil, nil, nil, fmt.Errorf("SAML config incomplete: provide metadata_url or both entity_id and certificate")
	}

	// Wire the PostgreSQL replay cache so assertion deduplication survives restarts.
	opts.UseArtifactResponse = false // not used; explicit clarity
	store := NewPGAssertionStore(s.db, org.ID)
	_ = store // assigned to opts when samlsp exposes the AssertionStore field; see TODO below
	// TODO: samlsp.Options does not currently have an AssertionStore field exposed
	// in v0.4.x. Wire it via sp.ServiceProvider.AssertionStore after construction:
	sp, err := samlsp.New(opts)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("build SAML SP: %w", err)
	}
	// Assign the PostgreSQL store to the underlying SP so replay protection
	// is durable. crewjam/saml reads from sp.ServiceProvider.AssertionStore.
	sp.ServiceProvider.AssertionStore = store
	return sp, ssoConfig, org, nil
}

// HandleSAMLAssertion processes a validated SAML assertion from the ACS
// endpoint. crewjam/saml has already verified the signature, audience,
// timestamps, and replay protection before this is called (REQ-NF-017).
//
// attributes is the flat map of attribute name → value extracted from
// the assertion's AttributeStatement by the handler.
func (s *AuthService) HandleSAMLAssertion(
	ctx context.Context,
	orgID uuid.UUID,
	ssoConfig *models.SSOConfig,
	attributes map[string]string,
) (*TokenResponse, error) {
	// Extract email — try multiple common attribute names.
	email := coalesce(
		attributes["email"],
		attributes["emailAddress"],
		attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
	)
	name := coalesce(
		attributes["displayName"],
		attributes["name"],
		attributes["http://schemas.microsoft.com/identity/claims/displayname"],
		email,
	)
	// Use NameID as the stable SSO subject where available.
	subject := coalesce(attributes["NameID"], attributes["uid"], email)

	if email == "" {
		return nil, fmt.Errorf("SAML assertion is missing an email attribute; check your IdP attribute mappings")
	}

	return s.ssoLogin(ctx, orgID, ssoConfig, subject, email, name)
}

// ── OIDC ──────────────────────────────────────────────────────────────────

// BuildOIDCConfig constructs the oauth2.Config and go-oidc Provider needed
// for Authorization Code + PKCE flow. Called at both the login redirect and
// callback endpoints.
func (s *AuthService) BuildOIDCConfig(
	ctx context.Context,
	orgSlug string,
) (*oauth2.Config, *gooidc.Provider, *models.SSOConfig, *models.Organisation, error) {
	ssoConfig, org, err := s.svc.GetConfigByOrgSlug(ctx, orgSlug)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if ssoConfig.Protocol != models.SSOOidc {
		return nil, nil, nil, nil, fmt.Errorf("this organisation uses SAML, not OIDC")
	}
	if ssoConfig.DiscoveryURL == nil || ssoConfig.ClientID == nil || ssoConfig.ClientSecret == nil {
		return nil, nil, nil, nil, fmt.Errorf("OIDC config is incomplete: discovery_url, client_id, and client_secret are all required")
	}

	// go-oidc fetches the provider's JWKS and endpoint metadata at construction.
	// REQ-NF-018: subsequent IDToken.Verify calls check issuer, audience, expiry,
	// and the RS256/ES256 signature against the fetched JWKS.
	provider, err := gooidc.NewProvider(ctx, *ssoConfig.DiscoveryURL)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("OIDC provider discovery failed for %s: %w", *ssoConfig.DiscoveryURL, err)
	}

	oauthCfg := &oauth2.Config{
		ClientID:     *ssoConfig.ClientID,
		ClientSecret: *ssoConfig.ClientSecret,
		RedirectURL:  fmt.Sprintf("%s/auth/oidc/%s/callback", s.cfg.AppURL, orgSlug),
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{gooidc.ScopeOpenID, "profile", "email"},
	}

	return oauthCfg, provider, ssoConfig, org, nil
}

// HandleOIDCCallback exchanges the authorization code, validates the ID
// token, and returns a StratPlan token pair. nonce is the value that was
// stored in the state cookie during the login redirect; it must match
// the nonce embedded in the ID token to prevent replay attacks.
func (s *AuthService) HandleOIDCCallback(
	ctx context.Context,
	orgID uuid.UUID,
	ssoConfig *models.SSOConfig,
	oauthCfg *oauth2.Config,
	provider *gooidc.Provider,
	code, nonce, codeVerifier string,
) (*TokenResponse, error) {
	// Exchange the authorization code for OAuth2 tokens (verifies PKCE).
	oauth2Token, err := oauthCfg.Exchange(ctx, code, oauth2.VerifierOption(codeVerifier))
	if err != nil {
		return nil, fmt.Errorf("OIDC code exchange failed: %w", err)
	}

	rawIDToken, ok := oauth2Token.Extra("id_token").(string)
	if !ok {
		return nil, fmt.Errorf("OIDC response is missing id_token")
	}

	// Verify the ID token (REQ-NF-018: issuer, audience, expiry, JWKS signature).
	verifier := provider.Verifier(&gooidc.Config{ClientID: *ssoConfig.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("OIDC id_token verification failed: %w", err)
	}

	// Nonce check — prevents replay of a captured authorization response.
	if idToken.Nonce != nonce {
		return nil, fmt.Errorf("OIDC nonce mismatch — possible replay attack")
	}

	// Extract standard claims.
	var claims struct {
		Email   string `json:"email"`
		Name    string `json:"name"`
		Subject string `json:"sub"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("OIDC claims extraction failed: %w", err)
	}
	if claims.Email == "" {
		return nil, fmt.Errorf("OIDC id_token is missing the email claim — ensure the 'email' scope is granted by the IdP")
	}

	name := claims.Name
	if name == "" {
		name = claims.Email
	}

	return s.ssoLogin(ctx, orgID, ssoConfig, idToken.Subject, claims.Email, name)
}

// ── Shared SSO login path ─────────────────────────────────────────────────

// ssoLogin is the single shared code path for all SSO logins regardless of
// protocol. It looks up or provisions the user, verifies they're active,
// and issues tokens.
func (s *AuthService) ssoLogin(
	ctx context.Context,
	orgID uuid.UUID,
	ssoConfig *models.SSOConfig,
	ssoSubject, email, name string,
) (*TokenResponse, error) {
	user, err := s.findUser(ctx, orgID, ssoSubject, email)
	if err != nil {
		return nil, fmt.Errorf("lookup SSO user: %w", err)
	}

	if user == nil {
		if !ssoConfig.JITEnabled {
			return nil, fmt.Errorf("no account found for %s — contact your organisation admin", email)
		}
		user, err = s.ssoProvisionUser(ctx, orgID, ssoSubject, email, name, ssoConfig.DefaultRole)
		if err != nil {
			return nil, err
		}
		slog.Info("SSO JIT provisioned", "user_id", user.ID, "email", email, "org_id", orgID, "role", user.Role)
	}

	if !user.IsActive {
		return nil, fmt.Errorf("account is deactivated")
	}

	// Persist the sso_subject if it wasn't stored yet (pre-created invite account
	// logging in via SSO for the first time).
	if user.SSOSubject == nil || *user.SSOSubject != ssoSubject {
		_, _ = s.db.Exec(ctx,
			`UPDATE users SET sso_subject = $1, updated_at = NOW() WHERE id = $2`,
			ssoSubject, user.ID)
	}

	// Update last_login_at — best-effort, non-fatal.
	_, _ = s.db.Exec(ctx, `UPDATE users SET last_login_at = NOW() WHERE id = $1`, user.ID)

	slog.Info("SSO login", "user_id", user.ID, "email", email, "org_id", orgID)
	return s.issueTokenPair(ctx, user)
}

// findUser looks up a user within an org. Tries sso_subject first (stable
// IdP identity that survives email changes), then falls back to email
// (to link pre-provisioned invite accounts on first SSO login).
// Returns (nil, nil) when the user doesn't exist yet — caller handles JIT.
func (s *AuthService) findUser(ctx context.Context, orgID uuid.UUID, ssoSubject, email string) (*models.User, error) {
	var u models.User

	// Primary lookup: by sso_subject.
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, email, name, role, locale, is_active, sso_subject
		 FROM users
		 WHERE org_id = $1 AND sso_subject = $2 AND deleted_at IS NULL`,
		orgID, ssoSubject,
	).Scan(&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role, &u.Locale, &u.IsActive, &u.SSOSubject)
	if err == nil {
		return &u, nil
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}

	// Fallback: by email — links a user created via invite to their SSO identity.
	err = s.db.QueryRow(ctx,
		`SELECT id, org_id, email, name, role, locale, is_active, sso_subject
		 FROM users
		 WHERE org_id = $1 AND email = $2 AND deleted_at IS NULL`,
		orgID, email,
	).Scan(&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role, &u.Locale, &u.IsActive, &u.SSOSubject)
	if err == nil {
		return &u, nil
	}
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return nil, err
}

// ssoProvisionUser creates a new user account during JIT provisioning.
// The account has no password_hash (SSO-only — cannot log in with a password).
// REQ-F-008.
func (s *AuthService) ssoProvisionUser(ctx context.Context, orgID uuid.UUID, ssoSubject, email, name string, role models.Role) (*models.User, error) {
	u := &models.User{
		ID:         uuid.New(),
		OrgID:      &orgID,
		Email:      email,
		Name:       name,
		Role:       role,
		Locale:     "en",
		IsActive:   true,
		SSOSubject: &ssoSubject,
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO users (id, org_id, email, name, role, locale, is_active, sso_subject)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		u.ID, u.OrgID, u.Email, u.Name, u.Role, u.Locale, u.IsActive, u.SSOSubject,
	)
	if err != nil {
		return nil, fmt.Errorf("JIT provision user: %w", err)
	}
	return u, nil
}

// issueTokenPair mints a JWT access token + refresh token pair and persists
// the refresh token hash. Logic is identical to authsvc.issueTokenPair —
// duplicated here to avoid a cross-service import (authsvc.issueTokenPair is
// unexported). Both call the same auth.* helpers.
func (s *AuthService) issueTokenPair(ctx context.Context, user *models.User) (*TokenResponse, error) {
	claims := models.TokenClaims{
		UserID: user.ID,
		OrgID:  user.OrgID,
		Role:   user.Role,
		Email:  user.Email,
	}
	accessToken, err := auth.IssueAccessToken(s.cfg.JWTSecret, s.cfg.JWTAccessExpiry(), claims)
	if err != nil {
		return nil, fmt.Errorf("issue access token: %w", err)
	}

	plaintext, hash, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(s.cfg.JWTRefreshExpiry())
	if _, err = s.db.Exec(ctx,
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		uuid.New(), user.ID, hash, expiresAt,
	); err != nil {
		return nil, fmt.Errorf("store refresh token: %w", err)
	}

	return &TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: plaintext,
		ExpiresAt:    expiresAt,
		User: UserDTO{
			ID:    user.ID,
			Name:  user.Name,
			Email: user.Email,
			Role:  user.Role,
			OrgID: user.OrgID,
		},
	}, nil
}

// ── Helpers ───────────────────────────────────────────────────────────────

// coalesce returns the first non-empty string.
func coalesce(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// buildInlineMetadata constructs a minimal SAML EntityDescriptor from a
// raw PEM certificate and entity ID, used when the IdP doesn't publish a
// metadata URL.
func buildInlineMetadata(entityID, certPEM string) *crewjamsaml.EntityDescriptor {
	return &crewjamsaml.EntityDescriptor{
		EntityID: entityID,
		IDPSSODescriptors: []crewjamsaml.IDPSSODescriptor{
			{
				KeyDescriptors: []crewjamsaml.KeyDescriptor{
					{
						Use: "signing",
						KeyInfo: crewjamsaml.KeyInfo{
							X509Data: crewjamsaml.X509Data{
								X509Certificates: []crewjamsaml.X509Certificate{
									{Data: certPEM},
								},
							},
						},
					},
				},
			},
		},
	}
}
