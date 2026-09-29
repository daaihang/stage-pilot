const REVIEW_RECOMMENDATIONS = new Set(["recommend", "do_not_recommend", "no_opinion"]);
const DECIDABLE_ENTRY_STATUSES = new Set(["submitted", "in_review", "needs_changes", "accepted", "waitlisted", "rejected"]);
const DECIDED_REVIEW_RUN_STATUSES = new Set(["decided", "legacy_override_decided"]);

export function getReviewTaskListState({ loading, error, items }) {
  if (loading) return "loading";
  if (error) return "error";
  return items?.length ? "items" : "empty";
}

export function validateReviewFeedback({ recommendation, comment }) {
  const recommendationValid = REVIEW_RECOMMENDATIONS.has(recommendation);
  const commentValid = typeof comment === "string" && comment.trim().length > 0;
  return {
    valid: recommendationValid && commentValid,
    recommendationValid,
    commentValid,
  };
}

export function canEditReviewFeedback({ canSubmit, busy }) {
  return Boolean(canSubmit && !busy);
}

export function getEntryReviewDecisionState({ canDecide, entryStatus, reviewStatus, hasDecision, processingMode }) {
  const entryDecidable = DECIDABLE_ENTRY_STATUSES.has(entryStatus);
  if (processingMode === "COLLECT_ONLY") {
    return {
      entryDecidable,
      runReady: false,
      legacyRequired: false,
      canSubmitDecision: false,
      quorumPending: false,
      reasonRequired: false,
    };
  }
  if (processingMode === "DIRECT_MANUAL_DECISION") {
    return {
      entryDecidable,
      runReady: false,
      legacyRequired: false,
      canSubmitDecision: Boolean(canDecide && entryDecidable),
      quorumPending: false,
      reasonRequired: false,
    };
  }
  if (processingMode === "AUTO_ACCEPT") {
    return {
      entryDecidable,
      runReady: false,
      legacyRequired: false,
      canSubmitDecision: Boolean(canDecide && entryDecidable && hasDecision),
      quorumPending: false,
      reasonRequired: true,
    };
  }
  const runReady = reviewStatus === "ready_for_decision" || DECIDED_REVIEW_RUN_STATUSES.has(reviewStatus);
  const legacyRequired = !reviewStatus || reviewStatus === "blocked_unsupported";
  const canSubmitDecision = Boolean(canDecide && entryDecidable && (runReady || hasDecision || legacyRequired));
  return {
    entryDecidable,
    runReady,
    legacyRequired,
    canSubmitDecision,
    quorumPending: Boolean(canDecide && entryDecidable && reviewStatus && !runReady && !hasDecision && !legacyRequired),
    reasonRequired: legacyRequired,
  };
}
