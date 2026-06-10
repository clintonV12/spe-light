// Seed creates a local super_admin user for development.
// Run with: make seed   (or: go run ./scripts/seed/main.go)
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

	// Seed org
	orgID := uuid.New()
	_, err = db.Exec(ctx,
		`INSERT INTO organisations (id, name, slug, locale, is_active)
		 VALUES ($1, 'Platform Admin', 'platform-admin', 'en', true)
		 ON CONFLICT (slug) DO NOTHING`,
		orgID,
	)
	if err != nil {
		log.Fatal("seed org:", err)
	}

	// Re-fetch org id in case slug already existed
	_ = db.QueryRow(ctx,
		`SELECT id FROM organisations WHERE slug = 'platform-admin'`,
	).Scan(&orgID)

	// Seed super_admin user
	email := getEnv("SEED_EMAIL", "admin@stratplan.local")
	password := getEnv("SEED_PASSWORD", "Admin1234!")

	hash, err := auth.HashPassword(password)
	if err != nil {
		log.Fatal("hash password:", err)
	}

	var userID uuid.UUID
	err = db.QueryRow(ctx,
		`INSERT INTO users (id, org_id, email, password_hash, name, role, locale, is_active)
		 VALUES ($1, $2, $3, $4, 'Super Admin', 'super_admin', 'en', true)
		 ON CONFLICT (org_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
		 RETURNING id`,
		uuid.New(), orgID, email, hash,
	).Scan(&userID)
	if err != nil {
		log.Fatal("seed user:", err)
	}

	fmt.Printf("✓ Super admin ready\n")
	fmt.Printf("  Email:    %s\n", email)
	fmt.Printf("  Password: %s\n", password)
	fmt.Printf("  User ID:  %s\n", userID)
	fmt.Printf("  Org ID:   %s\n", orgID)
	fmt.Println()
	fmt.Println("Change the password after first login.")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
