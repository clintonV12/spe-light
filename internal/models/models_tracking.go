// models_tracking.go — shared vocabulary for the Tracking Module.
//
// An earlier revision of this file defined standalone TrackedKPI/
// KPIMeasurement types backed by their own `kpis`/`kpi_measurements`
// tables, entered independently of any activity. That's been superseded:
// the Tracking Module now tracks the KPIs that already live on
// Activity.KPIs (models.go) — the ones a planner sets when creating an
// activity under a Strategic Pillar — rather than a second, disconnected
// KPI list. See migration 012_activity_kpi_tracking for the cleanup (drops
// the old kpis/kpi_measurements tables, adds a CHECK constraint enforcing
// Activity.TargetPeriod is one of ValidKPIPeriods).
//
// What's left here is just the small shared vocabulary both models.KPI and
// Activity.TargetPeriod are typed against.
package models

// KPIDirection controls how a KPI's achievement percentage should be
// derived from its Target/Actual pair. "increase" is for KPIs where a
// higher Actual is better (e.g. revenue growth); "decrease" is for KPIs
// where a lower Actual is better (e.g. defect rate).
type KPIDirection string

const (
	KPIDirectionIncrease KPIDirection = "increase"
	KPIDirectionDecrease KPIDirection = "decrease"
)

// KPIPeriod is the reporting cadence a local-plan activity (and therefore
// all of its KPIs) is tracked against — see Activity.TargetPeriod.
// Deliberately a checked string (validated against ValidKPIPeriods) rather
// than a hardcoded fixed set baked into call sites, so a fourth period
// (e.g. "weekly") can be added later by extending this one slice plus the
// DB CHECK constraint, without touching either table.
type KPIPeriod string

const (
	KPIPeriodMonthly   KPIPeriod = "monthly"
	KPIPeriodQuarterly KPIPeriod = "quarterly"
	KPIPeriodAnnual    KPIPeriod = "annual"
)

// ValidKPIPeriods is the ordered set of periods the Tracking Module
// currently supports, in display order.
var ValidKPIPeriods = []KPIPeriod{KPIPeriodMonthly, KPIPeriodQuarterly, KPIPeriodAnnual}

// Valid reports whether p is one of ValidKPIPeriods.
func (p KPIPeriod) Valid() bool {
	for _, v := range ValidKPIPeriods {
		if p == v {
			return true
		}
	}
	return false
}
