import { API_BASE, request } from "@/lib/auth";
import { normalizeFormVersion } from "@/lib/campaign-form-model";
import { buildPublicCampaignSubmissionPayload } from "@/lib/campaign-public-submission";

function publicPath(token, short = false) {
  return short ? `/v1/public/campaign-shares/short/${encodeURIComponent(token)}` : `/v1/public/campaign-shares/${encodeURIComponent(token)}`;
}

function mapPublicForm(value) {
  const normalized = normalizeFormVersion({
    schemaVersion: value?.schema_version ?? value?.schemaVersion,
    blocks: value?.blocks,
    fields: value?.fields,
    logicRules: value?.logic_rules ?? value?.logicRules,
    presentation: value?.presentation,
    endScreen: value?.end_screen ?? value?.endScreen,
  });
  return normalized;
}

function mapPublicPayload(value) {
  return {
    campaign: value?.campaign || {},
    production: value?.production || {},
    revision: value?.revision || {},
    form: mapPublicForm(value?.form),
    availability: value?.availability || {},
    accepting: Boolean(value?.accepting),
    acceptingReason: value?.accepting_reason || "",
  };
}

function mapShareLink(value) {
  return {
    id: value?.id,
    campaignId: value?.campaign_id ?? value?.campaignId,
    longUrl: value?.long_url ?? value?.longUrl,
    shortUrl: value?.short_url ?? value?.shortUrl,
    expiresAt: value?.expires_at ?? value?.expiresAt,
    revokedAt: value?.revoked_at ?? value?.revokedAt,
    createdAt: value?.created_at ?? value?.createdAt,
    rotatedAt: value?.rotated_at ?? value?.rotatedAt,
    lastAccessedAt: value?.last_accessed_at ?? value?.lastAccessedAt,
  };
}

export async function getPublicCampaignForm(token, { short = false } = {}) {
  const result = await request(publicPath(token, short), { headers: { "Referrer-Policy": "no-referrer" } });
  return mapPublicPayload(result);
}

export async function submitPublicCampaignEntry(token, expectedRevisionId, answers, { short = false, idempotencyKey } = {}) {
  const key = idempotencyKey || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  return request(`${publicPath(token, short)}/entries`, {
    method: "POST",
    body: JSON.stringify(buildPublicCampaignSubmissionPayload(expectedRevisionId, answers)),
    headers: { "Idempotency-Key": key, "Referrer-Policy": "no-referrer" },
  });
}

export async function listCampaignShareLinks(campaignId) {
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/share-links`);
  return { ...result, items: (result.items || []).map(mapShareLink) };
}

export async function createCampaignShareLink(campaignId, { expiresAt } = {}, options = {}) {
  const headers = {};
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const result = await request(`/v1/campaigns/${encodeURIComponent(campaignId)}/share-links`, {
    method: "POST",
    body: JSON.stringify(expiresAt ? { expires_at: expiresAt } : {}),
    headers,
  });
  return mapShareLink(result);
}

export async function rotateCampaignShareLink(linkId) {
  return request(`/v1/campaign-share-links/${encodeURIComponent(linkId)}/rotate`, { method: "POST", body: "{}" }).then(mapShareLink);
}

export async function revokeCampaignShareLink(linkId) {
  return request(`/v1/campaign-share-links/${encodeURIComponent(linkId)}/revoke`, { method: "POST", body: "{}" });
}

export { API_BASE };
