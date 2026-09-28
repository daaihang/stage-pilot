package main

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestSingleRoundReviewWorkflowContract(t *testing.T) {
	valid := func(completion string, feedback string, changes bool, rounds int) json.RawMessage {
		body := `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"screen","name":"初审","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":["member-a"],"role_keys":[]},"completion":` + completion + `,"feedback":{"kind":"` + feedback + `"}}],"request_changes":{"enabled":` + map[bool]string{true: "true", false: "false"}[changes] + `,"target":"same_round"},"final_decision":"manual"}`
		if rounds == 2 {
			body = `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"a","name":"A","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":["member-a"],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}},{"key":"b","name":"B","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":["member-a"],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}}],"request_changes":{"enabled":false},"final_decision":"manual"}`
		}
		return json.RawMessage(body)
	}
	tests := []struct {
		name string
		raw  json.RawMessage
		want bool
	}{
		{"all", valid(`{"mode":"all"}`, "binary", false, 1), true},
		{"at least N", valid(`{"mode":"at_least_n","n":2}`, "binary", false, 1), true},
		{"any compatibility", valid(`{"mode":"any"}`, "binary", false, 1), true},
		{"multi-round", valid(`{"mode":"all"}`, "binary", false, 2), false},
		{"score", valid(`{"mode":"all"}`, "score", false, 1), false},
		{"request changes", valid(`{"mode":"all"}`, "binary", true, 1), false},
		{"auto accept", json.RawMessage(`{"schema_version":1,"mode":"AUTO_ACCEPT","rounds":[],"request_changes":{"enabled":false},"final_decision":"auto_accept"}`), false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateSingleRoundReviewWorkflow(test.raw)
			if (err == nil) != test.want {
				t.Fatalf("validateSingleRoundReviewWorkflow() error = %v, wantValid=%v", err, test.want)
			}
		})
	}
}

func TestReusableTemplateWorkflowRequiresSupportedModeButMayLeaveReviewersUnbound(t *testing.T) {
	unbound := json.RawMessage(`{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"review","name":"单轮审核","execution":"parallel","reviewer_policy":{"source":"production_roles","member_ids":[],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}}],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"manual"}`)
	if err := validateReusableSingleRoundReviewWorkflow(unbound); err != nil {
		t.Fatalf("unbound reusable template workflow should be valid: %v", err)
	}
	unsupported := json.RawMessage(`{"schema_version":1,"mode":"AUTO_ACCEPT","rounds":[],"request_changes":{"enabled":false},"final_decision":"auto_accept"}`)
	if err := validateReusableSingleRoundReviewWorkflow(unsupported); err == nil {
		t.Fatal("unsupported workflow mode must not publish as a reusable template")
	}
}

func TestReviewCompletionThreshold(t *testing.T) {
	anyRound := reviewRecipeRound{Completion: reviewRecipeCompletion{Mode: "any"}}
	if mode, required := reviewCompletion(anyRound, 7); mode != "at_least_n" || required != 1 {
		t.Fatalf("any completion = %q/%d, want at_least_n/1", mode, required)
	}
	allRound := reviewRecipeRound{Completion: reviewRecipeCompletion{Mode: "all"}}
	if mode, required := reviewCompletion(allRound, 4); mode != "all" || required != 4 {
		t.Fatalf("all completion = %q/%d, want all/4", mode, required)
	}
	if mode, required := reviewCompletion(allRound, 0); mode != "all" || required != 1 {
		t.Fatalf("empty all completion = %q/%d, want a safe positive threshold", mode, required)
	}
	n := 3
	nRound := reviewRecipeRound{Completion: reviewRecipeCompletion{Mode: "at_least_n", N: &n}}
	if mode, required := reviewCompletion(nRound, 5); mode != "at_least_n" || required != 3 {
		t.Fatalf("at_least_n completion = %q/%d, want at_least_n/3", mode, required)
	}
}

func TestNormalizeReviewFeedback(t *testing.T) {
	for _, recommendation := range []string{"recommend", "do_not_recommend", "no_opinion"} {
		gotRecommendation, gotComment, err := normalizeReviewFeedback(recommendation, "  有依据的审核意见  ")
		if err != nil || gotRecommendation != recommendation || gotComment != "有依据的审核意见" {
			t.Fatalf("normalize %q = %q/%q, %v", recommendation, gotRecommendation, gotComment, err)
		}
	}
	for _, test := range []struct{ recommendation, comment string }{{"unknown", "意见"}, {"recommend", "  "}, {"no_opinion", string(make([]byte, 5001))}} {
		if _, _, err := normalizeReviewFeedback(test.recommendation, test.comment); !errors.Is(err, errReviewFeedbackInvalid) {
			t.Fatalf("normalize invalid feedback = %v", err)
		}
	}
}

func TestCampaignReviewPermissionsAreSeparated(t *testing.T) {
	for _, role := range []string{"producer", "editor", "stage_manager", "contributor", "viewer"} {
		permissions := map[string]bool{}
		for _, permission := range productionRolePermissions[role] {
			permissions[permission] = true
		}
		if !permissions[campaignReview] {
			t.Errorf("%s should be able to review assigned tasks", role)
		}
		if permissions[campaignMaterialize] {
			t.Errorf("%s must not implicitly receive materialize", role)
		}
	}
	for _, role := range []string{"producer", "editor"} {
		permissions := map[string]bool{}
		for _, permission := range productionRolePermissions[role] {
			permissions[permission] = true
		}
		if !permissions[campaignManage] || !permissions[campaignDecide] {
			t.Errorf("%s should manage assignments and make decisions", role)
		}
	}
	for _, role := range []string{"stage_manager", "contributor", "viewer"} {
		permissions := map[string]bool{}
		for _, permission := range productionRolePermissions[role] {
			permissions[permission] = true
		}
		if permissions[campaignManage] || permissions[campaignDecide] {
			t.Errorf("%s must not manage review or decide", role)
		}
	}
}
