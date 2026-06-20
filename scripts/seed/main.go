// Command seed creates a local super_admin user for development.
//
// Run with:
//
//	make seed
//	go run ./cmd/seed/main.go
//
// The seed is safe to run more than once — it upserts on email, so running it
// again after a password change just refreshes the hash.
//
// Migration 003 note: super_admin and platform_support are platform-tier roles
// with org_id = NULL (per migration 003 and models.Role.IsPlatformRole()). The
// seed no longer creates a dummy "Platform Admin" org or assigns one to the
// super_admin user. The partial unique index on (email) WHERE org_id IS NULL
// from migration 003 covers uniqueness for platform-tier accounts.
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"spe-light/internal/auth"
	"spe-light/internal/config"
	"spe-light/internal/database"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()
	db, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal("connect db:", err)
	}
	defer db.Close()

	email := getEnv("SEED_EMAIL", "admin@stratplan.local")
	password := getEnv("SEED_PASSWORD", "Admin1234!")

	hash, err := auth.HashPassword(password)
	if err != nil {
		log.Fatal("hash password:", err)
	}

	// Insert super_admin with org_id = NULL (platform-tier, per migration 003).
	// ON CONFLICT targets the partial unique index uq_users_platform_email
	// (email WHERE org_id IS NULL), which is the correct conflict target for
	// platform-tier users after migration 003.
	//
	// We cannot use ON CONFLICT (org_id, email) here because org_id IS NULL
	// and NULL is never equal to NULL in SQL uniqueness checks — that constraint
	// would never fire for platform-tier users.
	var userID uuid.UUID
	err = db.QueryRow(ctx,
		`INSERT INTO users (id, org_id, email, password_hash, name, role, locale, is_active)
		 VALUES ($1, NULL, $2, $3, 'Super Admin', 'super_admin', 'en', true)
		 ON CONFLICT (email) WHERE org_id IS NULL
		 DO UPDATE SET password_hash = EXCLUDED.password_hash
		 RETURNING id`,
		uuid.New(), email, hash,
	).Scan(&userID)
	if err != nil {
		log.Fatal("seed user:", err)
	}

	fmt.Printf("✓ Super admin ready\n")
	fmt.Printf("  Email:    %s\n", email)
	fmt.Printf("  Password: %s\n", password)
	fmt.Printf("  User ID:  %s\n", userID)
	fmt.Printf("  Org ID:   (none — platform-tier user)\n")
	fmt.Println()
	fmt.Println("Change the password after first login.")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
