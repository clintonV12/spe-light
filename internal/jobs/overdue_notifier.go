// Package jobs holds background work that runs on its own schedule rather
// than inside an HTTP request — started from main.go as a plain goroutine,
// since this codebase has no separate worker binary or job queue.
//
// OverdueNotifier is the first (and currently only) job: it periodically
// finds activities that are overdue (due_date in the past, status != complete)
// and emails the assigned users (or the plan owner, if nobody's assigned)
// using the existing email.Service.SendOverdueAlert — which already existed
// and had a template, but was never actually called from anywhere.
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"spe-light/internal/email"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OverdueNotifier scans for overdue activities on a fixed interval and
// emails the people responsible for them.
type OverdueNotifier struct {
	db       *pgxpool.Pool
	email    *email.Service
	interval time.Duration
	// cooldown stops the same person being re-emailed about the same
	// activity on every single scan — once notified, they won't be notified
	// again about that activity until this much time has passed, even
	// though it's still overdue.
	cooldown time.Duration
}

// NewOverdueNotifier creates an OverdueNotifier. emailSvc is expected to be
// a dedicated instance (main.go constructs its own via email.New, separate
// from the one handlers.NewRouter builds internally) — the Service itself
// is cheap to construct (just parses templates once) and stateless beyond
// that, so sharing one isn't necessary.
func NewOverdueNotifier(db *pgxpool.Pool, emailSvc *email.Service, interval, cooldown time.Duration) *OverdueNotifier {
	return &OverdueNotifier{db: db, email: emailSvc, interval: interval, cooldown: cooldown}
}

// Run blocks: it scans immediately, then again on every tick, until ctx is
// cancelled. Intended usage from main.go:
//
//	notifyCtx, cancelNotify := context.WithCancel(context.Background())
//	go notifier.Run(notifyCtx)
//	// ... later, during shutdown:
//	cancelNotify()
func (n *OverdueNotifier) Run(ctx context.Context) {
	slog.Info("overdue notifier started", "interval", n.interval, "cooldown", n.cooldown)
	n.scanOnce(ctx)

	ticker := time.NewTicker(n.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("overdue notifier stopped")
			return
		case <-ticker.C:
			n.scanOnce(ctx)
		}
	}
}

type overdueActivity struct {
	activityID uuid.UUID
	title      string
	dueDate    time.Time
	planTitle  string
	planOwner  uuid.UUID
	orgID      uuid.UUID
	assignedTo []uuid.UUID
}

func (n *OverdueNotifier) scanOnce(ctx context.Context) {
	var overdue []overdueActivity

	err := withBypassRLS(ctx, n.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT a.id, a.title, a.due_date, p.title, p.owner_id, a.org_id, a.assigned_to
			FROM activities a
			JOIN plans p ON p.id = a.plan_id
			WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL
			  AND a.due_date IS NOT NULL AND a.due_date < NOW()
			  AND a.status != 'complete'`,
		)
		if err != nil {
			return fmt.Errorf("query overdue activities: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var a overdueActivity
			if err := rows.Scan(&a.activityID, &a.title, &a.dueDate, &a.planTitle, &a.planOwner, &a.orgID, &a.assignedTo); err != nil {
				return fmt.Errorf("scan overdue activity: %w", err)
			}
			overdue = append(overdue, a)
		}
		return rows.Err()
	})
	if err != nil {
		slog.Error("overdue scan failed", "err", err)
		return
	}

	if len(overdue) > 0 {
		slog.Info("overdue scan complete", "overdue_activities", len(overdue))
	}

	for _, a := range overdue {
		recipients := a.assignedTo
		if len(recipients) == 0 {
			// Nobody's explicitly assigned — fall back to the plan owner
			// rather than letting the activity go unnoticed by anyone.
			recipients = []uuid.UUID{a.planOwner}
		}
		for _, userID := range recipients {
			n.notifyOne(ctx, a, userID)
		}
	}
}

func (n *OverdueNotifier) notifyOne(ctx context.Context, a overdueActivity, userID uuid.UUID) {
	alreadyNotified, err := n.recentlyNotified(ctx, a.activityID, userID)
	if err != nil {
		slog.Error("overdue notification dedup check failed", "activity_id", a.activityID, "user_id", userID, "err", err)
		return
	}
	if alreadyNotified {
		return
	}

	to, err := n.recipientEmail(ctx, userID)
	if err != nil {
		slog.Warn("overdue recipient not found or inactive", "user_id", userID, "activity_id", a.activityID, "err", err)
		return
	}

	n.email.SendOverdueAlert(to, a.title, a.planTitle, a.dueDate.Format("2 January 2006"), a.orgID, userID, a.activityID)
}

// recentlyNotified checks notification_log for an existing overdue_alert
// sent to this user about this specific activity within the cooldown
// window. Matches on the activity_id we now record in the payload (see
// email.go's SendOverdueAlert) — notification_log has no dedicated
// activity_id column, so this is a JSON payload lookup rather than an
// indexed join, which is fine at this scan frequency and data volume.
func (n *OverdueNotifier) recentlyNotified(ctx context.Context, activityID, userID uuid.UUID) (bool, error) {
	var exists bool
	err := withBypassRLS(ctx, n.db, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT EXISTS(
			  SELECT 1 FROM notification_log
			  WHERE type = 'overdue_alert'
			    AND user_id = $1
			    AND payload->>'activity_id' = $2
			    AND status = 'sent'
			    AND created_at > NOW() - ($3 || ' seconds')::interval
			)`,
			userID, activityID.String(), fmt.Sprintf("%d", int(n.cooldown.Seconds())),
		).Scan(&exists)
	})
	return exists, err
}

// recipientEmail looks up an active user's email address. Skips
// deactivated/deleted users so nobody gets alerted about a plan they no
// longer have access to.
func (n *OverdueNotifier) recipientEmail(ctx context.Context, userID uuid.UUID) (string, error) {
	var to string
	err := withBypassRLS(ctx, n.db, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL AND is_active`,
			userID,
		).Scan(&to)
	})
	if err != nil {
		return "", err
	}
	return to, nil
}

// withBypassRLS runs fn inside a short transaction with RLS bypassed for
// that transaction only. Required because this whole package runs from a
// background goroutine with no per-request org context set by
// middleware.WithRLS — without this, activities/plans/users/notification_log's
// org-isolation RLS policies would silently return zero rows for every
// query here rather than erroring, which would make the notifier look like
// it's running fine while quietly never finding anything. This mirrors the
// identical pattern (and the same reasoning) in internal/email/email.go's
// logDelivery.
func withBypassRLS(ctx context.Context, db *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SET LOCAL app.bypass_rls = 'true'`); err != nil {
		return fmt.Errorf("set bypass_rls: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
