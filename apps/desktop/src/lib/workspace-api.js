import { request } from "@/lib/auth";
import { normalizeTimeZone } from "@/lib/timezone";

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

export const getWorkspacePlanningSettings = (workspaceId) => request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/settings`);
export const updateWorkspacePlanningSettings = (workspaceId, patch) => request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/settings`, { method: "PATCH", body: JSON.stringify(patch) });

export async function listWorkspaceMembers(workspaceId) {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/members`);
}

export const listWorkspaceInvitations = (workspaceId) => request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations`);
export const createWorkspaceInvitation = (workspaceId, payload) => request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations`, { method: "POST", body: JSON.stringify(payload) });
export const revokeWorkspaceInvitation = (workspaceId, invitationId) => request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" });

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
    role: workspace.role ? String(workspace.role).toLowerCase() : "",
    plan: workspace.role ? roleLabel(workspace.role) : "",
    logo: [...name][0] || "W",
    description: workspace.description || "",
    avatarUrl: workspace.avatar_url || "",
    defaultTimezone: workspace.default_timezone || "Asia/Shanghai",
  };
}

export function roleLabel(role) {
  const labels = { owner: "OWNER", admin: "ADMIN", member: "MEMBER" };
  const normalized = String(role || "").toLowerCase();
  return labels[normalized] || role || "";
}

/** 角色能力判定：owner > admin > member。与后端 roleRank 保持一致。 */
export function roleAtLeast(role, minimum) {
  const rank = { member: 1, admin: 2, owner: 3 };
  const normalizedRole = String(role || "").toLowerCase();
  const normalizedMinimum = String(minimum || "").toLowerCase();
  return (rank[normalizedRole] || 0) >= (rank[normalizedMinimum] || 0);
}

const memberRoleLabels = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const memberStatusLabels = {
  active: "已启用",
  invited: "待接受",
  suspended: "已暂停",
};

/** 成员页使用的角色展示文案；未知角色不会被伪装成真实角色。 */
export function memberRoleLabel(role) {
  const normalized = String(role || "").toLowerCase();
  return memberRoleLabels[normalized] || "未知角色";
}

/** 成员页使用的状态展示文案；未知状态保留为明确的占位。 */
export function memberStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  return memberStatusLabels[normalized] || "状态未知";
}

export function memberRoleBadgeVariant(role) {
  const normalized = String(role || "").toLowerCase();
  return { owner: "warning-light", admin: "primary-light", member: "outline" }[normalized] || "outline";
}

export function memberStatusBadgeVariant(status) {
  const normalized = String(status || "").toLowerCase();
  return { active: "success-light", invited: "warning-light", suspended: "destructive-light" }[normalized] || "outline";
}

function firstMemberValue(member, keys) {
  for (const key of keys) {
    const value = member?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function memberDisplayName(member) {
  return firstMemberValue(member, ["display_name", "displayName", "name", "email", "user_id", "userId"]) || "未命名成员";
}

export function memberInitials(member) {
  const displayName = firstMemberValue(member, ["display_name", "displayName", "name"]);
  if (displayName) {
    const words = displayName.split(/\s+/).filter(Boolean);
    if (words.length > 1) return `${[...words[0]][0]}${[...words.at(-1)][0]}`.toUpperCase();
    return [...displayName].slice(0, 2).join("").toUpperCase();
  }

  const email = firstMemberValue(member, ["email"]);
  if (email) return [...email.split("@")[0]].slice(0, 2).join("").toUpperCase();

  const userId = firstMemberValue(member, ["user_id", "userId"]);
  return userId ? [...userId].slice(0, 2).join("").toUpperCase() : "?";
}

export function formatMemberJoinedAt(member, timezone) {
  const rawValue = firstMemberValue(member, ["created_at", "createdAt", "joined_at", "joinedAt"]);
  if (!rawValue) return "加入时间未知";
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return "加入时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", timeZone: normalizeTimeZone(timezone) }).format(date);
}
