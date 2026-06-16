// Command server is the StratPlan API entry point.
//
// Start-up sequence:
//  1. Load config from environment / .env file.
//  2. Connect to PostgreSQL.
//  3. Build the HTTP router (all services and handlers are constructed here).
//  4. Listen on the configured port.
//  5. On SIGINT/SIGTERM, drain in-flight requests gracefully (10 s deadline).
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
)

func main() {
	// ── Config ────────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "err", err)
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
