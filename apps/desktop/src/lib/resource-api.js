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
const resourceTypePaths = Object.freeze({ programs: "program-types", venues: "venue-types" });
function resourceTypePath(resourceType) {
  const path = resourceTypePaths[resourceType];
  if (!path) throw new Error(`Unsupported resource type: ${resourceType}`);
  return path;
}
export async function listResourceTypes(workspaceId, resourceType, filters) {
  return normalizeResourceList(await request(`${base(workspaceId, resourceTypePath(resourceType))}${queryString(filters)}`));
}
export function createResourceType(workspaceId, resourceType, payload) { return request(base(workspaceId, resourceTypePath(resourceType)), { method: "POST", body: JSON.stringify(payload) }); }
export function updateResourceType(workspaceId, resourceType, id, payload) { return request(base(workspaceId, `${resourceTypePath(resourceType)}/${id}`), { method: "PATCH", body: JSON.stringify(payload) }); }
export function reorderResourceTypes(workspaceId, resourceType, items) { return request(base(workspaceId, `${resourceTypePath(resourceType)}/order`), { method: "PATCH", body: JSON.stringify({ items }) }); }
export function deleteResourceType(workspaceId, resourceType, id, options = {}) {
  return request(base(workspaceId, `${resourceTypePath(resourceType)}/${id}/delete`), { method: "POST", body: JSON.stringify(resourceType === "programs" ? options : {}) });
}

// Compatibility aliases for callers that still use resource-specific names.
export function listProgramTypes(workspaceId, filters) { return listResourceTypes(workspaceId, "programs", filters); }
export function createProgramType(workspaceId, payload) { return createResourceType(workspaceId, "programs", payload); }
export function updateProgramType(workspaceId, id, payload) { return updateResourceType(workspaceId, "programs", id, payload); }
export function reorderProgramTypes(workspaceId, items) { return reorderResourceTypes(workspaceId, "programs", items); }
export function deleteProgramType(workspaceId, id, strategy = "delete", replacementTypeId) {
  const options = { strategy };
  if (replacementTypeId) options.replacement_type_id = replacementTypeId;
  return deleteResourceType(workspaceId, "programs", id, options);
}
export function listVenueTypes(workspaceId, filters) { return listResourceTypes(workspaceId, "venues", filters); }
export function createVenueType(workspaceId, payload) { return createResourceType(workspaceId, "venues", payload); }
export function updateVenueType(workspaceId, id, payload) { return updateResourceType(workspaceId, "venues", id, payload); }
export function reorderVenueTypes(workspaceId, items) { return reorderResourceTypes(workspaceId, "venues", items); }
export function deleteVenueType(workspaceId, id) { return deleteResourceType(workspaceId, "venues", id); }
export async function listFileTypes(workspaceId, filters) {
  return normalizeResourceList(await request(`${base(workspaceId, "file-types")}${queryString(filters)}`));
}
export function createFileType(workspaceId, payload) { return request(base(workspaceId, "file-types"), { method: "POST", body: JSON.stringify(payload) }); }
export function updateFileType(workspaceId, id, payload) { return request(base(workspaceId, `file-types/${id}`), { method: "PATCH", body: JSON.stringify(payload) }); }
export function reorderFileTypes(workspaceId, scope, items) { return request(base(workspaceId, "file-types/order"), { method: "PATCH", body: JSON.stringify({ scope, items }) }); }
export function deleteFileType(workspaceId, id) { return request(base(workspaceId, `file-types/${id}/delete`), { method: "POST", body: JSON.stringify({}) }); }
export function restoreFileTypes(workspaceId, scope) { return request(base(workspaceId, "file-types/restore"), { method: "POST", body: JSON.stringify({ scope }) }); }
export function migrateFileTypes(workspaceId, scopes) { return request(base(workspaceId, "file-types/migrate"), { method: "POST", body: JSON.stringify({ scopes }) }); }
export function listVenueSpaces(workspaceId, venueId) { return request(base(workspaceId, `venues/${venueId}/spaces`)); }
export function createVenueSpace(workspaceId, venueId, payload) { return request(base(workspaceId, `venues/${venueId}/spaces`), { method: "POST", body: JSON.stringify(payload) }); }
export function updateVenueSpace(workspaceId, venueId, id, payload) { return request(base(workspaceId, `venues/${venueId}/spaces/${id}`), { method: "PATCH", body: JSON.stringify(payload) }); }
export function deleteVenueSpace(workspaceId, venueId, id) { return request(base(workspaceId, `venues/${venueId}/spaces/${id}`), { method: "DELETE" }); }
export function listOrganizationContacts(workspaceId, organizationId) { return request(base(workspaceId, `organizations/${organizationId}/contacts`)); }
export function createOrganizationContact(workspaceId, organizationId, payload) { return request(base(workspaceId, `organizations/${organizationId}/contacts`), { method: "POST", body: JSON.stringify(payload) }); }
export function deleteOrganizationContact(workspaceId, organizationId, id) { return request(base(workspaceId, `organizations/${organizationId}/contacts/${id}`), { method: "DELETE" }); }
