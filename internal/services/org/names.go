package orgsvc

import (
	"context"

	"github.com/google/uuid"
)

// GetOrgAndUserNames fetches org name and user display name for use in emails.
// Returns safe fallbacks on error so invite sending is not blocked.
func (s *Service) GetOrgAndUserNames(ctx context.Context, orgID, userID uuid.UUID) (orgName, userName string) {
	_ = s.db.QueryRow(ctx, `SELECT name FROM organisations WHERE id = $1`, orgID).Scan(&orgName)
	_ = s.db.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, userID).Scan(&userName)
	if orgName == "" {
		orgName = "your organisation"
	}
	if userName == "" {
		userName = "an admin"
	}
	return
}
