// flexdate.go — a JSON date type that accepts both RFC3339 timestamps and
// bare "YYYY-MM-DD" date strings.
//
// Why this exists: CreatePlanRequest/UpdatePlanRequest.StartDate/EndDate and
// CreateActivityRequest/UpdateActivityRequest.DueDate were all *time.Time,
// which uses the standard library's JSON unmarshaler — that only accepts
// RFC3339 (e.g. "2026-07-19T00:00:00Z"). The frontend's <input type="date">
// elements send date-only strings (e.g. "2026-07-19"), which RFC3339 parsing
// rejects with "cannot parse \"\" as \"T\"". FlexDate tries RFC3339 first,
// then falls back to a date-only parse, so both forms work.
package plansvc

import (
	"encoding/json"
	"fmt"
	"time"
)

// FlexDate wraps time.Time with a permissive JSON unmarshaler.
type FlexDate struct {
	time.Time
}

// UnmarshalJSON accepts a JSON string in RFC3339 or "2006-01-02" format.
func (d *FlexDate) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("date must be a JSON string: %w", err)
	}
	if s == "" {
		d.Time = time.Time{}
		return nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		d.Time = t
		return nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		d.Time = t
		return nil
	}
	return fmt.Errorf("invalid date %q: expected RFC3339 or YYYY-MM-DD", s)
}

// MarshalJSON re-emits as a normal RFC3339 timestamp.
func (d FlexDate) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.Time)
}

// ToTimePtr converts a possibly-nil *FlexDate to a *time.Time for storage,
// so callers building models.Plan/models.Activity don't need to care about
// the request-layer type.
func (d *FlexDate) ToTimePtr() *time.Time {
	if d == nil {
		return nil
	}
	t := d.Time
	return &t
}
