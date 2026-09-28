export function isExecutableSingleRoundWorkflow(workflow) {
  if (workflow?.schema_version !== 1 || workflow.mode !== "MANUAL_DECISION" || workflow.final_decision !== "manual"
    || workflow.request_changes?.enabled !== false || workflow.rounds?.length !== 1) return false;
  const round = workflow.rounds[0];
  return round.execution === "parallel"
    && round.feedback?.kind === "binary"
    && !round.scorecard?.criteria?.length
    && ["all", "any", "at_least_n"].includes(round.completion?.mode)
    && (round.completion?.mode !== "at_least_n" || Number.isInteger(round.completion.n) && round.completion.n > 0)
    && ["explicit_members", "production_roles"].includes(round.reviewer_policy?.source);
}

export function publishedExecutableRecipes(recipes, versionsById) {
  return recipes.filter((recipe) => recipe.scope === "system" && recipe.status === "published"
    && recipe.publishedVersionId && isExecutableSingleRoundWorkflow(versionsById[recipe.publishedVersionId]?.definition));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function reviewWorkflowCustomized(workflow, publishedDefinition) {
  if (!workflow || !publishedDefinition) return false;
  return JSON.stringify(stableValue(workflow)) !== JSON.stringify(stableValue(publishedDefinition));
}
