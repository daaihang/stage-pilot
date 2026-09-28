import assert from "node:assert/strict";
import test from "node:test";
import { isExecutableSingleRoundWorkflow, isReviewCatalogDefaultSelectable, publishedExecutableRecipes, reviewWorkflowCustomized, updateReviewCatalogSelection } from "./review-workflow-options.js";

const workflow = {
  schema_version: 1, mode: "MANUAL_DECISION",
  rounds: [{ key: "review", name: "单轮审核", execution: "parallel", reviewer_policy: { source: "explicit_members", member_ids: [], role_keys: [] }, completion: { mode: "all" }, feedback: { kind: "binary" } }],
  request_changes: { enabled: false, target: "same_round" }, final_decision: "manual",
};

test("only published executable system recipe versions are selectable", () => {
  const recipes = [
    { id: "manual", scope: "system", status: "published", publishedVersionId: "v2", latestVersionId: "draft-v3" },
    { id: "auto", scope: "system", status: "archived", publishedVersionId: "auto-v1" },
    { id: "workspace", scope: "workspace", status: "published", publishedVersionId: "ws-v1" },
    { id: "broken", scope: "system", status: "published", publishedVersionId: "broken-v1" },
  ];
  const versions = { v2: { definition: workflow }, "auto-v1": { definition: { mode: "AUTO_ACCEPT" } }, "ws-v1": { definition: workflow }, "broken-v1": { definition: { ...workflow, request_changes: { enabled: true } } } };
  assert.deepEqual(publishedExecutableRecipes(recipes, versions).map((recipe) => recipe.id), ["manual"]);
  assert.equal(isExecutableSingleRoundWorkflow({ ...workflow, rounds: [{ ...workflow.rounds[0], feedback: { kind: "score" } }] }), false);
  assert.equal(isExecutableSingleRoundWorkflow({ ...workflow, rounds: [...workflow.rounds, workflow.rounds[0]] }), false);
});

test("activity-level reviewer changes are reported without mutating source definition", () => {
  assert.equal(reviewWorkflowCustomized(structuredClone(workflow), workflow), false);
  const customized = structuredClone(workflow);
  customized.rounds[0].reviewer_policy.member_ids.push("reviewer-1");
  assert.equal(reviewWorkflowCustomized(customized, workflow), true);
  assert.deepEqual(workflow.rounds[0].reviewer_policy.member_ids, []);
});

test("workspace review catalog always retains an enabled default", () => {
  assert.deepEqual(updateReviewCatalogSelection(["single_manual"], "single_manual", "single_manual", false), {
    changed: false,
    enabledKeys: ["single_manual"],
    defaultKey: "single_manual",
  });
  assert.deepEqual(updateReviewCatalogSelection(["parallel", "single_manual"], "single_manual", "single_manual", false), {
    changed: true,
    enabledKeys: ["parallel"],
    defaultKey: "parallel",
  });
  assert.equal(isReviewCatalogDefaultSelectable(["parallel"], "parallel"), true);
  assert.equal(isReviewCatalogDefaultSelectable(["parallel"], "single_manual"), false);
});
