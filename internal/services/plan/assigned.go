package plansvc

import (
	"context"

	"github.com/google/uuid"
)

// IsAssigned returns true if userID appears in the assigned_to array of the
// given activity. Used by the handler to gate contributor access.
func (s *Service) IsAssigned(ctx context.Context, activityID, userID uuid.UUID) bool {
	// PostgreSQL ANY operator checks if a value exists in an array column.
	var found bool
	_ = s.db.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM activities
		   WHERE id = $1 AND deleted_at IS NULL AND $2 = ANY(assigned_to)
		 )`,
		activityID, userID,
	).Scan(&found)
	return found
}
