package handlers

import (
	"spe-light/internal/config"
	"spe-light/internal/email"
)

// newEmailService is a convenience wrapper used by the router to build the
// email service. It panics on template parse errors (caught at startup).
func newEmailService(cfg *config.Config) (*email.Service, error) {
	return email.New(cfg)
}
