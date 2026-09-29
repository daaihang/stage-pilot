import test from "node:test";
import assert from "node:assert/strict";
import {
  canEditReviewFeedback,
  getEntryReviewDecisionState,
  getReviewTaskListState,
  validateReviewFeedback,
} from "./campaign-review-ui-state.js";

test("review task list distinguishes loading, errors, empty results, and items", () => {
  assert.equal(getReviewTaskListState({ loading: true, error: "failed", items: [] }), "loading");
  assert.equal(getReviewTaskListState({ loading: false, error: "failed", items: [] }), "error");
  assert.equal(getReviewTaskListState({ loading: false, error: null, items: [] }), "empty");
  assert.equal(getReviewTaskListState({ loading: false, error: null, items: [{ id: "task-1" }] }), "items");
});

test("review feedback requires a supported recommendation and non-empty comment", () => {
  assert.deepEqual(validateReviewFeedback({ recommendation: "recommend", comment: "  有依据  " }), {
    valid: true,
    recommendationValid: true,
    commentValid: true,
  });
  assert.equal(validateReviewFeedback({ recommendation: "unknown", comment: "意见" }).valid, false);
  assert.equal(validateReviewFeedback({ recommendation: "no_opinion", comment: "  " }).commentValid, false);
});

test("review feedback is editable only while the assigned task accepts feedback and is not saving", () => {
  assert.equal(canEditReviewFeedback({ canSubmit: true, busy: false }), true);
  assert.equal(canEditReviewFeedback({ canSubmit: false, busy: false }), false);
  assert.equal(canEditReviewFeedback({ canSubmit: true, busy: true }), false);
});

test("entry decisions require permission and a ready review quorum", () => {
  assert.equal(getEntryReviewDecisionState({ canDecide: false, entryStatus: "in_review", reviewStatus: "ready_for_decision" }).canSubmitDecision, false);
  assert.equal(getEntryReviewDecisionState({ canDecide: true, entryStatus: "in_review", reviewStatus: "collecting_feedback" }).quorumPending, true);
  assert.equal(getEntryReviewDecisionState({ canDecide: true, entryStatus: "in_review", reviewStatus: "ready_for_decision" }).canSubmitDecision, true);
  assert.equal(getEntryReviewDecisionState({ canDecide: true, entryStatus: "withdrawn", reviewStatus: "ready_for_decision" }).canSubmitDecision, false);
});

test("prior decisions can be corrected; only unsupported or absent runs need legacy override", () => {
  assert.equal(getEntryReviewDecisionState({ canDecide: true, entryStatus: "accepted", reviewStatus: "decided", hasDecision: true }).canSubmitDecision, true);
  assert.equal(getEntryReviewDecisionState({ canDecide: true, entryStatus: "submitted", reviewStatus: "blocked_unsupported" }).legacyRequired, true);
  assert.equal(getEntryReviewDecisionState({ canDecide: true, entryStatus: "submitted", reviewStatus: null }).legacyRequired, true);
  assert.equal(getEntryReviewDecisionState({ canDecide: true, entryStatus: "submitted", reviewStatus: "collecting_feedback" }).legacyRequired, false);
});

test("collect-only entries never expose decisions or legacy override", () => {
  const state = getEntryReviewDecisionState({
    canDecide: true,
    entryStatus: "submitted",
    reviewStatus: null,
    hasDecision: false,
    processingMode: "COLLECT_ONLY",
  });
  assert.equal(state.canSubmitDecision, false);
  assert.equal(state.legacyRequired, false);
  assert.equal(state.quorumPending, false);
});
