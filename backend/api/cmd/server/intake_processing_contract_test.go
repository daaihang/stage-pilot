package main

import (
	"encoding/json"
	"testing"
)

func TestIntakeProcessingModeContracts(t *testing.T) {
	tests := []struct {
		mode string
		want intakeProcessingContract
	}{
		{intakeCollectOnly, intakeProcessingContract{EntryStatus: "submitted", CapacityCheck: "none"}},
		{intakeDirectManualDecision, intakeProcessingContract{EntryStatus: "submitted", DecisionPermission: campaignDecide, CapacityCheck: "decision"}},
		{intakeSingleRoundDecision, intakeProcessingContract{EntryStatus: "in_review", ReviewPermission: campaignReview, DecisionPermission: campaignDecide, CapacityCheck: "decision", CreatesReviewRun: true, Executable: true}},
		{intakeAutoAccept, intakeProcessingContract{EntryStatus: "accepted", DecisionPermission: campaignDecide, CapacityCheck: "submit", CreatesDecision: true}},
	}
	if len(intakeProcessingContracts) != len(tests) {
		t.Fatalf("contracts = %d, want %d", len(intakeProcessingContracts), len(tests))
	}
	for _, tc := range tests {
		t.Run(tc.mode, func(t *testing.T) {
			got, exists := intakeProcessingContracts[tc.mode]
			if !exists || got != tc.want {
				t.Fatalf("contract = %#v, want %#v", got, tc.want)
			}
			if executableIntakeProcessingMode(tc.mode) != tc.want.Executable {
				t.Fatalf("executable mode = %t", executableIntakeProcessingMode(tc.mode))
			}
		})
	}
}

func TestFutureIntakeModesFailClosedAtPublishAndPublicGate(t *testing.T) {
	for _, mode := range []string{intakeCollectOnly, intakeDirectManualDecision, intakeAutoAccept} {
		t.Run(mode, func(t *testing.T) {
			workflow := map[string]any{"schema_version": 1, "mode": mode, "rounds": []any{}, "request_changes": map[string]any{"enabled": false, "target": "same_round"}}
			if mode == intakeAutoAccept {
				workflow["final_decision"] = "auto_accept"
			} else {
				workflow["final_decision"] = "manual"
			}
			raw, _ := json.Marshal(workflow)
			if err := validateSingleRoundReviewWorkflow(raw); err == nil {
				t.Fatal("unimplemented mode accepted by publisher")
			}
			if reason := publicSubmissionUnavailableReason(json.RawMessage(`{}`), json.RawMessage(`{"fields":[]}`), raw); reason == "" {
				t.Fatal("unimplemented mode accepted by public endpoint")
			}
		})
	}
}
