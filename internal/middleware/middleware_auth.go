// Package middleware provides HTTP middleware for StratPlan.
//
// Middleware provided:
//   - Authenticate: validates Bearer JWT and injects TokenClaims into context.
//   - RequireRole: rejects requests whose token role is not in the allowed set.
//   - RateLimit: simple in-memory per-IP rate limiter (used on /auth/login).
//
// Context key design: a private contextKey type prevents collisions with
// third-party middleware that might use plain strings as context keys.
package middleware

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"spe-light/internal/auth"
	"spe-light/internal/models"
	"spe-light/internal/response"
)

// ── Context key ───────────────────────────────────────────────────────────

type contextKey string

const claimsKey contextKey = "claims"

// Claims is an alias so handlers can reference the type without importing middleware
// as a dependency (avoiding import cycles). It mirrors models.TokenClaims exactly.
type Claims = models.TokenClaims

// ── Authenticate ──────────────────────────────────────────────────────────

// Authenticate validates the Bearer JWT and injects *models.TokenClaims into
// the request context. Requests without a valid token receive 401.
func Authenticate(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				response.ErrorJSON(w, "missing or invalid authorization header", http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimPrefix(header, "Bearer ")
			claims, err := auth.ParseAccessToken(jwtSecret, tokenStr)
			if err != nil {
				response.ErrorJSON(w, "invalid or expired token", http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ── RequireRole ───────────────────────────────────────────────────────────

// RequireRole rejects requests whose token role is not in the allowed set.
// Must be used after Authenticate in the middleware chain.
func RequireRole(roles ...models.Role) func(http.Handler) http.Handler {
	allowed := make(map[models.Role]struct{}, len(roles))
	for _, r := range roles {
		allowed[r] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := ClaimsFrom(r.Context())
			if claims == nil {
				response.ErrorJSON(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if _, ok := allowed[claims.Role]; !ok {
				response.ErrorJSON(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ── ClaimsFrom ────────────────────────────────────────────────────────────

// ClaimsFrom extracts *models.TokenClaims from the context set by Authenticate.
// Returns nil if the context has no claims (unauthenticated request).
func ClaimsFrom(ctx context.Context) *models.TokenClaims {
	c, _ := ctx.Value(claimsKey).(*models.TokenClaims)
	return c
}

// ── RateLimit ─────────────────────────────────────────────────────────────

// rateLimitEntry tracks request counts within a sliding window.
type rateLimitEntry struct {
	mu       sync.Mutex
	requests []time.Time
}

// rateLimiter is an in-process per-key rate limiter.
// For multi-instance deployments, replace with a Redis-backed implementation.
type rateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateLimitEntry
	max     int
	window  time.Duration
}

var loginLimiter = &rateLimiter{
	entries: make(map[string]*rateLimitEntry),
	max:     10,              // 10 attempts …
	window:  5 * time.Minute, // … per 5-minute window per IP
}

// RateLimit is a per-IP rate limiter intended for the /auth/login endpoint.
// It allows up to max requests per window per remote IP. Excess requests
// receive 429 Too Many Requests.
//
// Note: this is an in-memory implementation suitable for single-instance
// deployments. For multi-instance or high-traffic deployments, replace the
// rateLimiter backing store with Redis and use INCR + EXPIRE.
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := realIP(r)
		if loginLimiter.isLimited(ip) {
			response.ErrorJSON(w, "too many requests — please try again later", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isLimited returns true if the key has exceeded the rate limit.
func (l *rateLimiter) isLimited(key string) bool {
	l.mu.Lock()
	e, ok := l.entries[key]
	if !ok {
		e = &rateLimitEntry{}
		l.entries[key] = e
	}
	l.mu.Unlock()

	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.window)

	// Prune expired entries.
	valid := e.requests[:0]
	for _, t := range e.requests {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	e.requests = valid

	if len(e.requests) >= l.max {
		return true
	}
	e.requests = append(e.requests, now)
	return false
}

// realIP extracts the client IP from X-Real-IP, X-Forwarded-For, or RemoteAddr.
func realIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		// X-Forwarded-For may be a comma-separated list; the first is the client.
		if idx := strings.Index(fwd, ","); idx != -1 {
			return strings.TrimSpace(fwd[:idx])
		}
		return strings.TrimSpace(fwd)
	}
	// Fall back to RemoteAddr, stripping the port.
	if idx := strings.LastIndex(r.RemoteAddr, ":"); idx != -1 {
		return r.RemoteAddr[:idx]
	}
	return r.RemoteAddr
}
