export function publicCampaignDraftKey(token, short, revisionId) {
  return `stagepilot:campaign-draft:${short ? "short" : "long"}:${token}:${revisionId}`;
}

export function buildPublicCampaignSubmissionPayload(expectedRevisionId, answers) {
  const revisionId = String(expectedRevisionId || "").trim();
  if (!revisionId) throw new TypeError("expectedRevisionId is required");
  return {
    expected_revision_id: revisionId,
    answers: answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {},
  };
}
