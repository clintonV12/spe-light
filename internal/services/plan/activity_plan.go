// activity_plan.go — helper to look up which plan an activity belongs to.
//
// This is needed by the ListActivityLinks handler, which receives an
// activityID but needs the planID+orgID to call ListLinks correctly.
// It also provides a consistent "activity not found" check across all
// activity-scoped operations.
package plansvc

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GetActivityPlanID returns the plan_id and org_id for a given activity,
// verifying that the activity belongs to the caller's org. Returns an error
// if the activity doesn't exist or belongs to a different org.
func (s *Service) GetActivityPlanID(ctx context.Context, activityID, orgID uuid.UUID) (planID, foundOrgID uuid.UUID, err error) {
	err = s.db.QueryRow(ctx,
		`SELECT plan_id, org_id FROM activities
		 WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
		activityID, orgID,
	).Scan(&planID, &foundOrgID)
	if err == pgx.ErrNoRows {
		return uuid.Nil, uuid.Nil, fmt.Errorf("activity not found")
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("lookup activity: %w", err)
	}
	return planID, foundOrgID, nil
}
