import { request } from "@/lib/auth";

const base = (workspaceId, path) => `/v1/workspaces/${workspaceId}/${path}`;

export const resourceDefinitions = {
  programs: { path: "programs", singular: "节目", title: "节目库", description: "沉淀可在不同活动中复用的长期节目资产。", idParam: "programId" },
  people: { path: "people", singular: "人员", title: "人员", description: "管理艺人、工作人员和其他长期联系人。", idParam: "personId" },
  organizations: { path: "organizations", singular: "机构", title: "机构", description: "管理品牌、学校、合作方和供应商资料。", idParam: "organizationId" },
  venues: { path: "venues", singular: "场地", title: "场地", description: "管理场地资料、空间条件和历史使用信息。", idParam: "venueId" },
  equipment: { path: "equipment", singular: "设备", title: "设备", description: "管理工作空间长期持有或常用的设备库存。", idParam: "equipmentId" },
};

export function normalizeResourceList(result) {
  if (Array.isArray(result)) return { items: result, total: result.length };
  return { items: Array.isArray(result?.items) ? result.items : [], total: Number(result?.total ?? result?.items?.length ?? 0) };
}

function queryString(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) value.filter(Boolean).forEach((item) => params.append(key, item));
    else params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

export async function listResource(workspaceId, type, filters) {
  return normalizeResourceList(await request(`${base(workspaceId, resourceDefinitions[type].path)}${queryString(filters)}`));
}
export function getResource(workspaceId, type, id) { return request(`${base(workspaceId, `${resourceDefinitions[type].path}/${id}`)}`); }
export function createResource(workspaceId, type, payload) { return request(base(workspaceId, resourceDefinitions[type].path), { method: "POST", body: JSON.stringify(payload) }); }
export function updateResource(workspaceId, type, id, payload) { return request(base(workspaceId, `${resourceDefinitions[type].path}/${id}`), { method: "PATCH", body: JSON.stringify(payload) }); }
export function deleteResource(workspaceId, type, id) { return request(base(workspaceId, `${resourceDefinitions[type].path}/${id}`), { method: "DELETE" }); }
export async function listProgramTypes(workspaceId, filters) {
  return normalizeResourceList(await request(`${base(workspaceId, "program-types")}${queryString(filters)}`));
}
export function createProgramType(workspaceId, payload) { return request(base(workspaceId, "program-types"), { method: "POST", body: JSON.stringify(payload) }); }
export function updateProgramType(workspaceId, id, payload) { return request(base(workspaceId, `program-types/${id}`), { method: "PATCH", body: JSON.stringify(payload) }); }
export function reorderProgramTypes(workspaceId, items) { return request(base(workspaceId, "program-types/order"), { method: "PATCH", body: JSON.stringify({ items }) }); }
export function deleteProgramType(workspaceId, id, strategy = "delete", replacementTypeId) {
  const payload = { strategy };
  if (replacementTypeId) payload.replacement_type_id = replacementTypeId;
  return request(base(workspaceId, `program-types/${id}/delete`), { method: "POST", body: JSON.stringify(payload) });
}
export async function listVenueTypes(workspaceId, filters) { return normalizeResourceList(await request(`${base(workspaceId, "venue-types")}${queryString(filters)}`)); }
export function createVenueType(workspaceId, payload) { return request(base(workspaceId, "venue-types"), { method: "POST", body: JSON.stringify(payload) }); }
export function updateVenueType(workspaceId, id, payload) { return request(base(workspaceId, `venue-types/${id}`), { method: "PATCH", body: JSON.stringify(payload) }); }
export function reorderVenueTypes(workspaceId, items) { return request(base(workspaceId, "venue-types/order"), { method: "PATCH", body: JSON.stringify({ items }) }); }
export function deleteVenueType(workspaceId, id) { return request(base(workspaceId, `venue-types/${id}/delete`), { method: "POST", body: JSON.stringify({}) }); }
export function listVenueSpaces(workspaceId, venueId) { return request(base(workspaceId, `venues/${venueId}/spaces`)); }
export function createVenueSpace(workspaceId, venueId, payload) { return request(base(workspaceId, `venues/${venueId}/spaces`), { method: "POST", body: JSON.stringify(payload) }); }
export function updateVenueSpace(workspaceId, venueId, id, payload) { return request(base(workspaceId, `venues/${venueId}/spaces/${id}`), { method: "PATCH", body: JSON.stringify(payload) }); }
export function deleteVenueSpace(workspaceId, venueId, id) { return request(base(workspaceId, `venues/${venueId}/spaces/${id}`), { method: "DELETE" }); }
export function listOrganizationContacts(workspaceId, organizationId) { return request(base(workspaceId, `organizations/${organizationId}/contacts`)); }
export function createOrganizationContact(workspaceId, organizationId, payload) { return request(base(workspaceId, `organizations/${organizationId}/contacts`), { method: "POST", body: JSON.stringify(payload) }); }
export function deleteOrganizationContact(workspaceId, organizationId, id) { return request(base(workspaceId, `organizations/${organizationId}/contacts/${id}`), { method: "DELETE" }); }
