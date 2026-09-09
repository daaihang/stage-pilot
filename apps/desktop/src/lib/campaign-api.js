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
    sourceTemplateId: value.source_template_id,
    metadata: value.metadata || {},
    tags: value.metadata?.tags || [],
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function mapFormVersion(value) {
  if (!value) return null;
  return {
    id: value.id,
    schemaVersion: value.schema_version,
    blocks: value.blocks || [],
    fields: value.fields || [],
    logicRules: value.logic_rules || [],
    endScreen: value.end_screen || {},
    createdAt: value.created_at,
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
    availabilityPolicy: value.availability_policy || {},
    reviewWorkflow: value.review_workflow || {},
    materializationPlan: value.materialization_plan || {},
    changeNote: value.change_note || "",
    createdBy: value.created_by,
    createdAt: value.created_at,
    publishedAt: value.published_at,
    archivedAt: value.archived_at,
    formVersion: mapFormVersion(value.form_version),
  };
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
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/revisions`, {
    method: "POST",
    body: JSON.stringify(payload),
    ...mutationOptions(options),
  });
  return mapRevision(result);
}
