package email

import (
	"bytes"
	"fmt"
	"html/template"
	"log/slog"
	"time"

	"spe-light/internal/config"

	mail "github.com/wneessen/go-mail"
)

// Service sends transactional emails via SMTP.
// When SMTP_HOST is "localhost" and no user is configured, emails are logged to stdout instead.
type Service struct {
	cfg  *config.Config
	tmpl *template.Template
}

// New creates a new email Service.
func New(cfg *config.Config) (*Service, error) {
	tmpl, err := template.New("").Parse(allTemplates)
	if err != nil {
		return nil, fmt.Errorf("parse email templates: %w", err)
	}
	return &Service{cfg: cfg, tmpl: tmpl}, nil
}

// ─── Public send methods ──────────────────────────────────────────────────────

// SendOrgInvite sends a platform-level org setup invite to a new org admin contact.
func (s *Service) SendOrgInvite(to, orgName, inviterName, inviteLink string) {
	s.send(to, "You have been invited to set up your organisation on StratPlan", "org_invite", map[string]any{
		"OrgName":     orgName,
		"InviterName": inviterName,
		"InviteLink":  inviteLink,
		"ExpiryDays":  7,
	})
}

// SendUserInvite sends an org-level user invite.
func (s *Service) SendUserInvite(to, orgName, inviterName, role, inviteLink string) {
	s.send(to, fmt.Sprintf("You have been invited to join %s on StratPlan", orgName), "user_invite", map[string]any{
		"OrgName":     orgName,
		"InviterName": inviterName,
		"Role":        role,
		"InviteLink":  inviteLink,
		"ExpiryHours": 72,
	})
}

// SendPasswordReset sends a password reset link.
func (s *Service) SendPasswordReset(to, resetLink string) {
	s.send(to, "Reset your StratPlan password", "password_reset", map[string]any{
		"ResetLink":   resetLink,
		"ExpiryHours": 1,
	})
}

// SendOverdueAlert notifies a user their activity is overdue.
func (s *Service) SendOverdueAlert(to, activityTitle, planTitle, dueDate string) {
	s.send(to, fmt.Sprintf("Overdue activity: %s", activityTitle), "overdue_alert", map[string]any{
		"ActivityTitle": activityTitle,
		"PlanTitle":     planTitle,
		"DueDate":       dueDate,
	})
}

// SendOrgDeactivated notifies org admins their org has been deactivated.
func (s *Service) SendOrgDeactivated(to, orgName string) {
	s.send(to, fmt.Sprintf("Your organisation %s has been deactivated", orgName), "org_deactivated", map[string]any{
		"OrgName": orgName,
	})
}

// SendRoleChanged notifies a user their role was updated.
func (s *Service) SendRoleChanged(to, orgName, newRole string) {
	s.send(to, "Your role on StratPlan has been updated", "role_changed", map[string]any{
		"OrgName": orgName,
		"NewRole": newRole,
	})
}

// ─── Internal ─────────────────────────────────────────────────────────────────

func (s *Service) send(to, subject, tmplName string, data map[string]any) {
	// Render body.
	var buf bytes.Buffer
	if err := s.tmpl.ExecuteTemplate(&buf, tmplName, data); err != nil {
		slog.Error("render email template", "template", tmplName, "err", err)
		return
	}
	body := buf.String()

	// Dev mode: log to stdout instead of sending.
	if s.cfg.SMTPHost == "localhost" && s.cfg.SMTPUser == "" {
		slog.Info("EMAIL (dev stdout)",
			"to", to,
			"subject", subject,
			"body_preview", truncate(body, 200),
		)
		return
	}

	// Production: send via SMTP.
	go func() {
		if err := s.deliver(to, subject, body); err != nil {
			slog.Error("send email", "to", to, "subject", subject, "err", err)
		}
	}()
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
`
