/**
 * Workspace access is a presentation model for the first access-management UI.
 * It is intentionally independent from server authorization and must not be
 * used as a client-side security boundary.
 */

export const workspaceRoles = [
  {
    key: "owner",
    label: "Owner",
    description: "拥有工作空间的完整控制权，包括成员与权限管理。",
    scope: "整个工作空间",
  },
  {
    key: "admin",
    label: "Admin",
    description: "负责工作空间日常配置、成员协作和业务资源管理。",
    scope: "整个工作空间",
  },
  {
    key: "member",
    label: "Member",
    description: "参与活动工作并查看工作空间中的共享资源。",
    scope: "工作空间内可访问资源",
  },
];

export const workspacePermissionGroups = [
  {
    key: "workspace",
    label: "工作空间",
    permissions: [
      { key: "workspace.view", label: "查看", action: "查看" },
      { key: "workspace.manage", label: "管理", action: "管理" },
    ],
  },
  {
    key: "members",
    label: "成员",
    permissions: [
      { key: "members.view", label: "查看", action: "查看" },
      { key: "members.invite", label: "邀请", action: "创建" },
      { key: "members.manage", label: "管理", action: "管理" },
      { key: "members.remove", label: "移除", action: "删除" },
    ],
  },
  {
    key: "productions",
    label: "活动",
    permissions: [
      { key: "productions.view", label: "查看", action: "查看" },
      { key: "productions.create", label: "创建", action: "创建" },
      { key: "productions.edit", label: "编辑", action: "编辑" },
      { key: "productions.delete", label: "删除", action: "删除" },
    ],
  },
  {
    key: "library",
    label: "资源库",
    permissions: [
      { key: "library.view", label: "查看", action: "查看" },
      { key: "library.manage", label: "管理", action: "管理" },
    ],
  },
  {
    key: "files",
    label: "文件",
    permissions: [
      { key: "files.view", label: "查看", action: "查看" },
      { key: "files.upload", label: "上传", action: "创建" },
      { key: "files.delete", label: "删除", action: "删除" },
    ],
  },
  {
    key: "templates",
    label: "模板",
    permissions: [
      { key: "templates.view", label: "查看", action: "查看" },
      { key: "templates.manage", label: "管理", action: "管理" },
    ],
  },
];

const allPermissionKeys = workspacePermissionGroups.flatMap((group) => group.permissions.map((permission) => permission.key));

export const workspaceRolePermissionKeys = Object.freeze({
  owner: Object.freeze([...allPermissionKeys]),
  admin: Object.freeze([...allPermissionKeys]),
  member: Object.freeze([
    "workspace.view",
    "members.view",
    "productions.view",
    "productions.create",
    "productions.edit",
    "library.view",
    "files.view",
    "files.upload",
    "templates.view",
  ]),
});

export function getWorkspaceRolePermissions(role) {
  const normalizedRole = String(role || "").toLowerCase();
  return new Set(workspaceRolePermissionKeys[normalizedRole] || []);
}
