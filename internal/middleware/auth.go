package middleware

import (
	"context"
	"net/http"
	"strings"

	"spe-light/internal/auth"
	"spe-light/internal/models"
	"spe-light/internal/response"
)

type contextKey string

const claimsKey contextKey = "claims"

// Authenticate validates the Bearer JWT and injects TokenClaims into ctx.
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

// RequireRole rejects requests from tokens whose role is not in the allowed set.
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

// ClaimsFrom extracts TokenClaims from the context set by Authenticate.
func ClaimsFrom(ctx context.Context) *models.TokenClaims {
	c, _ := ctx.Value(claimsKey).(*models.TokenClaims)
	return c
}
