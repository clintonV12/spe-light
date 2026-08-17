# StratPlan User Guide

Welcome to StratPlan — a strategic planning tool for organisations that want
to turn a plan into something people actually track and finish, not a
document that gets written once and never opened again.

This guide is written for the people *using* StratPlan day to day: planners,
organisation admins, contributors, and viewers. If you're looking for
technical/API details instead, see `api-reference.md`.

---

## Contents

1. [What StratPlan is](#1-what-stratplan-is)
2. [Signing in](#2-signing-in)
3. [Roles — who can do what](#3-roles--who-can-do-what)
4. [Creating a plan](#4-creating-a-plan)
5. [Working through your plan](#5-working-through-your-plan)
   - [Vision, Mission & Core Values](#chapter-1--vision-mission--core-values)
   - [Situational Analysis](#chapter-2--situational-analysis)
   - [Strategic Pillars](#chapter-3--strategic-pillars)
   - [Organisational Structure](#chapter-4--organisational-structure)
   - [Monitoring & Evaluation](#chapter-5--monitoring--evaluation)
   - [Tracking](#chapter-6--tracking)
   - [Advanced Research (optional)](#chapter-7--advanced-research-optional)
6. [Lwazi — your AI assistant](#6-lwazi--your-ai-assistant)
7. [Linking activities together](#7-linking-activities-together)
8. [Tracking progress](#8-tracking-progress)
9. [Generating reports](#9-generating-reports)
10. [Changing language](#10-changing-language)
11. [Frequently asked questions](#11-frequently-asked-questions)

---

## 1. What StratPlan is

StratPlan helps your organisation build a strategic plan and then actually
*use* it — assign work, track KPIs, see what's overdue, and produce
polished reports for a board meeting or funder, all from the same living
document.

Every plan follows the same structure, based on the ESWAMCU strategic
planning standard:

**Strategic Pillars → Strategic Objectives → Activities**

A **Strategic Pillar** is one of the big areas your organisation is
focusing on (e.g. "Leadership & Governance," "Financial Stability"). Each
pillar contains one or more **Strategic Objectives** — the specific goals
that pillar is trying to achieve. Each objective contains **Activities** —
the actual work, each with its own KPIs, budget, and the person
responsible.

Alongside that structure, a plan has a handful of other sections (we call
them **chapters**) covering vision and mission, situational analysis,
org structure, and monitoring & evaluation — plus an optional space for
deeper research tools if your plan needs them. All of this is covered in
[section 5](#5-working-through-your-plan).

> **If you used an earlier version of StratPlan:** plans used to come in
> two flavours — a fixed "P1 → P2 → P3" phase model, or the Pillar-based
> model described above. That choice is gone. Every plan now uses the
> Pillar/Objective structure, and everything that only existed in the old
> P1/P2/P3 model (Risk Register, Business Model Canvas, Competitive
> Analysis, Operational Roadmap, and a few others) now lives in the
> optional **Advanced Research** section instead — see
> [Chapter 7](#chapter-7--advanced-research-optional).

---

## 2. Signing in

If your organisation admin sent you an invite email, open the link inside
it. You'll be asked to set your name and a password — pick something with
at least 8 characters; StratPlan will show you a strength meter as you
type. Once your account is created you're dropped straight into your
dashboard.

Already have an account? Go to the sign-in page, enter your work email and
password. Forgotten your password? Use the "Forgot password?" link on that
same page.

---

## 3. Roles — who can do what

Every person in your organisation has one role. Roles control what you can
see and change:

| Role | What you can do |
|---|---|
| **Org Admin** | Everything — create/edit/delete plans, manage users, invite people, configure SSO. |
| **Planner** | Create and edit plan content (pillars, objectives, activities, all chapters). Can't manage users or delete plans. |
| **Contributor** | Can only update the activities specifically assigned to them — status, notes, KPI progress. Can't touch anything else. |
| **Viewer** | Read-only. Either sees every plan in the organisation, or only specific plans someone has shared with them. |

If something looks locked or read-only and you think it shouldn't be, check
with your org admin about your role — it's almost always a role setting,
not a bug.

---

## 4. Creating a plan

From your Plans list, click **New Plan**. Give it a title and (optionally)
a description and start/end dates. That's it — the plan is created in
**Draft** status, ready for you to start filling in.

You can change a plan's status at any time (Draft → Active → Review →
Completed → Archived) from the plan's own page. An archived plan is kept
for reference but its content can no longer be edited.

Need a fresh copy of an existing plan — for a new year, or a similar
project? Use **Duplicate** on the plan's page. Everything copies over
(pillars, objectives, activities) except activity links, which you'll want
to re-check anyway since a duplicated plan's activities are new copies.

---

## 5. Working through your plan

Open any plan and you'll see a row of tabs across the top — these are the
plan's **chapters**. You don't have to fill them in top-to-bottom or in any
particular order; work on whichever chapter makes sense for where you are.

### Chapter 1 — Vision, Mission & Core Values

Set your organisation's Vision and Mission statement for this plan, and
list out your Core Values. Simple text fields — no special structure here.

### Chapter 2 — Situational Analysis

This is where you capture the groundwork before committing to a strategy:

- **Stakeholders** — list the people and groups who matter to this plan,
  rated by influence and interest. StratPlan automatically sorts them into
  the four classic quadrants (Manage Closely, Keep Satisfied, Keep
  Informed, Monitor) so you know how much attention each one needs.
- **SWOT** — your Strengths, Weaknesses, Opportunities, and Threats, one
  list per category.
- **PESTEL** — political, economic, social, technological, environmental,
  and legal factors affecting your plan, with the implication (and whether
  it's a positive or negative one) for each.

### Chapter 3 — Strategic Pillars

This is the heart of the plan. Add your Strategic Pillars, then under each
pillar add the Strategic Objectives that pillar is working toward, then
under each objective add the Activities that will actually get you there.

Each activity can carry one or more **KPIs** — an indicator, a target, a
budget, who's responsible, and how often it's measured (monthly,
quarterly, or annually). A single activity can have several KPIs if it's
tracked more than one way.

Click any pillar's or objective's title to rename it right there — look
for the pencil icon on hover. Deleting a pillar requires its objectives to
be empty first (and deleting an objective requires its activities to be
empty first) — this is intentional, so you can't accidentally lose a
branch of work in one click.

### Chapter 4 — Organisational Structure

Build your org chart: add roles, and set who each one reports to. There's
no fixed number of levels — build it as deep or as flat as your actual
organisation is. Removing a role doesn't remove the people who reported to
it; they just move to the top level until you re-assign them.

### Chapter 5 — Monitoring & Evaluation

Capture your M&E framework as a set of short notes, grouped into four
categories: Objectives, Critical Success Factors, Review Notes, and
Conclusion Measures. This is deliberately simple (a list, not a table) to
match how most strategic plans actually write this section up.

### Chapter 6 — Tracking

A dashboard view of every KPI across your plan's activities, so you can see
at a glance what's on target, what's behind, and what's coming due next —
without digging through each pillar individually.

### Chapter 7 — Advanced Research (optional)

Most plans will never need this tab — it's there for teams that want to go
deeper on a specific area with a dedicated tool, without it cluttering the
main Pillar/Objective structure. It holds seven types of standalone
research activities, each attached directly to the plan rather than to any
particular pillar:

- **Business Model Canvas**
- **Competitive Analysis**
- **Risk Register**
- **OKR / Balanced Scorecard**
- **Operational Roadmap**
- **Resource Plan**
- **Budget Allocation**

Click **Add research**, pick a type, and give it a title — you'll get a
dedicated editor for that type, the same as any other activity (including
Lwazi's help, see below).

---

## 6. Lwazi — your AI assistant

Lwazi is StratPlan's built-in AI assistant, available wherever you see a
sparkle/"Call Lwazi" trigger — inside an activity, or at the top of most
chapters. Type a few keywords describing your context (e.g. *"fintech,
East Africa, growth"*) and Lwazi will draft content for that section:
SWOT points, KPI suggestions, a risk register, and more, depending on
where you're working.

A few things worth knowing:

- **Always review before accepting.** Lwazi's draft appears in a preview
  card with **Accept**, **Retry**, and **Discard** — nothing is saved
  until you accept it.
- **It runs entirely on your own infrastructure.** StratPlan's AI features
  use a self-hosted model (Ollama) — no data leaves your organisation's
  deployment, and nothing goes to an external API.
- **It needs a connection to work.** If Lwazi is unreachable (e.g. the AI
  service isn't running, or you're offline), you'll see a clear message
  rather than a silent failure or an infinite spinner.

---

## 7. Linking activities together

Activities in different parts of your plan are often related — a risk
identified in one place needs mitigating in another, or one activity's
output feeds directly into a second one. The **Linked Activities** panel on
any activity page lets you connect activities in either direction ("fed by"
and "feeds into").

Two ways to create a link:

- **Manually** — search for the other activity and add the link yourself.
- **AI-suggested** — from the Progress page's dependency network, click
  **Suggest AI links** and Lwazi will propose connections based on your
  plan's content, with a plain-language reason for each one. Review and
  accept (or reject) each suggestion individually — nothing is linked
  automatically.

Links don't have to follow any particular order — a link is a relationship,
not a sequence gate.

---

## 8. Tracking progress

The **Progress** page (in the main navigation) gives you a bird's-eye view
across all your active plans: overall completion percentage, activities
completed vs. in progress, and anything overdue.

Pick a single plan from the dropdown to see:

- A **progress bar per Strategic Pillar**, plus a separate summary for
  Advanced Research activities if the plan has any (they don't belong to
  any pillar, so they're shown alongside rather than folded in).
- The **Activity Dependency Network** — an interactive diagram of every
  activity in the plan, grouped by pillar, with the links between them
  drawn as connecting lines. Click any activity for a quick detail panel,
  drag to pan, scroll to zoom, and use the AI-suggested-links panel from
  here too.

---

## 9. Generating reports

From a plan's **Reports** tab, click **Generate**, pick a report type and
file format (PDF, Word, or Excel), and StratPlan builds it for you —
usually in a few seconds. Once it's ready, download it from the same
screen; every report you've generated for a plan stays listed there for
later.

Report types range from a full plan export to a focused executive summary,
a progress-only snapshot, or a fully custom report where you tick exactly
which sections to include (KPI scorecard, org structure, M&E, milestones,
dependency links, and an optional AI-written summary of the plan's current
state).

---

## 10. Changing language

StratPlan is available in English, Spanish, French, Portuguese, and
isiZulu. Use the language switcher in the top corner of the sign-in page or
your account settings to change it — the whole interface updates
immediately, no need to sign out.

---

## 11. Frequently asked questions

**Can I reorder pillars, objectives, or activities?**
Yes — most lists support manual reordering; new items are added to the end
by default.

**What happens if I delete a plan?**
It's soft-deleted — recoverable by an org admin on request, not
permanently gone the instant you click delete. Every activity in the plan
is removed along with it.

**Can a Contributor create new activities?**
No — Contributors can only update activities they're personally assigned
to (status, KPI progress, notes). Creating pillars, objectives, or new
activities requires Planner or Org Admin.

**I only see some of the organisation's plans as a Viewer — is that a bug?**
No — an org admin can grant Viewer access to specific plans rather than
the whole organisation. If you have at least one specific grant, you'll
only see the plans you've been granted; if you have none, you see
everything (an "org-wide" viewer). Ask your org admin if you're missing
one you expect to see.

**Where did the "P1/P2/P3" plan type go?**
It's been retired — see the note in [section 1](#1-what-stratplan-is).
Every plan now uses the Strategic Pillar structure, and anything that used
to be a fixed phase-model-only activity type now lives in the optional
[Advanced Research](#chapter-7--advanced-research-optional) chapter
instead.