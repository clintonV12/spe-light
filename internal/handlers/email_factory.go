package handlers

import (
	"spe-light/internal/config"
	"spe-light/internal/email"

	"github.com/jackc/pgx/v5/pgxpool"
)

// newEmailService is a convenience wrapper used by the router to build the
// email service. It returns an error on template parse failure — the
// comment here used to claim this "panics ... (caught at startup)", but the
// error was actually being discarded by the caller (`_`), so a broken
// template would boot the server fine and then nil-pointer-panic on the
// first email send. router.go now checks this error instead of ignoring it.
//
// db is passed through so the email service can persist delivery outcomes
// to notification_log (see internal/email/email.go).
func newEmailService(cfg *config.Config, db *pgxpool.Pool) (*email.Service, error) {
	return email.New(cfg, db)
}
