package main

import "encoding/json"

// Processing modes describe what happens after a public submission. Only
// collection-only, direct manual decisions, single-round review, and automatic
// acceptance currently execute.
const (
	intakeCollectOnly          = "COLLECT_ONLY"
	intakeDirectManualDecision = "DIRECT_MANUAL_DECISION"
	intakeSingleRoundDecision  = "MANUAL_DECISION"
	intakeAutoAccept           = "AUTO_ACCEPT"
)

type intakeProcessingContract struct {
	EntryStatus        string
	ReviewPermission   string
	DecisionPermission string
	CapacityCheck      string // none, decision, or submit
	CreatesReviewRun   bool
	CreatesDecision    bool
	Executable         bool
}

var intakeProcessingContracts = map[string]intakeProcessingContract{
	intakeCollectOnly:          {EntryStatus: "submitted", CapacityCheck: "none", Executable: true},
	intakeDirectManualDecision: {EntryStatus: "submitted", DecisionPermission: campaignDecide, CapacityCheck: "decision", Executable: true},
	intakeSingleRoundDecision:  {EntryStatus: "in_review", ReviewPermission: campaignReview, DecisionPermission: campaignDecide, CapacityCheck: "decision", CreatesReviewRun: true, Executable: true},
	intakeAutoAccept:           {EntryStatus: "accepted", DecisionPermission: campaignDecide, CapacityCheck: "submit", CreatesDecision: true, Executable: true},
}

func executableIntakeProcessingMode(mode string) bool {
	contract, exists := intakeProcessingContracts[mode]
	return exists && contract.Executable
}

func knownIntakeProcessingMode(mode string) bool {
	_, exists := intakeProcessingContracts[mode]
	return exists
}

func inferIntakeProcessingMode(workflowRaw json.RawMessage) string {
	var workflow struct {
		Mode string `json:"mode"`
	}
	if len(workflowRaw) > 0 && json.Unmarshal(workflowRaw, &workflow) == nil && knownIntakeProcessingMode(workflow.Mode) {
		return workflow.Mode
	}
	return intakeSingleRoundDecision
}

func normalizeIntakeProcessingMode(mode string, workflowRaw json.RawMessage) string {
	if mode == "" {
		return inferIntakeProcessingMode(workflowRaw)
	}
	return mode
}

func validateIntakeProcessingMode(mode string) error {
	if !knownIntakeProcessingMode(mode) {
		return &formValidationError{"invalid_processing_mode", "表单处理方式无效"}
	}
	if !executableIntakeProcessingMode(mode) {
		return &formValidationError{"processing_mode_unavailable", "该表单处理方式暂未开放"}
	}
	return nil
}
