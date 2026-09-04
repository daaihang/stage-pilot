import { request } from "@/lib/auth";

/**
 * Production API 客户端（Production Foundation）。
 *
 * 后端契约：
 * - GET   /v1/workspaces/:workspaceId/productions            列表（workspace 隔离）
 * - POST  /v1/workspaces/:workspaceId/productions            创建（ADMIN+，workspace_id 来自 URL）
 * - GET   /v1/workspaces/:workspaceId/productions/:id        详情（校验父子关系）
 * - PATCH /v1/workspaces/:workspaceId/productions/:id        更新 / 归档（ADMIN+）
 *
 * 权限继承 WorkspaceMembership（owner>admin>member），无 ProductionMembership。
 */

export async function listProductions(workspaceId, { status } = {}) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/productions${query}`);
}

export async function createProduction(workspaceId, { name, description = "", timezone = "Asia/Shanghai", plannedStartAt = null, plannedEndAt = null, status }) {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/productions`, {
    method: "POST",
    body: JSON.stringify({ name, description, timezone, planned_start_at: plannedStartAt, planned_end_at: plannedEndAt, ...(status ? { status } : {}) }),
  });
}

export async function getProduction(workspaceId, productionId) {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/productions/${encodeURIComponent(productionId)}`);
}

/** Canonical activity API: works for both Workspace members and direct collaborators. */
export const listAccessibleProductions = () => request("/v1/productions");
export const getAccessibleProduction = (productionId) => request(`/v1/productions/${encodeURIComponent(productionId)}`);
export const updateAccessibleProduction = (productionId, patch) => request(`/v1/productions/${encodeURIComponent(productionId)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const listProductionMembers = (productionId) => request(`/v1/productions/${encodeURIComponent(productionId)}/members`);
export const addProductionMember = (productionId, payload) => request(`/v1/productions/${encodeURIComponent(productionId)}/members`, { method: "POST", body: JSON.stringify(payload) });
export const updateProductionMember = (productionId, memberId, payload) => request(`/v1/productions/${encodeURIComponent(productionId)}/members/${encodeURIComponent(memberId)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const revokeProductionMember = (productionId, memberId) => request(`/v1/productions/${encodeURIComponent(productionId)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
export const listProductionInvitations = (productionId) => request(`/v1/productions/${encodeURIComponent(productionId)}/invitations`);
export const createProductionInvitation = (productionId, payload) => request(`/v1/productions/${encodeURIComponent(productionId)}/invitations`, { method: "POST", body: JSON.stringify(payload) });
export const revokeProductionInvitation = (productionId, invitationId) => request(`/v1/productions/${encodeURIComponent(productionId)}/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" });
export const acceptProductionInvitation = (token) => request("/v1/production-invitations/accept", { method: "POST", body: JSON.stringify({ token }) });
export const listProductionLocations = (productionId) => request(`/v1/productions/${encodeURIComponent(productionId)}/locations`);
export const createProductionLocation = (productionId, payload) => request(`/v1/productions/${encodeURIComponent(productionId)}/locations`, { method: "POST", body: JSON.stringify(payload) });
export const updateProductionLocation = (productionId, locationId, payload) => request(`/v1/productions/${encodeURIComponent(productionId)}/locations/${encodeURIComponent(locationId)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteProductionLocation = (productionId, locationId) => request(`/v1/productions/${encodeURIComponent(productionId)}/locations/${encodeURIComponent(locationId)}`, { method: "DELETE" });
export const reorderProductionLocations = (productionId, items) => request(`/v1/productions/${encodeURIComponent(productionId)}/locations/order`, { method: "PATCH", body: JSON.stringify({ items }) });

export async function updateProduction(workspaceId, productionId, patch) {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/productions/${encodeURIComponent(productionId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export const productionStatusLabels = {
  active: { label: "进行中", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  completed: { label: "已结束", className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  archived: { label: "已归档", className: "bg-muted text-muted-foreground" },
};

export function productionStatusLabel(status) {
  return productionStatusLabels[status] ?? productionStatusLabels.active;
}

/**
 * RFC3339 → 指定 IANA 时区的展示字符串。
 * 不使用运行机器本地时区；production 自带 timezone。
 */
export function formatProductionInstant(instant, timezone, { withTime = true } = {}) {
  if (!instant) return "";
  try {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone || "Asia/Shanghai",
      year: "numeric", month: "numeric", day: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
    return formatter.format(new Date(instant));
  } catch {
    return instant;
  }
}

/**
 * 后端 production 模型 → 前端导航摘要（WorkspaceSummary/ProductionSummary 契约）。
 * venue 字段属于未来 Venue 领域，本阶段固定为空字符串占位。
 */
export function toProductionSummary(production) {
  return {
    id: production.id,
    workspaceId: production.workspace_id,
    name: production.name,
    status: production.status,
    plannedStartAt: production.planned_start_at || "",
    plannedEndAt: production.planned_end_at || "",
    actualCompletedAt: production.actual_completed_at || null,
    venue: "",
    timezone: production.timezone,
    description: production.description || "",
    archivedAt: production.archived_at || null,
    createdAt: production.created_at || "",
    updatedAt: production.updated_at || "",
    workspaceName: production.workspace_name || "",
    workspaceNavigable: Boolean(production.workspace_navigable),
    workspaceRole: production.workspace_role || "",
    directRole: production.direct_role || "",
    contextKind: production.context_kind || "workspace",
    permissionKeys: production.permission_keys || [],
  };
}
