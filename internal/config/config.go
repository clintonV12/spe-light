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

	// Database
	DatabaseURL string

	// JWT
	JWTSecret            string
	JWTAccessExpiryMin   int
	JWTRefreshExpiryDays int

	// Ollama
	OllamaURL   string
	OllamaModel string

	// SMTP
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string
}

// Load reads .env (if present) then environment variables. Shell env takes priority.
func Load() (*Config, error) {
	// Best-effort — not an error if .env doesn't exist.
	_ = godotenv.Load()

	cfg := &Config{
		Port:         getEnv("PORT", "8080"),
		AppEnv:       getEnv("APP_ENV", "development"),
		AppURL:       getEnv("APP_URL", "http://localhost:8080"),
		DatabaseURL:  getEnv("DATABASE_URL", "postgres://stratplan:stratplan@localhost:5432/stratplan?sslmode=disable"),
		OllamaURL:    getEnv("OLLAMA_URL", "http://localhost:11434"),
		OllamaModel:  getEnv("OLLAMA_MODEL", "llama3"),
		SMTPHost:     getEnv("SMTP_HOST", "localhost"),
		SMTPFrom:     getEnv("SMTP_FROM", "noreply@stratplan.local"),
		SMTPUser:     getEnv("SMTP_USER", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
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

	cfg.SMTPPort, err = getEnvInt("SMTP_PORT", 587)
	if err != nil {
		return nil, fmt.Errorf("invalid SMTP_PORT: %w", err)
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
