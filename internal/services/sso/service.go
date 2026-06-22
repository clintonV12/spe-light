// Package ssosvc implements SSO configuration management for StratPlan.
//
// Each organisation can have at most one active SSO configuration. This service
// handles creating/updating the config (PUT is an upsert — one row per org),
// reading it for display in the admin UI, and removing it to re-enable local
// login.
//
// The actual SAML/OIDC authentication flows (assertion consumer, OIDC callback,
// JIT provisioning) are implemented separately in internal/handlers/sso_auth.go
// and internal/services/sso/auth.go, which depend on this config being present.
//
// REQ-F-006 (SAML), REQ-F-007 (OIDC), REQ-F-009 (optional per org).
package ssosvc

import (
	"context"
	"fmt"

	"spe-light/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service handles SSO configuration operations.
type Service struct {
	db *pgxpool.Pool
}

// New creates an SSO Service.
func New(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// ── DTOs ──────────────────────────────────────────────────────────────────

// UpsertSSORequest carries every configurable SSO field.
// Exactly one of the SAML or OIDC field groups must be populated depending
// on the chosen protocol.
type UpsertSSORequest struct {
	// Common
	Protocol           models.SSOProtocol `json:"protocol"`             // "saml" or "oidc"
	DefaultRole        models.Role        `json:"default_role"`         // role assigned to JIT-provisioned users
	JITEnabled         bool               `json:"jit_enabled"`          // auto-create accounts on first SSO login
	LocalLoginDisabled bool               `json:"local_login_disabled"` // block email+password login for this org

	// SAML fields (required when protocol = "saml")
	MetadataURL *string `json:"metadata_url,omitempty"` // IdP metadata URL (preferred over XML upload)
	EntityID    *string `json:"entity_id,omitempty"`    // SP entity ID
	Certificate *string `json:"certificate,omitempty"`  // IdP signing certificate (PEM)

	// OIDC fields (required when protocol = "oidc")
	ClientID     *string `json:"client_id,omitempty"`     // OIDC client ID
	ClientSecret *string `json:"client_secret,omitempty"` // OIDC client secret
	DiscoveryURL *string `json:"discovery_url,omitempty"` // OIDC discovery URL (e.g. https://accounts.google.com)
}

// ── Get ───────────────────────────────────────────────────────────────────

// GetConfig returns the SSO configuration for an org, or nil if none is set.
// client_secret and certificate are always omitted from the response (see model
// json:"-" tags) — they are write-only.
func (s *Service) GetConfig(ctx context.Context, orgID uuid.UUID) (*models.SSOConfig, error) {
	var cfg models.SSOConfig
	err := s.db.QueryRow(ctx,
		`SELECT id, org_id, protocol, metadata_url, entity_id, certificate,
		        client_id, client_secret, discovery_url,
		        default_role, jit_enabled, local_login_disabled, created_at, updated_at
		 FROM sso_configs WHERE org_id = $1`,
		orgID,
	).Scan(
		&cfg.ID, &cfg.OrgID, &cfg.Protocol, &cfg.MetadataURL, &cfg.EntityID, &cfg.Certificate,
		&cfg.ClientID, &cfg.ClientSecret, &cfg.DiscoveryURL,
		&cfg.DefaultRole, &cfg.JITEnabled, &cfg.LocalLoginDisabled, &cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil // no config — not an error
	}
	if err != nil {
		return nil, fmt.Errorf("get sso config: %w", err)
	}
	return &cfg, nil
}

// ── Upsert ────────────────────────────────────────────────────────────────

// UpsertConfig creates or replaces the SSO configuration for an org.
// Uses INSERT ... ON CONFLICT (org_id) DO UPDATE so the org's single-row
// constraint (UNIQUE org_id on sso_configs) is honoured at the DB level.
func (s *Service) UpsertConfig(ctx context.Context, orgID uuid.UUID, req UpsertSSORequest) (*models.SSOConfig, error) {
	if err := validateUpsert(req); err != nil {
		return nil, err
	}

	// Resolve the default role — must be an org-tier role.
	if req.DefaultRole == "" {
		req.DefaultRole = models.RoleViewer
	}
	if req.DefaultRole.IsPlatformRole() {
		return nil, fmt.Errorf("default_role cannot be a platform-tier role")
	}

	cfg := &models.SSOConfig{
		ID:                 uuid.New(),
		OrgID:              orgID,
		Protocol:           req.Protocol,
		MetadataURL:        req.MetadataURL,
		EntityID:           req.EntityID,
		Certificate:        req.Certificate,
		ClientID:           req.ClientID,
		ClientSecret:       req.ClientSecret,
		DiscoveryURL:       req.DiscoveryURL,
		DefaultRole:        req.DefaultRole,
		JITEnabled:         req.JITEnabled,
		LocalLoginDisabled: req.LocalLoginDisabled,
	}

	err := s.db.QueryRow(ctx,
		`INSERT INTO sso_configs
		 (id, org_id, protocol, metadata_url, entity_id, certificate,
		  client_id, client_secret, discovery_url,
		  default_role, jit_enabled, local_login_disabled)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		 ON CONFLICT (org_id) DO UPDATE SET
		   protocol            = EXCLUDED.protocol,
		   metadata_url        = EXCLUDED.metadata_url,
		   entity_id           = EXCLUDED.entity_id,
		   certificate         = EXCLUDED.certificate,
		   client_id           = EXCLUDED.client_id,
		   client_secret       = EXCLUDED.client_secret,
		   discovery_url       = EXCLUDED.discovery_url,
		   default_role        = EXCLUDED.default_role,
		   jit_enabled         = EXCLUDED.jit_enabled,
		   local_login_disabled = EXCLUDED.local_login_disabled,
		   updated_at          = NOW()
		 RETURNING created_at, updated_at`,
		cfg.ID, cfg.OrgID, cfg.Protocol, cfg.MetadataURL, cfg.EntityID, cfg.Certificate,
		cfg.ClientID, cfg.ClientSecret, cfg.DiscoveryURL,
		cfg.DefaultRole, cfg.JITEnabled, cfg.LocalLoginDisabled,
	).Scan(&cfg.CreatedAt, &cfg.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert sso config: %w", err)
	}

	// On conflict the INSERT id is ignored; reload to get the real stored id.
	stored, err := s.GetConfig(ctx, orgID)
	if err != nil {
		return nil, err
	}
	return stored, nil
}

// ── Delete ────────────────────────────────────────────────────────────────

// DeleteConfig removes the SSO configuration for an org, which implicitly
// re-enables local login (since local_login_disabled only applies when a
// config row exists). Returns an error if no config exists.
func (s *Service) DeleteConfig(ctx context.Context, orgID uuid.UUID) error {
	result, err := s.db.Exec(ctx,
		`DELETE FROM sso_configs WHERE org_id = $1`, orgID,
	)
	if err != nil {
		return fmt.Errorf("delete sso config: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("no SSO configuration found for this organisation")
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────

// GetConfigByOrgSlug looks up an org by its URL slug, then returns its SSO
// config. Used by the SAML/OIDC handler paths whose URLs include :org_slug.
func (s *Service) GetConfigByOrgSlug(ctx context.Context, slug string) (*models.SSOConfig, *models.Organisation, error) {
	var org models.Organisation
	err := s.db.QueryRow(ctx,
		`SELECT id, name, slug, is_active FROM organisations WHERE slug = $1 AND deleted_at IS NULL`,
		slug,
	).Scan(&org.ID, &org.Name, &org.Slug, &org.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil, fmt.Errorf("organisation not found")
	}
	if err != nil {
		return nil, nil, fmt.Errorf("lookup org: %w", err)
	}
	if !org.IsActive {
		return nil, nil, fmt.Errorf("organisation is inactive")
	}

	cfg, err := s.GetConfig(ctx, org.ID)
	if err != nil {
		return nil, nil, err
	}
	if cfg == nil {
		return nil, nil, fmt.Errorf("SSO is not configured for this organisation")
	}
	return cfg, &org, nil
}

func validateUpsert(req UpsertSSORequest) error {
	switch req.Protocol {
	case models.SSOSaml:
		// At minimum, either a metadata URL or a certificate+entity_id pair is needed.
		if req.MetadataURL == nil && (req.Certificate == nil || req.EntityID == nil) {
			return fmt.Errorf("SAML configuration requires either metadata_url or both entity_id and certificate")
		}
	case models.SSOOidc:
		if req.ClientID == nil || req.ClientSecret == nil || req.DiscoveryURL == nil {
			return fmt.Errorf("OIDC configuration requires client_id, client_secret, and discovery_url")
		}
	default:
		return fmt.Errorf("protocol must be 'saml' or 'oidc'")
	}
	return nil
}
