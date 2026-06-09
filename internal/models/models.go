package models

import (
	"time"

	"github.com/google/uuid"
)

// ─── Enums ───────────────────────────────────────────────────────────────────

type Role string

const (
	RoleSuperAdmin      Role = "super_admin"
	RolePlatformSupport Role = "platform_support"
	RoleOrgAdmin        Role = "org_admin"
	RolePlanner         Role = "planner"
	RoleContributor     Role = "contributor"
	RoleViewer          Role = "viewer"
)

func (r Role) IsValid() bool {
	switch r {
	case RoleSuperAdmin, RolePlatformSupport, RoleOrgAdmin, RolePlanner, RoleContributor, RoleViewer:
		return true
	}
	return false
}

// IsPlatformRole returns true for cross-org platform-tier roles.
func (r Role) IsPlatformRole() bool {
	return r == RoleSuperAdmin || r == RolePlatformSupport
}

// IsOrgRole returns true for organisation-scoped roles.
func (r Role) IsOrgRole() bool {
	return r == RoleOrgAdmin || r == RolePlanner || r == RoleContributor || r == RoleViewer
}

// ─── Role ordering (higher index = more permissions) ─────────────────────────

var orgRoleOrder = map[Role]int{
	RoleViewer:      0,
	RoleContributor: 1,
	RolePlanner:     2,
	RoleOrgAdmin:    3,
}

// AtLeast returns true if r has at least the same permissions as min.
func (r Role) AtLeast(min Role) bool {
	if r == RoleSuperAdmin || r == RolePlatformSupport {
		return true
	}
	ri, ok1 := orgRoleOrder[r]
	mi, ok2 := orgRoleOrder[min]
	if !ok1 || !ok2 {
		return false
	}
	return ri >= mi
}

type InvitationStatus string

const (
	InvitationPending   InvitationStatus = "pending"
	InvitationAccepted  InvitationStatus = "accepted"
	InvitationCancelled InvitationStatus = "cancelled"
	InvitationExpired   InvitationStatus = "expired"
)

type SSOProtocol string

const (
	SSOProtocolSAML SSOProtocol = "saml"
	SSOProtocolOIDC SSOProtocol = "oidc"
)

type PlanStatus string

const (
	PlanDraft     PlanStatus = "draft"
	PlanActive    PlanStatus = "active"
	PlanReview    PlanStatus = "review"
	PlanCompleted PlanStatus = "completed"
	PlanArchived  PlanStatus = "archived"
)

type ActivityPhase string

const (
	PhaseP1 ActivityPhase = "P1"
	PhaseP2 ActivityPhase = "P2"
	PhaseP3 ActivityPhase = "P3"
)

type ActivityStatus string

const (
	ActivityNotStarted  ActivityStatus = "not_started"
	ActivityInProgress  ActivityStatus = "in_progress"
	ActivityUnderReview ActivityStatus = "under_review"
	ActivityComplete    ActivityStatus = "complete"
)

type LinkType string

const (
	LinkAuto        LinkType = "auto"
	LinkManual      LinkType = "manual"
	LinkAISuggested LinkType = "ai_suggested"
)

type NotificationChannel string

const (
	ChannelEmail NotificationChannel = "email"
	ChannelInApp NotificationChannel = "in_app"
)

// ─── Core entities ───────────────────────────────────────────────────────────

type Organisation struct {
	ID        uuid.UUID `db:"id"          json:"id"`
	Name      string    `db:"name"         json:"name"`
	Slug      string    `db:"slug"         json:"slug"`
	LogoURL   *string   `db:"logo_url"     json:"logo_url,omitempty"`
	Locale    string    `db:"locale"       json:"locale"`
	Industry  *string   `db:"industry"     json:"industry,omitempty"`
	IsActive  bool      `db:"is_active"    json:"is_active"`
	CreatedAt time.Time `db:"created_at"   json:"created_at"`
	UpdatedAt time.Time `db:"updated_at"   json:"updated_at"`
}

type User struct {
	ID           uuid.UUID  `db:"id"             json:"id"`
	OrgID        *uuid.UUID `db:"org_id"         json:"org_id,omitempty"` // nil for super_admin / platform_support
	Email        string     `db:"email"          json:"email"`
	PasswordHash *string    `db:"password_hash"  json:"-"`
	Role         Role       `db:"role"           json:"role"`
	Name         string     `db:"name"           json:"name"`
	Locale       *string    `db:"locale"         json:"locale,omitempty"`
	IsActive     bool       `db:"is_active"      json:"is_active"`
	SSOSubject   *string    `db:"sso_subject"    json:"-"`
	CreatedAt    time.Time  `db:"created_at"     json:"created_at"`
	UpdatedAt    time.Time  `db:"updated_at"     json:"updated_at"`
}

type SSOConfig struct {
	ID                 uuid.UUID   `db:"id"                    json:"id"`
	OrgID              uuid.UUID   `db:"org_id"                json:"org_id"`
	Protocol           SSOProtocol `db:"protocol"              json:"protocol"`
	MetadataURL        *string     `db:"metadata_url"          json:"metadata_url,omitempty"`
	EntityID           *string     `db:"entity_id"             json:"entity_id,omitempty"`
	Cert               *string     `db:"cert"                  json:"-"`
	ClientID           *string     `db:"client_id"             json:"client_id,omitempty"`
	ClientSecret       *string     `db:"client_secret"         json:"-"`
	DiscoveryURL       *string     `db:"discovery_url"         json:"discovery_url,omitempty"`
	DefaultRole        Role        `db:"default_role"          json:"default_role"`
	JITEnabled         bool        `db:"jit_enabled"           json:"jit_enabled"`
	LocalLoginDisabled bool        `db:"local_login_disabled"  json:"local_login_disabled"`
	CreatedAt          time.Time   `db:"created_at"            json:"created_at"`
	UpdatedAt          time.Time   `db:"updated_at"            json:"updated_at"`
}

type Invitation struct {
	ID         uuid.UUID        `db:"id"           json:"id"`
	OrgID      *uuid.UUID       `db:"org_id"       json:"org_id,omitempty"`
	Email      string           `db:"email"        json:"email"`
	Role       Role             `db:"role"         json:"role"`
	TokenHash  string           `db:"token_hash"   json:"-"`
	InvitedBy  uuid.UUID        `db:"invited_by"   json:"invited_by"`
	ExpiresAt  time.Time        `db:"expires_at"   json:"expires_at"`
	AcceptedAt *time.Time       `db:"accepted_at"  json:"accepted_at,omitempty"`
	Status     InvitationStatus `db:"status"       json:"status"`
	PlanIDs    []uuid.UUID      `db:"plan_ids"     json:"plan_ids,omitempty"` // jsonb
	CreatedAt  time.Time        `db:"created_at"   json:"created_at"`
	UpdatedAt  time.Time        `db:"updated_at"   json:"updated_at"`
}

type RefreshToken struct {
	ID        uuid.UUID  `db:"id"         json:"id"`
	UserID    uuid.UUID  `db:"user_id"    json:"-"`
	TokenHash string     `db:"token_hash" json:"-"`
	ExpiresAt time.Time  `db:"expires_at" json:"expires_at"`
	RevokedAt *time.Time `db:"revoked_at" json:"-"`
	CreatedAt time.Time  `db:"created_at" json:"created_at"`
}

type Plan struct {
	ID          uuid.UUID  `db:"id"          json:"id"`
	OrgID       uuid.UUID  `db:"org_id"       json:"org_id"`
	Title       string     `db:"title"        json:"title"`
	Description *string    `db:"description"  json:"description,omitempty"`
	Status      PlanStatus `db:"status"       json:"status"`
	OwnerID     uuid.UUID  `db:"owner_id"     json:"owner_id"`
	StartDate   *time.Time `db:"start_date"   json:"start_date,omitempty"`
	EndDate     *time.Time `db:"end_date"     json:"end_date,omitempty"`
	CreatedAt   time.Time  `db:"created_at"   json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at"   json:"updated_at"`
	DeletedAt   *time.Time `db:"deleted_at"   json:"deleted_at,omitempty"`
}

type Activity struct {
	ID         uuid.UUID      `db:"id"          json:"id"`
	PlanID     uuid.UUID      `db:"plan_id"     json:"plan_id"`
	OrgID      uuid.UUID      `db:"org_id"      json:"org_id"`
	Phase      ActivityPhase  `db:"phase"       json:"phase"`
	Type       string         `db:"type"        json:"type"`
	Title      string         `db:"title"       json:"title"`
	UserOrder  int            `db:"user_order"  json:"user_order"`
	Status     ActivityStatus `db:"status"      json:"status"`
	Content    []byte         `db:"content"     json:"content"`  // jsonb
	AIDraft    []byte         `db:"ai_draft"    json:"ai_draft"` // jsonb
	AssignedTo *uuid.UUID     `db:"assigned_to" json:"assigned_to,omitempty"`
	DueDate    *time.Time     `db:"due_date"    json:"due_date,omitempty"`
	CreatedAt  time.Time      `db:"created_at"  json:"created_at"`
	UpdatedAt  time.Time      `db:"updated_at"  json:"updated_at"`
}

type ActivityLink struct {
	ID        uuid.UUID `db:"id"         json:"id"`
	PlanID    uuid.UUID `db:"plan_id"    json:"plan_id"`
	SourceID  uuid.UUID `db:"source_id"  json:"source_id"`
	TargetID  uuid.UUID `db:"target_id"  json:"target_id"`
	LinkType  LinkType  `db:"link_type"  json:"link_type"`
	CreatedBy uuid.UUID `db:"created_by" json:"created_by"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type AuditLog struct {
	ID        uuid.UUID  `db:"id"          json:"id"`
	OrgID     *uuid.UUID `db:"org_id"      json:"org_id,omitempty"`
	UserID    uuid.UUID  `db:"user_id"     json:"user_id"`
	Action    string     `db:"action"      json:"action"`
	TableName string     `db:"table_name"  json:"table_name"`
	RecordID  uuid.UUID  `db:"record_id"   json:"record_id"`
	Diff      []byte     `db:"diff"        json:"diff"` // jsonb
	CreatedAt time.Time  `db:"created_at"  json:"created_at"`
}

type NotificationLog struct {
	ID        uuid.UUID           `db:"id"        json:"id"`
	OrgID     *uuid.UUID          `db:"org_id"    json:"org_id,omitempty"`
	UserID    uuid.UUID           `db:"user_id"   json:"user_id"`
	Type      string              `db:"type"      json:"type"`
	Channel   NotificationChannel `db:"channel"   json:"channel"`
	Payload   []byte              `db:"payload"   json:"payload"` // jsonb
	SentAt    *time.Time          `db:"sent_at"   json:"sent_at,omitempty"`
	Status    string              `db:"status"    json:"status"`
	CreatedAt time.Time           `db:"created_at" json:"created_at"`
}

// ─── Request / Response DTOs ─────────────────────────────────────────────────

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         *User  `json:"user"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type RefreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

type AcceptInviteRequest struct {
	Token    string `json:"token"`
	Name     string `json:"name"`
	Password string `json:"password"`
	// For platform org invite, also set org profile:
	OrgName     *string `json:"org_name,omitempty"`
	OrgIndustry *string `json:"org_industry,omitempty"`
	OrgLocale   *string `json:"org_locale,omitempty"`
}

type SendInviteRequest struct {
	Email   string      `json:"email"`
	Role    Role        `json:"role"`
	PlanIDs []uuid.UUID `json:"plan_ids,omitempty"` // for plan-scoped viewer
}

type SendOrgInviteRequest struct {
	Email   string `json:"email"`
	OrgName string `json:"org_name"` // pre-filled suggestion
}

type UpdateUserRequest struct {
	Role     *Role `json:"role,omitempty"`
	IsActive *bool `json:"is_active,omitempty"`
}

type PasswordResetRequest struct {
	Email string `json:"email"`
}

type PasswordResetConfirmRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

// Claims embedded in JWT access tokens.
type TokenClaims struct {
	UserID uuid.UUID  `json:"user_id"`
	OrgID  *uuid.UUID `json:"org_id"`
	Role   Role       `json:"role"`
	Email  string     `json:"email"`
}
