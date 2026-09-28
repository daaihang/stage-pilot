package main

// Processing modes describe the outcome of a new public submission. Only the
// single-round manual mode has a runtime in P1; these other identifiers are
// deliberately not accepted by the publisher or exposed as catalog choices.
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
	intakeCollectOnly:          {EntryStatus: "submitted", CapacityCheck: "none"},
	intakeDirectManualDecision: {EntryStatus: "submitted", DecisionPermission: campaignDecide, CapacityCheck: "decision"},
	intakeSingleRoundDecision:  {EntryStatus: "in_review", ReviewPermission: campaignReview, DecisionPermission: campaignDecide, CapacityCheck: "decision", CreatesReviewRun: true, Executable: true},
	intakeAutoAccept:           {EntryStatus: "accepted", DecisionPermission: campaignDecide, CapacityCheck: "submit", CreatesDecision: true},
}

func executableIntakeProcessingMode(mode string) bool {
	contract, exists := intakeProcessingContracts[mode]
	return exists && contract.Executable
}
