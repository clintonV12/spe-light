// models_advanced_research.go — vocabulary for the "Advanced Research" tab
// (migration 014_collapse_plan_types).
//
// Every plan now uses the single (formerly "local") Strategic
// Pillar > Strategic Objective > Activity structure. Advanced Research is an
// optional, plan-level bucket of activities that sit alongside that
// structure (ObjectiveID nil, Category = ActivityCategoryAdvancedResearch —
// see Activity in models.go) rather than nesting under a pillar/objective.
//
// It exists to carry the handful of things the old "international" plan
// type could express that nothing in the pillar/objective/chapter structure
// covers. Anything that already has a home elsewhere was deliberately left
// out:
//   - vision_mission      → Plan.Vision / Plan.Mission (chapter 2)
//   - swot                → SWOTItem (chapter 3)
//   - pestle               → PESTELItem (chapter 3)
//   - strategic_objectives → StrategicObjective (chapters 4/5)
//   - kpi_framework        → Activity.KPIs, already tracked per activity
//   - action_items         → ordinary objective-attached activities
package models

// AdvancedResearchType is the fixed set of activity types allowed for an
// Advanced Research activity (Activity.Category ==
// ActivityCategoryAdvancedResearch). Unlike the free-text Type used for
// ordinary objective-attached activities, these are validated server-side
// (see plansvc.validateAdvancedResearchType) because they're the only thing
// distinguishing one Advanced Research activity from another — there's no
// pillar/objective title to fall back on.
type AdvancedResearchType string

const (
	ARTypeBusinessModelCanvas  AdvancedResearchType = "business_model_canvas"
	ARTypeCompetitiveAnalysis  AdvancedResearchType = "competitive_analysis"
	ARTypeRiskRegister         AdvancedResearchType = "risk_register"
	ARTypeFinancialProjections AdvancedResearchType = "financial_projections"
	ARTypeOperationalRoadmap   AdvancedResearchType = "operational_roadmap"
	ARTypeResourcePlan         AdvancedResearchType = "resource_plan"
	ARTypeBudgetAllocation     AdvancedResearchType = "budget_allocation"
)

// ValidAdvancedResearchTypes is the ordered set of Advanced Research
// activity types, in display order.
var ValidAdvancedResearchTypes = []AdvancedResearchType{
	ARTypeBusinessModelCanvas,
	ARTypeCompetitiveAnalysis,
	ARTypeRiskRegister,
	ARTypeFinancialProjections,
	ARTypeOperationalRoadmap,
	ARTypeResourcePlan,
	ARTypeBudgetAllocation,
}

// Valid reports whether t is one of ValidAdvancedResearchTypes.
func (t AdvancedResearchType) Valid() bool {
	for _, v := range ValidAdvancedResearchTypes {
		if t == v {
			return true
		}
	}
	return false
}
