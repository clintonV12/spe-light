package email

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"log/slog"
	"time"

	"spe-light/internal/config"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	mail "github.com/wneessen/go-mail"
)

// Service sends transactional emails via SMTP.
//
// Dev mode: emails are logged to stdout instead of sent when running
// outside production AND SMTP_HOST is "localhost" with no SMTP_USER set.
// The AppEnv check (rather than just the host/user fields) matters — a
// production deployment pointed at an anonymous-relay internal mail server
// that happens to be reachable at "localhost" (e.g. host networking) with
// no SMTP_USER would otherwise silently never send real email.
//
// db is optional (nil-safe): if set, every send attempt's outcome is
// persisted to notification_log so failures are queryable after the fact
// instead of only visible in a live log stream.
type Service struct {
	cfg  *config.Config
	tmpl *template.Template
	db   *pgxpool.Pool
}

// New creates a new email Service. db may be nil, in which case delivery
// outcomes are only logged via slog and not persisted to notification_log.
func New(cfg *config.Config, db *pgxpool.Pool) (*Service, error) {
	tmpl, err := template.New("").Parse(allTemplates)
	if err != nil {
		return nil, fmt.Errorf("parse email templates: %w", err)
	}
	return &Service{cfg: cfg, tmpl: tmpl, db: db}, nil
}

// ─── Public send methods ──────────────────────────────────────────────────────
//
// Every method takes orgID/userID (both nullable) purely so the delivery
// outcome can be attributed in notification_log. Pass nil when the value
// genuinely doesn't exist yet — e.g. an invite recipient has no users row
// until they accept, and a platform-tier invite/recipient has no org_id.

// SendOrgInvite sends a platform-level org setup invite to a new org admin contact.
// orgID is the pending org just created for this invite; userID is nil since
// the recipient has no account yet.
func (s *Service) SendOrgInvite(to, orgName, inviterName, inviteLink string, orgID *uuid.UUID) {
	s.send(to, "You have been invited to set up your organisation on StratPlan", "org_invite", orgID, nil, map[string]any{
		"OrgName":     orgName,
		"InviterName": inviterName,
		"InviteLink":  inviteLink,
		"ExpiryDays":  7,
	})
}

// SendUserInvite sends an org-level user invite. userID is nil since the
// recipient has no account yet.
func (s *Service) SendUserInvite(to, orgName, inviterName, role, inviteLink string, orgID uuid.UUID) {
	s.send(to, fmt.Sprintf("You have been invited to join %s on StratPlan", orgName), "user_invite", &orgID, nil, map[string]any{
		"OrgName":     orgName,
		"InviterName": inviterName,
		"Role":        role,
		"InviteLink":  inviteLink,
		"ExpiryHours": 72,
	})
}

// SendPlatformUserInvite invites a new platform-tier teammate (super_admin or
// platform_support). Both orgID and userID are nil: platform-tier accounts
// have no org, and the recipient has no account yet.
func (s *Service) SendPlatformUserInvite(to, role, inviterName, inviteLink string) {
	s.send(to, "You have been invited to join the StratPlan platform team", "platform_user_invite", nil, nil, map[string]any{
		"Role":        role,
		"InviterName": inviterName,
		"InviteLink":  inviteLink,
		"ExpiryDays":  7,
	})
}

// SendPasswordReset sends a password reset link to an existing user.
func (s *Service) SendPasswordReset(to, resetLink string, orgID *uuid.UUID, userID uuid.UUID) {
	s.send(to, "Reset your StratPlan password", "password_reset", orgID, &userID, map[string]any{
		"ResetLink":   resetLink,
		"ExpiryHours": 1,
	})
}

// SendOverdueAlert notifies a user their activity is overdue.
func (s *Service) SendOverdueAlert(to, activityTitle, planTitle, dueDate string, orgID, userID uuid.UUID) {
	s.send(to, fmt.Sprintf("Overdue activity: %s", activityTitle), "overdue_alert", &orgID, &userID, map[string]any{
		"ActivityTitle": activityTitle,
		"PlanTitle":     planTitle,
		"DueDate":       dueDate,
	})
}

// SendOrgDeactivated notifies an org admin their org has been deactivated.
func (s *Service) SendOrgDeactivated(to, orgName string, orgID, userID uuid.UUID) {
	s.send(to, fmt.Sprintf("Your organisation %s has been deactivated", orgName), "org_deactivated", &orgID, &userID, map[string]any{
		"OrgName": orgName,
	})
}

// SendRoleChanged notifies a user their role was updated.
func (s *Service) SendRoleChanged(to, orgName, newRole string, orgID, userID uuid.UUID) {
	s.send(to, "Your role on StratPlan has been updated", "role_changed", &orgID, &userID, map[string]any{
		"OrgName": orgName,
		"NewRole": newRole,
	})
}

// ─── Internal ─────────────────────────────────────────────────────────────────

func (s *Service) send(to, subject, tmplName string, orgID, userID *uuid.UUID, data map[string]any) {
	// Render body.
	var buf bytes.Buffer
	if err := s.tmpl.ExecuteTemplate(&buf, tmplName, data); err != nil {
		slog.Error("render email template", "template", tmplName, "err", err)
		s.logDelivery(to, subject, tmplName, orgID, userID, "failed", err)
		return
	}
	body := buf.String()

	// Dev mode: log to stdout instead of sending. Gated on !IsProduction()
	// as well as the host/user fields — see the Service doc comment for why.
	if !s.cfg.IsProduction() && s.cfg.SMTPHost == "localhost" && s.cfg.SMTPUser == "" {
		slog.Info("EMAIL (dev stdout)",
			"to", to,
			"subject", subject,
			"body_preview", truncate(body, 200),
		)
		// notification_log.status only allows 'sent'/'failed' — dev-stdout
		// delivery counts as "sent" from the app's perspective; the payload
		// records that it was a dev-mode stdout send rather than real SMTP.
		s.logDelivery(to, subject, tmplName, orgID, userID, "sent", nil)
		return
	}

	// Production: send via SMTP, off the request path.
	go func() {
		// The chi Recoverer middleware only guards the HTTP handler
		// goroutine — a panic in here (e.g. from the mail library) would
		// otherwise take the whole process down. Recover and log it as a
		// failed delivery instead.
		defer func() {
			if r := recover(); r != nil {
				slog.Error("panic while sending email", "to", to, "subject", subject, "template", tmplName, "panic", r)
				s.logDelivery(to, subject, tmplName, orgID, userID, "failed", fmt.Errorf("panic: %v", r))
			}
		}()

		if err := s.deliver(to, subject, body); err != nil {
			slog.Error("send email", "to", to, "subject", subject, "err", err)
			s.logDelivery(to, subject, tmplName, orgID, userID, "failed", err)
			return
		}
		s.logDelivery(to, subject, tmplName, orgID, userID, "sent", nil)
	}()
}

// logDelivery persists an email send attempt's outcome to notification_log
// (see the SRS data model — this table exists specifically so delivery
// failures are traceable after the fact, rather than only visible in a live
// log stream). Best-effort: a logging failure is itself only slog'd, never
// propagated, mirroring the audit log package's pattern.
//
// org_id/user_id are nullable (migration 005) precisely because invite
// recipients don't have a users row yet and platform-tier invites have no
// org — pass nil in those cases rather than guessing a value.
//
// This runs in its own short transaction with app.bypass_rls set LOCAL to
// that transaction only. That's necessary because this can fire from the
// detached delivery goroutine (see send() above), which has no connection
// affinity with whatever RLS session context the original HTTP request set
// up — without this, notification_log's org_isolation RLS policy would
// reject the insert (or, worse, silently apply the wrong org's context if a
// pooled connection happened to carry stale session state). Scoping the
// bypass to SET LOCAL inside a transaction means it never leaks onto the
// connection once released back to the pool.
func (s *Service) logDelivery(to, subject, tmplName string, orgID, userID *uuid.UUID, status string, deliveryErr error) {
	if s.db == nil {
		return
	}
	payload := map[string]any{
		"to":      to,
		"subject": subject,
	}
	if deliveryErr != nil {
		payload["error"] = deliveryErr.Error()
	}

	var sentAt any
	if status == "sent" {
		sentAt = time.Now()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		slog.Error("begin notification log tx", "to", to, "template", tmplName, "err", err)
		return
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SET LOCAL app.bypass_rls = 'true'`); err != nil {
		slog.Error("set bypass_rls for notification log", "to", to, "template", tmplName, "err", err)
		return
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO notification_log (id, org_id, user_id, type, channel, payload, sent_at, status)
		 VALUES ($1, $2, $3, $4, 'email', $5, $6, $7)`,
		uuid.New(), orgID, userID, tmplName, payload, sentAt, status,
	); err != nil {
		slog.Error("write notification log", "to", to, "template", tmplName, "status", status, "err", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		slog.Error("commit notification log tx", "to", to, "template", tmplName, "err", err)
	}
}

func (s *Service) deliver(to, subject, htmlBody string) error {
	m := mail.NewMsg()
	if err := m.From(s.cfg.SMTPFrom); err != nil {
		return fmt.Errorf("set from: %w", err)
	}
	if err := m.To(to); err != nil {
		return fmt.Errorf("set to: %w", err)
	}
	m.Subject(subject)
	m.SetBodyHTMLTemplate(template.Must(template.New("b").Parse(htmlBody)), nil)

	opts := []mail.Option{
		mail.WithPort(s.cfg.SMTPPort),
		mail.WithTimeout(10 * time.Second),
	}
	if s.cfg.SMTPUser != "" {
		opts = append(opts,
			mail.WithSMTPAuth(mail.SMTPAuthPlain),
			mail.WithUsername(s.cfg.SMTPUser),
			mail.WithPassword(s.cfg.SMTPPassword),
		)
	} else {
		opts = append(opts, mail.WithTLSPolicy(mail.NoTLS))
	}

	c, err := mail.NewClient(s.cfg.SMTPHost, opts...)
	if err != nil {
		return fmt.Errorf("create client: %w", err)
	}
	return c.DialAndSend(m)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// ─── HTML email templates ─────────────────────────────────────────────────────

const allTemplates = `
{{define "org_invite"}}
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>Welcome to StratPlan</h2>
<p>You have been invited by <strong>{{.InviterName}}</strong> to set up your organisation <strong>{{.OrgName}}</strong> on StratPlan.</p>
<p><a href="{{.InviteLink}}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Set up your organisation</a></p>
<p style="color:#6b7280;font-size:14px">This link expires in {{.ExpiryDays}} days. If you did not expect this invitation, you can ignore this email.</p>
</body></html>
{{end}}

{{define "user_invite"}}
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>You have been invited to join {{.OrgName}}</h2>
<p><strong>{{.InviterName}}</strong> has invited you to join <strong>{{.OrgName}}</strong> on StratPlan as a <strong>{{.Role}}</strong>.</p>
<p><a href="{{.InviteLink}}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Accept invitation</a></p>
<p style="color:#6b7280;font-size:14px">This link expires in {{.ExpiryHours}} hours.</p>
</body></html>
{{end}}

{{define "password_reset"}}
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>Reset your password</h2>
<p>Click the button below to reset your StratPlan password. This link expires in {{.ExpiryHours}} hour.</p>
<p><a href="{{.ResetLink}}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reset password</a></p>
<p style="color:#6b7280;font-size:14px">If you did not request a password reset, you can safely ignore this email.</p>
</body></html>
{{end}}

{{define "overdue_alert"}}
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>Overdue activity</h2>
<p>The activity <strong>{{.ActivityTitle}}</strong> in plan <strong>{{.PlanTitle}}</strong> was due on <strong>{{.DueDate}}</strong> and has not been completed.</p>
<p style="color:#6b7280;font-size:14px">Please log in to StratPlan to update the status.</p>
</body></html>
{{end}}

{{define "org_deactivated"}}
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>Organisation deactivated</h2>
<p>Your organisation <strong>{{.OrgName}}</strong> has been deactivated by a platform administrator. All active sessions have been invalidated.</p>
<p style="color:#6b7280;font-size:14px">Contact support if you believe this is an error.</p>
</body></html>
{{end}}

{{define "role_changed"}}
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>Your role has been updated</h2>
<p>Your role in <strong>{{.OrgName}}</strong> on StratPlan has been updated to <strong>{{.NewRole}}</strong>.</p>
</body></html>
{{end}}

{{define "platform_user_invite"}}
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>You're invited to the StratPlan platform team</h2>
<p><strong>{{.InviterName}}</strong> has invited you to join the StratPlan platform team as <strong>{{.Role}}</strong>. This grants cross-organisation access rather than membership in a single organisation.</p>
<p><a href="{{.InviteLink}}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Accept invitation</a></p>
<p style="color:#6b7280;font-size:14px">This link expires in {{.ExpiryDays}} days. If you did not expect this invitation, you can ignore this email.</p>
</body></html>
{{end}}
`
