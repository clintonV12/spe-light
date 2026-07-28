// stats.go — cross-organisation platform overview for the platform admin
// console (super_admin / platform_support).
//
// Every other endpoint in this package is scoped to a single organisation
// or a single platform-tier resource (users, invitations); this is the one
// place that looks across all of them at once, giving a super_admin or
// platform_support user the "how is the platform doing" snapshot they
// can't get anywhere else in the UI.
//
// Route wired in router.go:
//
//	GET /api/v1/admin/stats — super_admin or platform_support
package adminsvc

import "context"

// PlatformStats is a lightweight cross-organisation snapshot for the
// platform admin console's overview cards.
type PlatformStats struct {
	OrgsTotal         int `json:"orgs_total"`
	OrgsActive        int `json:"orgs_active"`
	OrgsNewLast30Days int `json:"orgs_new_last_30_days"`

	OrgUsersTotal     int `json:"org_users_total"`
	PlatformTeamTotal int `json:"platform_team_total"`

	PlansTotal      int `json:"plans_total"`
	PlansActive     int `json:"plans_active"`
	ActivitiesTotal int `json:"activities_total"`

	ReportsGeneratedTotal int `json:"reports_generated_total"`

	PendingOrgInvitations      int `json:"pending_org_invitations"`
	PendingPlatformInvitations int `json:"pending_platform_invitations"`
}

// GetStats assembles the platform overview from a handful of independent
// COUNT queries. Each is best-effort — a single query failing degrades
// that one field to 0 rather than failing the whole request, since a
// partial dashboard is still more useful to a platform admin than an error
// page. GetStats itself therefore never actually returns a non-nil error;
// the return signature just matches every other service method's shape so
// the handler doesn't need a special case.
func (s *Service) GetStats(ctx context.Context) (*PlatformStats, error) {
	count := func(query string) int {
		var n int
		if err := s.db.QueryRow(ctx, query).Scan(&n); err != nil {
			return 0
		}
		return n
	}

	stats := &PlatformStats{
		OrgsTotal:         count(`SELECT COUNT(*) FROM organisations WHERE deleted_at IS NULL`),
		OrgsActive:        count(`SELECT COUNT(*) FROM organisations WHERE deleted_at IS NULL AND is_active = TRUE`),
		OrgsNewLast30Days: count(`SELECT COUNT(*) FROM organisations WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days'`),

		// org_id IS NOT NULL / IS NULL is the same "platform-tier vs
		// org-tier" split migration 003 introduced for users.org_id.
		OrgUsersTotal:     count(`SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND org_id IS NOT NULL`),
		PlatformTeamTotal: count(`SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND org_id IS NULL`),

		PlansTotal:      count(`SELECT COUNT(*) FROM plans WHERE deleted_at IS NULL`),
		PlansActive:     count(`SELECT COUNT(*) FROM plans WHERE deleted_at IS NULL AND status = 'active'`),
		ActivitiesTotal: count(`SELECT COUNT(*) FROM activities WHERE deleted_at IS NULL`),

		ReportsGeneratedTotal: count(`SELECT COUNT(*) FROM reports`),

		// Same org_id split as users — NULL org_id is a platform-team invite.
		PendingOrgInvitations:      count(`SELECT COUNT(*) FROM invitations WHERE status = 'pending' AND org_id IS NOT NULL`),
		PendingPlatformInvitations: count(`SELECT COUNT(*) FROM invitations WHERE status = 'pending' AND org_id IS NULL`),
	}
	return stats, nil
}
