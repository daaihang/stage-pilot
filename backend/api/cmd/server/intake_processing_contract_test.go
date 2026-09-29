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
		{intakeCollectOnly, intakeProcessingContract{EntryStatus: "submitted", CapacityCheck: "none", Executable: true}},
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

func TestOnlyCollectAndSingleRoundAreExecutable(t *testing.T) {
	for _, mode := range []string{intakeCollectOnly, intakeSingleRoundDecision} {
		if err := validateIntakeProcessingMode(mode); err != nil {
			t.Fatalf("mode %q should be executable: %v", mode, err)
		}
	}
	for _, mode := range []string{intakeDirectManualDecision, intakeAutoAccept, "UNKNOWN"} {
		t.Run(mode, func(t *testing.T) {
			if err := validateIntakeProcessingMode(mode); err == nil {
				t.Fatal("unimplemented or unknown mode accepted by publisher")
			}
		})
	}

	workflow, _ := json.Marshal(map[string]any{"schema_version": 1, "mode": intakeAutoAccept, "rounds": []any{}, "final_decision": "auto_accept"})
	if reason := publicSubmissionUnavailableReason(intakeAutoAccept, json.RawMessage(`{}`), json.RawMessage(`{"fields":[]}`), workflow); reason != "processing_mode_unavailable" {
		t.Fatalf("auto accept public gate = %q", reason)
	}
	if reason := publicSubmissionUnavailableReason(intakeSingleRoundDecision, json.RawMessage(`{}`), json.RawMessage(`{"fields":[]}`), workflow); reason != "auto_accept_unavailable" {
		t.Fatalf("auto-accept review recipe must not run as manual decision: %q", reason)
	}
	collectReview := map[string]any{}
	if err := json.Unmarshal(defaultSingleRoundReviewRecipe(), &collectReview); err != nil {
		t.Fatal(err)
	}
	collectReview["mode"] = intakeCollectOnly
	collectReviewRaw, _ := json.Marshal(collectReview)
	if err := validateSingleRoundReviewWorkflow(collectReviewRaw); err == nil {
		t.Fatal("COLLECT_ONLY must not be accepted as a review workflow mode")
	}
}

func TestLegacyProcessingModeInferenceIsSafe(t *testing.T) {
	if got := normalizeIntakeProcessingMode("", json.RawMessage(`{"mode":"COLLECT_ONLY"}`)); got != intakeCollectOnly {
		t.Fatalf("legacy collect workflow inferred as %q", got)
	}
	if got := normalizeIntakeProcessingMode("", json.RawMessage(`{"mode":"MANUAL_DECISION"}`)); got != intakeSingleRoundDecision {
		t.Fatalf("manual workflow inferred as %q", got)
	}
	if got := normalizeIntakeProcessingMode("", json.RawMessage(`{"mode":"UNKNOWN"}`)); got != intakeSingleRoundDecision {
		t.Fatalf("unknown legacy workflow should fail safe to manual, got %q", got)
	}
	if got := normalizeIntakeProcessingMode(intakeCollectOnly, json.RawMessage(`{"mode":"MANUAL_DECISION"}`)); got != intakeCollectOnly {
		t.Fatalf("explicit processing mode was overridden by dormant workflow: %q", got)
	}
}
