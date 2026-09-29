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
		{intakeDirectManualDecision, intakeProcessingContract{EntryStatus: "submitted", DecisionPermission: campaignDecide, CapacityCheck: "decision", Executable: true}},
		{intakeSingleRoundDecision, intakeProcessingContract{EntryStatus: "in_review", ReviewPermission: campaignReview, DecisionPermission: campaignDecide, CapacityCheck: "decision", CreatesReviewRun: true, Executable: true}},
		{intakeAutoAccept, intakeProcessingContract{EntryStatus: "accepted", DecisionPermission: campaignDecide, CapacityCheck: "submit", CreatesDecision: true, Executable: true}},
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

func TestAllImplementedIntakeModesAreExecutable(t *testing.T) {
	for _, mode := range []string{intakeCollectOnly, intakeDirectManualDecision, intakeSingleRoundDecision, intakeAutoAccept} {
		if err := validateIntakeProcessingMode(mode); err != nil {
			t.Fatalf("mode %q should be executable: %v", mode, err)
		}
	}
	if err := validateIntakeProcessingMode("UNKNOWN"); err == nil {
		t.Fatal("unknown mode accepted by publisher")
	}

	workflow, _ := json.Marshal(map[string]any{"schema_version": 1, "mode": intakeAutoAccept, "rounds": []any{}, "final_decision": "auto_accept"})
	for _, mode := range []string{intakeCollectOnly, intakeDirectManualDecision, intakeAutoAccept} {
		if reason := publicSubmissionUnavailableReason(mode, json.RawMessage(`{}`), json.RawMessage(`{"fields":[]}`), workflow); reason != "" {
			t.Fatalf("mode %s should ignore dormant review snapshot: %q", mode, reason)
		}
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
