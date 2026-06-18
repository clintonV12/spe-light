// Package auditlog provides a single helper for writing immutable audit
// trail entries (REQ-NF-016). Audit rows are append-only — nothing in this
// package ever updates or deletes a row.
//
// Usage from a service method:
//
//	auditlog.Record(ctx, db, auditlog.Entry{
//	    OrgID:     orgID,
//	    UserID:    actorID,
//	    Action:    "user.role_changed",
//	    TableName: "users",
//	    RecordID:  targetUserID,
//	    Diff:      map[string]any{"role": {"from": "viewer", "to": "planner"}},
//	})
//
// Failures to write an audit entry are logged but never block the calling
// request — audit logging is best-effort so it cannot become an outage
// vector for unrelated functionality. If your compliance requirements
// demand audit-write failures to be fatal, change Record to return the
// error and have callers wrap their mutation in the same transaction.
package auditlog

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Entry describes a single audit log row.
type Entry struct {
	OrgID     uuid.UUID
	UserID    uuid.UUID
	Action    string         // e.g. "plan.created", "user.deactivated"
	TableName string         // the table the change applies to
	RecordID  uuid.UUID      // the primary key of the affected row
	Diff      map[string]any // before/after values, or a free-form description
}

// Record writes an audit entry. Errors are logged, not returned — see the
// package doc for why this is best-effort rather than transactional.
func Record(ctx context.Context, db *pgxpool.Pool, e Entry) {
	if e.Diff == nil {
		e.Diff = map[string]any{}
	}
	_, err := db.Exec(ctx,
		`INSERT INTO audit_log (id, org_id, user_id, action, table_name, record_id, diff)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		uuid.New(), e.OrgID, e.UserID, e.Action, e.TableName, e.RecordID, e.Diff,
	)
	if err != nil {
		slog.Error("write audit log entry",
			"action", e.Action, "table", e.TableName, "record_id", e.RecordID, "err", err)
	}
}
