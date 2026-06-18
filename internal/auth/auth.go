// Package auth provides the low-level security primitives used across
// StratPlan: password hashing, JWT issuance/parsing, opaque token generation,
// and HMAC link signing.
//
// This package has no knowledge of HTTP or the database — it is pure crypto
// and token logic, which makes it easy to unit test in isolation.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"spe-light/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// ─── Password ────────────────────────────────────────────────────────────────

// HashPassword hashes a plaintext password with bcrypt (cost=12).
func HashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", fmt.Errorf("password must be at least 8 characters")
	}
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(b), nil
}

// CheckPassword returns nil if password matches the stored hash.
func CheckPassword(password, hash string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

type jwtClaims struct {
	jwt.RegisteredClaims
	UserID string  `json:"user_id"`
	OrgID  *string `json:"org_id,omitempty"`
	Role   string  `json:"role"`
	Email  string  `json:"email"`
}

// IssueAccessToken creates a signed JWT access token.
func IssueAccessToken(secret string, expiry time.Duration, claims models.TokenClaims) (string, error) {
	now := time.Now()
	var orgIDStr *string
	if claims.OrgID != nil {
		s := claims.OrgID.String()
		orgIDStr = &s
	}
	c := jwtClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   claims.UserID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
		UserID: claims.UserID.String(),
		OrgID:  orgIDStr,
		Role:   string(claims.Role),
		Email:  claims.Email,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString([]byte(secret))
}

// ParseAccessToken validates a JWT and returns the embedded claims.
func ParseAccessToken(secret, tokenStr string) (*models.TokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &jwtClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	c, ok := token.Claims.(*jwtClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	userID, err := uuid.Parse(c.UserID)
	if err != nil {
		return nil, fmt.Errorf("invalid user_id in token: %w", err)
	}

	claims := &models.TokenClaims{
		UserID: userID,
		Role:   models.Role(c.Role),
		Email:  c.Email,
	}
	if c.OrgID != nil {
		id, err := uuid.Parse(*c.OrgID)
		if err != nil {
			return nil, fmt.Errorf("invalid org_id in token: %w", err)
		}
		claims.OrgID = &id
	}

	return claims, nil
}

// ─── Refresh tokens ──────────────────────────────────────────────────────────

// GenerateRefreshToken returns a cryptographically random opaque token string
// and its SHA-256 hash (stored in the DB; plaintext returned to the client).
func GenerateRefreshToken() (plaintext, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate refresh token: %w", err)
	}
	plaintext = hex.EncodeToString(b)
	hash = HashToken(plaintext)
	return plaintext, hash, nil
}

// ─── Invitation & password-reset tokens ──────────────────────────────────────

// GenerateInviteToken returns a cryptographically random token (≥32 bytes)
// and its SHA-256 hash for safe storage.
func GenerateInviteToken() (plaintext, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate invite token: %w", err)
	}
	plaintext = hex.EncodeToString(b)
	hash = HashToken(plaintext)
	return plaintext, hash, nil
}

// HashToken returns the SHA-256 hex digest of a token plaintext.
// This is stored in the database; the plaintext is sent to the user.
func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// ─── HMAC link signing ────────────────────────────────────────────────────────

// SignLink returns an HMAC-SHA256 hex signature for a URL payload.
// Include the token (or full link path) as the message.
func SignLink(secret, message string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyLink checks that the provided signature matches the expected HMAC.
func VerifyLink(secret, message, sig string) bool {
	expected := SignLink(secret, message)
	return hmac.Equal([]byte(expected), []byte(sig))
}
