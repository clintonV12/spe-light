// plan_viewer.go — plan-scoped viewer grant/revoke (gap 2.3, part B).
//
// Part A of gap 2.3 (writing plan_viewers rows on invite acceptance) is fixed
// in internal/services/auth/service.go — see AcceptInvite there.
//
// Part B (this file) provides the direct grant/revoke API for org admins who
// need to manage viewer access for users who already have accounts, without
// going through the invite flow. Routes wired in router.go:
//
//	POST   /api/v1/plans/{planID}/viewers            (org_admin)
//	DELETE /api/v1/plans/{planID}/viewers/{userID}   (org_admin)
package plansvc

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// GrantPlanViewer grants plan-scoped viewer access to an existing org user.
//
// Both the plan and the target user are verified to belong to orgID before
// any write occurs. The INSERT is idempotent (ON CONFLICT DO NOTHING) so
// calling this twice for the same (plan, user) pair is safe.
func (s *Service) GrantPlanViewer(ctx context.Context, planID, userID, granterID, orgID uuid.UUID) error {
	// Verify plan belongs to this org.
	var planExists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		planID, orgID,
	).Scan(&planExists); err != nil {
		return fmt.Errorf("verify plan: %w", err)
	}
	if !planExists {
		return fmt.Errorf("plan not found")
	}

	// Verify the target user belongs to this org.
	var userExists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		userID, orgID,
	).Scan(&userExists); err != nil {
		return fmt.Errorf("verify user: %w", err)
	}
	if !userExists {
		return fmt.Errorf("user not found in this organisation")
	}

	_, err := s.db.Exec(ctx,
		`INSERT INTO plan_viewers (plan_id, user_id, granted_by, granted_at)
		 VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (plan_id, user_id) DO NOTHING`,
		planID, userID, granterID,
	)
	if err != nil {
		return fmt.Errorf("grant plan viewer: %w", err)
	}
	return nil
}

// RevokePlanViewer removes plan-scoped viewer access for a user.
//
// The plan is verified to belong to orgID before the delete. Returns an error
// if no matching row exists so the handler can return a clear 400 rather than
// silently succeeding for a non-existent grant.
func (s *Service) RevokePlanViewer(ctx context.Context, planID, userID, orgID uuid.UUID) error {
	// Verify plan belongs to this org before deleting.
	var planExists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM plans WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL)`,
		planID, orgID,
	).Scan(&planExists); err != nil {
		return fmt.Errorf("verify plan: %w", err)
	}
	if !planExists {
		return fmt.Errorf("plan not found")
	}

	result, err := s.db.Exec(ctx,
		`DELETE FROM plan_viewers WHERE plan_id = $1 AND user_id = $2`,
		planID, userID,
	)
	if err != nil {
		return fmt.Errorf("revoke plan viewer: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("viewer access not found for this user on this plan")
	}
	return nil
}
