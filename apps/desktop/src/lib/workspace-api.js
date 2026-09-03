import { request } from "@/lib/auth";

/**
 * Workspace API 客户端。
 *
 * 后端契约（Phase 5 已实现）：
 * - POST   /v1/workspaces              创建工作空间，创建者成为 OWNER
 * - GET    /v1/workspaces              当前用户拥有 active membership 的工作空间（含 role）
 * - GET    /v1/workspaces/:id          单个工作空间（需要 membership）
 * - PATCH  /v1/workspaces/:id         更新名称/描述/头像（需要 ADMIN+）
 * - GET    /v1/workspaces/:id/members 成员列表（需要 membership）
 * - GET    /me/last-workspace          最近工作空间 id（服务端已校验 membership）
 * - PUT    /me/last-workspace          保存最近工作空间 id（服务端校验 membership）
 *
 * 所有 workspace 作用域操作的后端安全边界是 authenticated user + membership，
 * 前端传入的 workspaceId 只是寻址，不是授权。
 */

export async function createWorkspace({ name, description = "", avatarUrl = "" }) {
  return request("/v1/workspaces", { method: "POST", body: JSON.stringify({ name, description, avatar_url: avatarUrl }) });
}

export async function listWorkspaces() {
  return request("/v1/workspaces");
}

export async function getWorkspace(workspaceId) {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}`);
}

export async function updateWorkspace(workspaceId, patch) {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function listWorkspaceMembers(workspaceId) {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/members`);
}

export async function getLastWorkspace() {
  return request("/me/last-workspace");
}

export async function setLastWorkspace(workspaceId) {
  return request("/me/last-workspace", { method: "PUT", body: JSON.stringify({ workspace_id: workspaceId }) });
}

/**
 * 把后端 workspace 模型映射为侧栏导航使用的 WorkspaceSummary。
 * logo 是从名称推导的展示字符，最多取两个字形。
 */
export function toWorkspaceSummary(workspace) {
  const name = workspace?.name || "";
  return {
    id: workspace.id,
    name,
    slug: workspace.slug || "",
    plan: workspace.role ? roleLabel(workspace.role) : "",
    logo: [...name][0] || "W",
    description: workspace.description || "",
    avatarUrl: workspace.avatar_url || "",
  };
}

export function roleLabel(role) {
  const labels = { owner: "OWNER", admin: "ADMIN", member: "MEMBER" };
  return labels[role] || role || "";
}

/** 角色能力判定：owner > admin > member。与后端 roleRank 保持一致。 */
export function roleAtLeast(role, minimum) {
  const rank = { member: 1, admin: 2, owner: 3 };
  return (rank[role] || 0) >= (rank[minimum] || 0);
}
