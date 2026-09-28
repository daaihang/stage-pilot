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

export function selectableReviewRecipes(items = []) {
  return items.filter((recipe) => recipe?.scope === "system"
    && recipe.status === "published"
    && recipe.enabled !== false
    && recipe.publishedVersionId
    && isExecutableSingleRoundWorkflow(recipe.publishedDefinition));
}

export function reviewRecipeSourceFromCatalogItem(recipe) {
  if (!recipe?.publishedVersionId) return null;
  return {
    versionId: recipe.publishedVersionId,
    key: recipe.key,
    name: recipe.name,
    version: recipe.publishedVersion,
    definition: recipe.publishedDefinition || {},
    publishedAt: recipe.publishedAt || null,
    isCurrent: true,
    enabled: recipe.enabled !== false,
  };
}

export function resolveReviewRecipeSource(versionId, items = [], savedSource = null) {
  if (!versionId) return null;
  const current = items.find((recipe) => recipe.publishedVersionId === versionId);
  if (current) return reviewRecipeSourceFromCatalogItem(current);
  return savedSource?.versionId === versionId ? savedSource : null;
}

export function shouldConfirmReviewRecipeChange({ customized, currentVersionId, nextVersionId }) {
  return Boolean(customized && nextVersionId && currentVersionId !== nextVersionId);
}

export function reviewRecipeSourceStatus(source) {
  if (!source) return "来源信息不可用";
  if (source.enabled === false) return "来源方案已停用，需改选后才能发布";
  return source.isCurrent ? "当前发布版本" : "历史发布版本（保留原快照）";
}

export function updateReviewCatalogSelection(enabledKeys, defaultKey, key, checked) {
  const next = new Set(enabledKeys || []);
  if (checked) next.add(key);
  else next.delete(key);
  const nextKeys = [...next].sort();
  if (!nextKeys.length) return { changed: false, enabledKeys: [...(enabledKeys || [])], defaultKey };
  return {
    changed: true,
    enabledKeys: nextKeys,
    defaultKey: next.has(defaultKey) ? defaultKey : nextKeys[0],
  };
}

export function isReviewCatalogDefaultSelectable(enabledKeys, key) {
  return Array.isArray(enabledKeys) && enabledKeys.includes(key);
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
