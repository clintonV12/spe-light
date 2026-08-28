package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	// Server
	Port   string
	AppEnv string
	AppURL string

	// FrontendURL is the SPA's public base URL. Every link the backend emails
	// out (invite accept, password reset, SSO post-login redirect) must point
	// here, not at AppURL — AppURL is the API's own address (e.g.
	// localhost:8080), which nothing renders a page at. Separated from AppURL
	// so dev (frontend on :5173, API on :8080) and prod (often same origin
	// behind a reverse proxy) both work by changing one env var.
	FrontendURL string

	// Database
	DatabaseURL string

	// JWT
	JWTSecret            string
	JWTAccessExpiryMin   int
	JWTRefreshExpiryDays int

	// SessionIdleTimeoutMin is how many minutes a session can go without any
	// request before it's force-expired, independent of the refresh token's
	// own 30-day absolute expiry (JWTRefreshExpiryDays). Enforced in
	// authsvc.Service.RefreshToken via refresh_tokens.last_used_at (see
	// migration 016_refresh_token_activity) — every refresh call updates
	// last_used_at, and a refresh attempt where too much time has passed
	// since the last one is rejected outright rather than rotated.
	//
	// IMPORTANT: this can only catch idle time that spans at least one
	// access-token refresh cycle — while the access token is still valid, no
	// refresh call happens at all, so the backend has no signal either way.
	// Keep JWTAccessExpiryMin <= SessionIdleTimeoutMin (ideally equal) or
	// the effective idle bound is capped at JWTAccessExpiryMin regardless of
	// this value — see the warning Load() prints if that's misconfigured.
	SessionIdleTimeoutMin int

	// Ollama
	OllamaURL   string
	OllamaModel string

	// Overdue notifier — see internal/jobs/overdue_notifier.go. Runs as a
	// background ticker started from main.go, not per-request, so it has no
	// natural place among the HTTP-request-shaped config above.
	OverdueScanInterval   time.Duration // how often to scan for newly-overdue activities
	OverdueNotifyCooldown time.Duration // don't re-email the same person about the same activity more often than this

	// SMTP
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string

	// Logging
	LogFilePath string
}

// Load reads .env (if present) then environment variables. Shell env takes priority.
func Load() (*Config, error) {
	// Best-effort — not an error if .env doesn't exist.
	_ = godotenv.Load()

	cfg := &Config{
		Port:         getEnv("PORT", "8080"),
		AppEnv:       getEnv("APP_ENV", "development"),
		AppURL:       getEnv("APP_URL", "http://localhost:8080"),
		FrontendURL:  getEnv("FRONTEND_URL", "http://localhost:5173"),
		DatabaseURL:  getEnv("DATABASE_URL", "postgres://stratplan:stratplan@localhost:5432/stratplan?sslmode=disable"),
		OllamaURL:    getEnv("OLLAMA_URL", "http://localhost:11434"),
		OllamaModel:  getEnv("OLLAMA_MODEL", "llama3"),
		SMTPHost:     getEnv("SMTP_HOST", "localhost"),
		SMTPFrom:     getEnv("SMTP_FROM", "noreply@stratplan.local"),
		SMTPUser:     getEnv("SMTP_USER", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
		LogFilePath:  getEnv("LOG_FILE_PATH", "logs/stratplan.log"),
	}

	// Required fields.
	cfg.JWTSecret = os.Getenv("JWT_SECRET")
	if cfg.JWTSecret == "" {
		if cfg.AppEnv == "production" {
			return nil, fmt.Errorf("JWT_SECRET must be set in production")
		}
		// Dev fallback — warn loudly.
		cfg.JWTSecret = "dev-secret-change-before-deploying-32chars!!"
		fmt.Fprintln(os.Stderr, "WARNING: JWT_SECRET not set; using insecure dev default")
	}
	if len(cfg.JWTSecret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}

	var err error
	cfg.JWTAccessExpiryMin, err = getEnvInt("JWT_ACCESS_EXPIRY_MIN", 15)
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_ACCESS_EXPIRY_MIN: %w", err)
	}

	cfg.JWTRefreshExpiryDays, err = getEnvInt("JWT_REFRESH_EXPIRY_DAYS", 30)
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_REFRESH_EXPIRY_DAYS: %w", err)
	}

	// Default 45 min — 3x the default JWT_ACCESS_EXPIRY_MIN (15m), enough
	// margin that a genuinely active user's refresh (which only happens
	// reactively, once per access-token cycle — see client.ts) never lands
	// past the idle budget purely from normal request latency. See the
	// JWTAccessExpiryMin/SessionIdleTimeoutMin comparison below for what
	// goes wrong with too little (or no) margin here.
	cfg.SessionIdleTimeoutMin, err = getEnvInt("SESSION_IDLE_TIMEOUT_MIN", 45)
	if err != nil {
		return nil, fmt.Errorf("invalid SESSION_IDLE_TIMEOUT_MIN: %w", err)
	}
	if cfg.SessionIdleTimeoutMin <= 0 {
		return nil, fmt.Errorf("SESSION_IDLE_TIMEOUT_MIN must be a positive number of minutes")
	}
	if cfg.JWTAccessExpiryMin >= cfg.SessionIdleTimeoutMin {
		fmt.Fprintf(os.Stderr,
			"WARNING: JWT_ACCESS_EXPIRY_MIN (%dm) is >= SESSION_IDLE_TIMEOUT_MIN (%dm) — "+
				"idle sessions can only be caught once the access token itself expires, and "+
				"authsvc.Service.RefreshToken's idle check runs at that exact moment. With no "+
				"margin between the two values, idleFor is guaranteed to already exceed the idle "+
				"budget on the very first refresh after login, logging every user out on a fixed "+
				"schedule regardless of activity — not just truly-idle ones. Set "+
				"SESSION_IDLE_TIMEOUT_MIN comfortably above JWT_ACCESS_EXPIRY_MIN (at least 2-3x, "+
				"e.g. %dm here) to leave room for normal request latency and the client's own "+
				"refresh timing\n",
			cfg.JWTAccessExpiryMin, cfg.SessionIdleTimeoutMin, cfg.JWTAccessExpiryMin*3)
	}

	cfg.SMTPPort, err = getEnvInt("SMTP_PORT", 587)
	if err != nil {
		return nil, fmt.Errorf("invalid SMTP_PORT: %w", err)
	}

	// Default: scan every 30 minutes, don't re-notify the same person about
	// the same overdue activity more than once every 24 hours.
	cfg.OverdueScanInterval, err = getEnvDuration("OVERDUE_SCAN_INTERVAL", 30*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("invalid OVERDUE_SCAN_INTERVAL: %w", err)
	}
	cfg.OverdueNotifyCooldown, err = getEnvDuration("OVERDUE_NOTIFY_COOLDOWN", 24*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("invalid OVERDUE_NOTIFY_COOLDOWN: %w", err)
	}

	return cfg, nil
}

func (c *Config) IsProduction() bool {
	return c.AppEnv == "production"
}

func (c *Config) JWTAccessExpiry() time.Duration {
	return time.Duration(c.JWTAccessExpiryMin) * time.Minute
}

func (c *Config) JWTRefreshExpiry() time.Duration {
	return time.Duration(c.JWTRefreshExpiryDays) * 24 * time.Hour
}

// SessionIdleTimeout is how long a session may go without a refresh call
// before authsvc.Service.RefreshToken rejects it as idle. See
// SessionIdleTimeoutMin's doc comment for the access-token-cycle caveat.
func (c *Config) SessionIdleTimeout() time.Duration {
	return time.Duration(c.SessionIdleTimeoutMin) * time.Minute
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	return strconv.Atoi(v)
}

// getEnvDuration parses a Go duration string (e.g. "30m", "24h"). Empty/unset
// falls back to the given default.
func getEnvDuration(key string, fallback time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	return time.ParseDuration(v)
}
