import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicCampaignSubmissionPayload, publicCampaignDraftKey } from "./campaign-public-submission.js";

test("public submission payload binds answers to the expected published revision", () => {
  assert.deepEqual(buildPublicCampaignSubmissionPayload(" revision-12 ", { name: "Lin" }), {
    expected_revision_id: "revision-12",
    answers: { name: "Lin" },
  });
  assert.throws(() => buildPublicCampaignSubmissionPayload("", {}), /expectedRevisionId/);
});

test("public form drafts are isolated by link kind and revision", () => {
  const first = publicCampaignDraftKey("share", false, "revision-1");
  assert.notEqual(first, publicCampaignDraftKey("share", false, "revision-2"));
  assert.notEqual(first, publicCampaignDraftKey("share", true, "revision-1"));
});
