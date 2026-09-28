import { request } from "@/lib/auth";

function queryString(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function normalizeList(result) {
  if (Array.isArray(result)) return { items: result, total: result.length, nextCursor: null };
  return { items: result?.items || [], total: result?.total ?? result?.items?.length ?? 0, nextCursor: result?.next_cursor ?? null };
}

function mapStats(value) {
  if (!value) return null;
  return {
    totalEntries: value.total_entries ?? 0,
    submittedEntries: value.submitted_entries ?? 0,
    acceptedEntries: value.accepted_entries ?? 0,
    waitlistedEntries: value.waitlisted_entries ?? 0,
    convertedEntries: value.converted_entries ?? 0,
  };
}

function mapTemplate(value) {
  return {
    id: value.id,
    scope: value.scope,
    workspaceId: value.workspace_id,
    kind: value.kind,
    name: value.name,
    title: value.name,
    description: value.description || "",
    status: value.status,
    latestVersion: value.latest_version,
    publishedVersion: value.published_version,
    draftVersionId: value.draft_version_id,
    publishedVersionId: value.published_version_id,
    sourceTemplateId: value.source_template_id,
    sourceCampaignId: value.source_campaign_id,
    sourceCampaignRevisionId: value.source_campaign_revision_id,
    metadata: value.metadata || {},
    tags: value.metadata?.tags || [],
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function mapCampaignTemplateVersion(value) {
  if (!value) return null;
  return {
    id: value.id,
    templateId: value.template_id,
    workspaceId: value.workspace_id,
    version: value.version,
    status: value.status,
    definition: value.definition || {},
    reviewRecipeVersionId: value.review_recipe_version_id,
    reviewRecipeSource: mapReviewRecipeSource(value.review_recipe_source),
    createdBy: value.created_by,
    createdAt: value.created_at,
    publishedAt: value.published_at,
    etag: value.etag || "",
  };
}

function mapReviewRecipeSource(value) {
  if (!value) return null;
  return {
    versionId: value.version_id,
    key: value.key,
    name: value.name,
    version: value.version,
    definition: value.definition || {},
    publishedAt: value.published_at,
    isCurrent: Boolean(value.is_current),
    enabled: value.enabled == null ? null : Boolean(value.enabled),
  };
}

function mapFormVersion(value) {
  if (!value) return null;
  const rawPresentation = value.presentation || {};
  const welcome = rawPresentation.welcome || {};
  const ending = rawPresentation.ending || {};
  return {
    id: value.id,
    schemaVersion: value.schema_version,
    blocks: value.blocks || [],
    fields: value.fields || [],
    logicRules: value.logic_rules || [],
    presentation: {
      publicTitle: rawPresentation.public_title ?? rawPresentation.publicTitle ?? "",
      welcome: {
        enabled: Boolean(welcome.enabled),
        titleMode: welcome.title_mode ?? welcome.titleMode ?? "inherit",
        titleOverride: welcome.title_override ?? welcome.titleOverride ?? "",
        description: welcome.description || "",
        startLabel: welcome.start_label ?? welcome.startLabel ?? "开始填写",
      },
      ending: {
        mode: ending.mode || "default",
        title: ending.title || "",
        body: ending.body || "",
        redirectUrl: ending.redirect_url ?? ending.redirectUrl ?? "",
      },
    },
    endScreen: value.end_screen || {},
    createdAt: value.created_at,
  };
}

function wireFormVersion(value) {
  if (!value) return value;
  const presentation = value.presentation || {};
  const welcome = presentation.welcome || {};
  const ending = presentation.ending || {};
  return {
    schema_version: value.schema_version ?? value.schemaVersion ?? 1,
    blocks: value.blocks || [],
    fields: value.fields || [],
    logic_rules: value.logic_rules || value.logicRules || [],
    presentation: {
      public_title: presentation.public_title ?? presentation.publicTitle ?? "",
      welcome: {
        enabled: Boolean(welcome.enabled),
        title_mode: welcome.title_mode ?? welcome.titleMode ?? "inherit",
        title_override: welcome.title_override ?? welcome.titleOverride ?? "",
        description: welcome.description || "",
        start_label: welcome.start_label ?? welcome.startLabel ?? "开始填写",
      },
      ending: {
        mode: ending.mode || "default",
        title: ending.title || "",
        body: ending.body || "",
        redirect_url: ending.redirect_url ?? ending.redirectUrl ?? "",
      },
    },
    end_screen: value.end_screen || value.endScreen || {},
  };
}

function mapRevision(value) {
  if (!value) return null;
  return {
    id: value.id,
    campaignId: value.campaign_id,
    workspaceId: value.workspace_id,
    revisionNo: value.revision_no,
    status: value.status,
    formVersionId: value.form_version_id,
    reviewRecipeVersionId: value.review_recipe_version_id,
    reviewRecipeSource: mapReviewRecipeSource(value.review_recipe_source),
    availabilityPolicy: value.availability_policy || {},
    reviewWorkflow: value.review_workflow || {},
    materializationPlan: value.materialization_plan || {},
    changeNote: value.change_note || "",
    createdBy: value.created_by,
    createdAt: value.created_at,
    publishedAt: value.published_at,
    archivedAt: value.archived_at,
    etag: value.etag || "",
    formVersion: mapFormVersion(value.form_version),
  };
}

function revisionMutationOptions(options = {}) {
  const headers = {};
  const etag = options.etag || options.ifMatch;
  if (etag) headers["If-Match"] = etag;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  return Object.keys(headers).length ? { headers } : {};
}

function mapCampaign(value) {
  if (!value) return null;
  return {
    id: value.id,
    workspaceId: value.workspace_id,
    productionId: value.production_id,
    kind: value.kind,
    name: value.name,
    description: value.description || "",
    status: value.status,
    publicSlug: value.public_slug,
    publishedRevisionId: value.published_revision_id,
    sourceTemplateId: value.source_template_id,
    sourceTemplateVersion: value.source_template_version,
    createdBy: value.created_by,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    archivedAt: value.archived_at,
    stats: mapStats(value.stats),
  };
}

function mapInboxState(value) {
  return {
    isRead: Boolean(value?.is_read ?? value?.isRead),
    isStarred: Boolean(value?.is_starred ?? value?.isStarred),
  };
}

function mapEntry(value) {
  if (!value) return null;
  return {
    id: value.id,
    workspaceId: value.workspace_id,
    productionId: value.production_id,
    campaignId: value.campaign_id,
    campaignRevisionId: value.campaign_revision_id,
    status: value.status,
    contactEmail: value.contact_email || "",
    submittedAt: value.submitted_at,
    lastActivityAt: value.last_activity_at,
    currentRevisionNo: value.current_revision_no ?? 0,
    anonymized: Boolean(value.anonymized),
    anonymizedAt: value.anonymized_at,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function mapEntryInboxItem(value) {
  return {
    ...mapEntry(value),
    inboxState: mapInboxState(value?.inbox_state),
    flags: {
      anonymized: Boolean(value?.flags?.anonymized),
      needsChanges: Boolean(value?.flags?.needs_changes),
      conversionFailed: Boolean(value?.flags?.conversion_failed),
    },
  };
}

function mapEntryRevision(value) {
  if (!value) return null;
  return {
    id: value.id,
    revisionNo: value.revision_no,
    schemaVersion: value.schema_version,
    answers: value.answers || {},
    source: value.source,
    createdAt: value.created_at,
  };
}

function mapDecision(value) {
  if (!value) return null;
  return {
    id: value.id,
    type: value.type,
    reason: value.reason || "",
    decidedBy: value.decided_by,
    decidedAt: value.decided_at,
    metadata: value.metadata || {},
  };
}

function mapMaterialization(value) {
  return {
    id: value.id,
    decisionId: value.decision_id,
    targetKind: value.target_kind,
    operation: value.operation,
    status: value.status,
    idempotencyKey: value.idempotency_key,
    targetId: value.target_id,
    errorCode: value.error_code,
    errorMessage: value.error_message,
    createdAt: value.created_at,
    startedAt: value.started_at,
    completedAt: value.completed_at,
  };
}

function mapReviewFeedback(value) {
  if (!value) return null;
  return {
    id: value.id,
    taskId: value.task_id,
    reviewerId: value.reviewer_id,
    reviewerName: value.reviewer_name || "",
    recommendation: value.recommendation,
    comment: value.comment || "",
    supersedesFeedbackId: value.supersedes_feedback_id,
    isCurrent: Boolean(value.is_current),
    campaignRevisionId: value.campaign_revision_id,
    entryRevisionId: value.entry_revision_id,
    createdAt: value.created_at,
  };
}

function mapReviewRun(value) {
  if (!value) return null;
  return {
    id: value.id,
    status: value.status,
    completionMode: value.completion_mode,
    requiredCount: value.required_count,
    completedCount: value.completed_count,
    taskCount: value.task_count,
    assignedCount: value.assigned_count,
    campaignRevisionId: value.campaign_revision_id,
    entryRevisionId: value.entry_revision_id,
    source: value.source,
    tasks: (value.tasks || []).map((task) => ({
      id: task.id,
      status: task.status,
      createdAt: task.created_at,
      assignments: (task.assignments || []).map((assignment) => ({
        id: assignment.id,
        reviewerId: assignment.reviewer_id,
        name: assignment.name || "",
        reason: assignment.reason || "",
        source: assignment.source,
        assignedBy: assignment.assigned_by,
        assignedAt: assignment.assigned_at,
        endedAt: assignment.ended_at,
        current: Boolean(assignment.current),
        active: Boolean(assignment.active),
      })),
      feedback: (task.feedback || []).map(mapReviewFeedback),
    })),
  };
}

function mapReviewTask(value) {
  if (!value) return null;
  return {
    id: value.id,
    entryId: value.entry_id,
    campaignId: value.campaign_id,
    campaignName: value.campaign_name || "",
    productionId: value.production_id,
    productionName: value.production_name || "",
    entryStatus: value.entry_status,
    taskStatus: value.task_status,
    runStatus: value.run_status,
    completedCount: value.completed_count || 0,
    requiredCount: value.required_count || 0,
    campaignRevisionId: value.campaign_revision_id,
    assignedAt: value.assigned_at,
  };
}

function mapEntryDetail(value) {
  if (!value) return null;
  return {
    entry: mapEntry(value.entry),
    formVersion: mapFormVersion(value.form_version),
    currentRevision: mapEntryRevision(value.current_revision),
    decision: mapDecision(value.decision),
    decisionHistory: Array.isArray(value.decision_history) ? value.decision_history.map(mapDecision) : [],
    materializations: Array.isArray(value.materializations) ? value.materializations.map(mapMaterialization) : [],
    inboxState: mapInboxState(value.inbox_state),
    canDecide: Boolean(value.can_decide),
    canManageReview: Boolean(value.can_manage_review),
    review: mapReviewRun(value.review),
  };
}

function mutationOptions(options = {}) {
  const key = options.idempotencyKey || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  return { headers: { "Idempotency-Key": key } };
}

export async function listCampaignTemplates(filters = {}) {
  const result = await request(`/v1/campaign-templates${queryString(filters)}`);
  const list = normalizeList(result);
  return { ...list, items: list.items.map(mapTemplate) };
}

export async function listWorkspaceCampaignTemplates(workspaceId, filters = {}) {
  const result = await request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/campaign-templates${queryString(filters)}`);
  const list = normalizeList(result);
  return { ...list, items: list.items.map(mapTemplate) };
}

export async function listCampaigns(productionId, filters = {}) {
  const result = await request(`/v1/productions/${encodeURIComponent(productionId)}/campaigns${queryString(filters)}`);
  const list = normalizeList(result);
  return { ...list, items: list.items.map(mapCampaign) };
}

export async function createCampaign(productionId, payload, options = {}) {
  const result = await request(`/v1/productions/${encodeURIComponent(productionId)}/campaigns`, {
    method: "POST",
    body: JSON.stringify(payload),
    ...mutationOptions(options),
  });
  return { campaign: mapCampaign(result.campaign), draftRevision: mapRevision(result.draft_revision) };
}

export async function getCampaign(campaignId) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}`);
  return {
    campaign: mapCampaign(result.campaign),
    draftRevision: mapRevision(result.draft_revision),
    publishedRevision: mapRevision(result.published_revision),
    availabilityPolicy: result.availability_policy || {},
    stats: mapStats(result.stats),
  };
}

export async function updateCampaign(campaignId, payload, options = {}) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    ...(options.idempotencyKey ? mutationOptions(options) : {}),
  });
  return {
    campaign: mapCampaign(result.campaign),
    draftRevision: mapRevision(result.draft_revision),
    publishedRevision: mapRevision(result.published_revision),
    availabilityPolicy: result.availability_policy || {},
    stats: mapStats(result.stats),
  };
}

export async function archiveCampaign(campaignId, options = {}) {
  return updateCampaign(campaignId, { status: "archived" }, options);
}

export async function listCampaignRevisions(campaignId) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/revisions`);
  const list = normalizeList(result);
  return { ...list, items: list.items.map(mapRevision) };
}

export async function createCampaignRevision(campaignId, payload = {}, options = {}) {
  const body = { ...payload };
  if (Object.prototype.hasOwnProperty.call(body, "form")) body.form = wireFormVersion(body.form);
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/revisions`, {
    method: "POST",
    body: JSON.stringify(body),
    ...mutationOptions(options),
  });
  return mapRevision(result);
}

export async function getCampaignRevision(campaignId, revisionId) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/revisions/${encodeURIComponent(revisionId)}`);
  return mapRevision(result.revision || result);
}

export async function updateCampaignRevision(campaignId, revisionId, payload, options = {}) {
  const body = { ...payload };
  if (Object.prototype.hasOwnProperty.call(body, "form")) body.form = wireFormVersion(body.form);
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/revisions/${encodeURIComponent(revisionId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    ...revisionMutationOptions(options),
  });
  return mapRevision(result.revision || result);
}

export async function validateCampaignRevision(campaignId, revisionId, options = {}) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/revisions/${encodeURIComponent(revisionId)}/validate`, { method: "POST", body: "{}", ...revisionMutationOptions(options) });
  return {
    valid: Boolean(result.valid),
    etag: result.etag || "",
    summary: result.summary || { errors: 0, warnings: 0 },
    issues: Array.isArray(result.issues) ? result.issues : [],
  };
}

export async function publishCampaignRevision(campaignId, revisionId, options = {}) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/revisions/${encodeURIComponent(revisionId)}/publish`, {
    method: "POST",
    body: "{}",
    ...revisionMutationOptions(options),
  });
  return {
    campaignId: result.campaign_id,
    revision: mapRevision(result.revision),
    formVersionId: result.form_version_id,
  };
}

function mapReviewCatalogItem(item, enabledKeys = []) {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    description: item.description || "",
    scope: item.scope,
    status: item.status,
    publishedVersion: item.published_version,
    publishedVersionId: item.published_version_id,
    publishedDefinition: item.definition || {},
    enabled: enabledKeys.includes(item.key),
  };
}

export async function getWorkspaceReviewCatalog(workspaceId) {
  const result = await request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/review-catalog`);
  const enabledKeys = result.enabled_keys || [];
  return {
    enabledKeys,
    defaultKey: result.default_key || "",
    items: (result.items || []).map((item) => mapReviewCatalogItem(item, enabledKeys)),
    availableItems: (result.available_items || []).map((item) => mapReviewCatalogItem(item, enabledKeys)),
  };
}

export async function getCampaignTemplate(templateId) {
  const result = await request(`/v1/campaign-templates/${encodeURIComponent(templateId)}`);
  return { template: mapTemplate(result.template), etag: result.etag || "" };
}

export async function listCampaignTemplateVersions(templateId) {
  const result = await request(`/v1/campaign-templates/${encodeURIComponent(templateId)}/versions`);
  const list = normalizeList(result);
  return {
    ...list,
    items: list.items.map(mapCampaignTemplateVersion),
  };
}

export async function createWorkspaceCampaignTemplate(workspaceId, payload, options = {}) {
  const result = await request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/campaign-templates`, {
    method: "POST",
    body: JSON.stringify(payload),
    ...mutationOptions(options),
  });
  return {
    template: mapTemplate(result.template),
    draftVersion: mapCampaignTemplateVersion(result.draft_version),
  };
}

export async function updateCampaignTemplate(templateId, payload, options = {}) {
  const result = await request(`/v1/campaign-templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    headers: {
      ...(options.etag || options.ifMatch ? { "If-Match": options.etag || options.ifMatch } : {}),
    },
  });
  return { template: mapTemplate(result.template), etag: result.etag || "" };
}

export async function createCampaignTemplateVersion(templateId, payload = {}, options = {}) {
  const result = await request(`/v1/campaign-templates/${encodeURIComponent(templateId)}/versions`, {
    method: "POST",
    body: JSON.stringify(payload),
    ...mutationOptions(options),
  });
  return mapCampaignTemplateVersion(result);
}

export async function updateCampaignTemplateVersion(templateId, versionId, payload, options = {}) {
  const result = await request(`/v1/campaign-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    headers: { ...(options.etag || options.ifMatch ? { "If-Match": options.etag || options.ifMatch } : {}) },
  });
  return mapCampaignTemplateVersion(result.version || result);
}

export async function publishCampaignTemplateVersion(templateId, versionId, options = {}) {
  const result = await request(`/v1/campaign-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/publish`, {
    method: "POST",
    body: "{}",
    headers: { ...(options.etag || options.ifMatch ? { "If-Match": options.etag || options.ifMatch } : {}) },
  });
  return {
    template: mapTemplate(result.template),
    version: mapCampaignTemplateVersion(result.version),
  };
}

export async function validateCampaignTemplateVersion(templateId, versionId, options = {}) {
  const result = await request(`/v1/campaign-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/validate`, {
    method: "POST",
    body: "{}",
    headers: { ...(options.etag || options.ifMatch ? { "If-Match": options.etag || options.ifMatch } : {}) },
  });
  return {
    valid: Boolean(result.valid),
    etag: result.etag || "",
    summary: result.summary || { errors: 0, warnings: 0 },
    issues: Array.isArray(result.issues) ? result.issues : [],
  };
}

export async function saveCampaignAsTemplate(campaignId, payload, options = {}) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/save-as-template`, {
    method: "POST",
    body: JSON.stringify(payload),
    ...mutationOptions(options),
  });
  return {
    template: mapTemplate(result.template),
    draftVersion: mapCampaignTemplateVersion(result.draft_version),
  };
}

export async function listCampaignEntries(campaignId, filters = {}) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/entries${queryString(filters)}`);
  const list = normalizeList(result);
  return {
    ...list,
    items: list.items.map(mapEntryInboxItem),
    summary: result?.summary || {},
  };
}

export async function getEntry(entryId) {
  const result = await request(`/v1/entries/${encodeURIComponent(entryId)}`);
  return mapEntryDetail(result);
}

export async function createEntryDecision(entryId, payload) {
  const result = await request(`/v1/entries/${encodeURIComponent(entryId)}/decisions`, {
    method: "POST",
    body: JSON.stringify({ type: payload?.type, reason: payload?.reason || "", ...(payload?.legacyOverride ? { legacy_override: true } : {}) }),
  });
  return { entry: mapEntry(result.entry), decision: mapDecision(result.decision) };
}

export async function listMyReviewTasks({ status = "pending" } = {}) {
  const result = await request(`/v1/me/review-tasks${queryString({ status })}`);
  const list = normalizeList(result);
  return { ...list, items: list.items.map(mapReviewTask) };
}

export async function getReviewTask(taskId) {
  const value = await request(`/v1/review-tasks/${encodeURIComponent(taskId)}`);
  return {
    task: mapReviewTask(value.task),
    formVersion: mapFormVersion(value.form_version),
    entryRevision: mapEntryRevision(value.entry_revision),
    feedbackHistory: (value.feedback_history || []).map(mapReviewFeedback),
    currentFeedback: mapReviewFeedback(value.current_feedback),
    canSubmit: Boolean(value.can_submit),
  };
}

export async function submitReviewFeedback(taskId, payload) {
  const value = await request(`/v1/review-tasks/${encodeURIComponent(taskId)}/feedback`, {
    method: "POST",
    body: JSON.stringify({
      recommendation: payload?.recommendation,
      comment: payload?.comment || "",
      ...(payload?.supersedesFeedbackId ? { supersedes_feedback_id: payload.supersedesFeedbackId } : {}),
    }),
  });
  return mapReviewFeedback(value);
}

export async function assignEntryReviewTask(entryId, payload) {
  const value = await request(`/v1/entries/${encodeURIComponent(entryId)}/review-tasks`, {
    method: "POST",
    body: JSON.stringify({ task_id: payload?.taskId || "", reviewer_id: payload?.reviewerId, reason: payload?.reason || "" }),
  });
  return mapReviewRun(value.review);
}

export async function listEntryRevisions(entryId) {
  const result = await request(`/v1/entries/${encodeURIComponent(entryId)}/revisions`);
  const list = normalizeList(result);
  return { ...list, items: list.items.map(mapEntryRevision) };
}

export async function updateEntryInboxState(entryId, payload) {
  const result = await request(`/v1/entries/${encodeURIComponent(entryId)}/inbox-state`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(payload?.isRead !== undefined ? { is_read: payload.isRead } : {}),
      ...(payload?.isStarred !== undefined ? { is_starred: payload.isStarred } : {}),
    }),
  });
  return {
    entryId: result.entry_id,
    isRead: Boolean(result.is_read),
    isStarred: Boolean(result.is_starred),
    updatedAt: result.updated_at,
  };
}
