// Command server is the StratPlan API entry point.
//
// Start-up sequence:
//  1. Configure structured JSON logging (REQ-NF-056).
//  2. Load config from environment / .env file.
//  3. Run database migrations automatically (REQ-NF-052/053).
//  4. Connect to PostgreSQL.
//  5. Build the HTTP router (all services and handlers are constructed here).
//  6. Listen on the configured port.
//  7. On SIGINT/SIGTERM, drain in-flight requests gracefully (10 s deadline).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"spe-light/internal/config"
	"spe-light/internal/database"
	"spe-light/internal/handlers"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	// ── Structured JSON logging (REQ-NF-056) ──────────────────────────
	// The default slog handler emits human-readable text, which is
	// convenient locally but machine-unfriendly in any log aggregator
	// (Loki, Datadog, CloudWatch, etc.). Swap it for JSON before anything
	// else so every log line — including startup errors — is structured.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	// ── Config ────────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "err", err)
		os.Exit(1)
	}

	// ── Migrations (REQ-NF-052/053) ───────────────────────────────────
	// Run pending migrations automatically on startup so the schema is
	// always in sync with the binary without a manual CLI step.
	// Migration files are expected at ./migrations/ relative to the CWD
	// (i.e. the repo root when running `go run` or where the binary is
	// placed by the Makefile / Docker image).
	if err := runMigrations(cfg.DatabaseURL); err != nil {
		slog.Error("run migrations", "err", err)
		os.Exit(1)
	}

	// ── Database ──────────────────────────────────────────────────────
	ctx := context.Background()
	db, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connect to database", "err", err)
		os.Exit(1)
	}
	defer db.Close()
	slog.Info("database connected")

	// ── HTTP server ───────────────────────────────────────────────────
	router := handlers.NewRouter(cfg, db)
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start in background so we can listen for signals.
	go func() {
		slog.Info("server starting", "addr", srv.Addr, "env", cfg.AppEnv)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	// ── Graceful shutdown ─────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down — draining requests (10 s)")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
	}
	slog.Info("server stopped")
}

// runMigrations applies all pending up-migrations using golang-migrate.
// ErrNoChange is silently ignored — it means the schema is already current.
// Any other error is fatal so we never start with a mismatched schema.
func runMigrations(databaseURL string) error {
	m, err := migrate.New("file://migrations", databaseURL)
	if err != nil {
		return fmt.Errorf("initialise migrator: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply migrations: %w", err)
	}

	version, dirty, _ := m.Version()
	slog.Info("migrations up to date", "schema_version", version, "dirty", dirty)
	return nil
}
