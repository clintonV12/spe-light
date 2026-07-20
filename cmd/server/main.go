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
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"spe-light/internal/config"
	"spe-light/internal/database"
	"spe-light/internal/email"
	"spe-light/internal/handlers"
	"spe-light/internal/jobs"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	// ── Structured JSON logging (REQ-NF-056) ──────────────────────────
	// Bootstrap with a stdout-only JSON handler first, since config.Load()
	// itself can fail and we want that error logged somewhere before we
	// know the configured log file path.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	// ── Config ────────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "err", err)
		os.Exit(1)
	}

	// Upgrade logging to stdout+file now that we know LOG_FILE_PATH. This is
	// what makes errors (failed emails, failed migrations, panics, etc.)
	// traceable after the fact instead of only visible in a live stdout
	// stream. A logging misconfiguration is never fatal — if the file can't
	// be opened we fall back to stdout-only and say why.
	//
	// Note: this appends indefinitely and does not rotate. Pair it with an
	// OS-level tool like logrotate (copytruncate mode works fine against an
	// append-only file handle) for long-running production deployments.
	logFile, err := setupFileLogging(cfg.LogFilePath)
	if err != nil {
		slog.Warn("could not open log file — logging to stdout only", "path", cfg.LogFilePath, "err", err)
	} else {
		defer logFile.Close()
		slog.Info("file logging enabled", "path", cfg.LogFilePath)
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
	// NewRouter can fail now — most notably if the email service's
	// templates fail to parse. Previously that error was silently
	// discarded, which meant the server would boot fine and then panic
	// on the first invite/reset/notification email with no clear cause
	// in the logs. Failing fast here surfaces it immediately at startup.
	router, err := handlers.NewRouter(cfg, db)
	if err != nil {
		slog.Error("build router", "err", err)
		os.Exit(1)
	}
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// ── Background jobs ───────────────────────────────────────────────
	// No separate worker binary or job queue in this codebase — background
	// work runs as plain goroutines started here. OverdueNotifier needs its
	// own email.Service instance since handlers.NewRouter builds one
	// internally without exposing it; constructing a second one is cheap
	// (it only parses the same templates once) and the two are otherwise
	// fully independent/stateless, so there's no shared-state concern.
	notifyEmailSvc, err := email.New(cfg, db)
	if err != nil {
		// Same failure mode NewRouter already guarded against (bad template
		// parse) — if it were going to happen, NewRouter above would have
		// already caught it, but check here too rather than assume.
		slog.Error("init overdue notifier email service", "err", err)
		os.Exit(1)
	}
	overdueNotifier := jobs.NewOverdueNotifier(db, notifyEmailSvc, cfg.OverdueScanInterval, cfg.OverdueNotifyCooldown)
	notifyCtx, cancelNotify := context.WithCancel(context.Background())
	go overdueNotifier.Run(notifyCtx)

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
	cancelNotify() // stop the overdue notifier's ticker loop — no in-flight work to drain, a plain cancel is enough
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

// setupFileLogging reconfigures the default slog logger to write structured
// JSON to both stdout and a log file (REQ-NF-056), creating the parent
// directory if it doesn't exist yet. Returns the open file handle so main
// can close it on shutdown, or an error if the path is empty or the file
// couldn't be opened — callers should treat that as non-fatal and continue
// with stdout-only logging.
func setupFileLogging(path string) (*os.File, error) {
	if path == "" {
		return nil, fmt.Errorf("no log file path configured")
	}
	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create log directory: %w", err)
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}
	writer := io.MultiWriter(os.Stdout, f)
	slog.SetDefault(slog.New(slog.NewJSONHandler(writer, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))
	return f, nil
}
