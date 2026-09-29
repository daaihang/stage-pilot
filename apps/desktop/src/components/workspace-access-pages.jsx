import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from "@/components/ui/icons";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogBody, DialogForm } from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/sonner";
import { Badge } from "@/components/reui/badge";
import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { SettingsTabs } from "@/components/settings-tabs";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { ListSurface, ResourcePage } from "@/components/resource-page";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { createFilterQuery } from "@/components/reui/filters/filters-query";
import { AccessMemberTable, AccessPermissionTree, AccessRolesLayout } from "@/components/access-management-ui";
import { InvitationListPanel } from "@/components/invitation-management-ui";
import { useNavigate } from "react-router-dom";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import {
  formatMemberJoinedAt,
  createWorkspaceInvitation,
  getWorkspaceInvitationCredential,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  memberDisplayName,
  memberInitials,
  memberRoleBadgeVariant,
  memberRoleLabel,
  memberStatusBadgeVariant,
  memberStatusLabel,
  revokeWorkspaceMember,
  revokeWorkspaceInvitation,
  rotateWorkspaceInvitation,
  updateWorkspaceMember,
} from "@/lib/workspace-api";
import {
  getWorkspaceRolePermissions,
  workspacePermissionGroups,
  workspaceRoles,
} from "@/lib/workspace-permissions";
import { workspacePath } from "@/lib/navigation";

function MembersLoadingState() {
  return (
    <div className="space-y-3 p-4" aria-label="正在加载成员">
      {["one", "two", "three", "four"].map((key) => (
        <div key={key} className="flex items-center gap-3 border-b pb-3 last:border-0">
          <Skeleton className="size-8 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function WorkspaceRolesPage({ route, workspace }) {
  const [selectedRole, setSelectedRole] = useState("owner");
  return <div className="space-y-6"><WorkspacePageHeader workspace={workspace} role={workspace.role} title={route?.meta?.title || "角色与权限"} description={route?.meta?.description || "查看工作空间角色和可用权限范围。"} /><AccessRolesLayout roles={workspaceRoles} selectedRole={selectedRole} onRoleChange={setSelectedRole} permissionsForRole={getWorkspaceRolePermissions} groups={workspacePermissionGroups} scopeForRole={(role) => role.scope} warningForRole={(role) => role.key === "owner" ? "Owner 与成员管理权限会影响工作空间安全。角色可在成员页修改；自定义权限尚未接入。" : "固定 Workspace 角色可在成员页修改；自定义权限尚未接入。"} /></div>;
}

const memberFilterFields = [
  {
    id: "role",
    label: "角色",
    type: "select",
    defaultOperator: "is_any_of",
    options: [
      { value: "owner", label: "Owner" },
      { value: "admin", label: "Admin" },
      { value: "member", label: "Member" },
    ],
  },
  {
    id: "status",
    label: "状态",
    type: "select",
    defaultOperator: "is_any_of",
    options: [
      { value: "active", label: "已启用" },
      { value: "invited", label: "待接受" },
      { value: "suspended", label: "已暂停" },
      { value: "revoked", label: "已移除" },
    ],
  },
];

function matchesMemberFilterValue(value, condition) {
  const actual = String(value || "").toLowerCase();
  const values = condition.values.map((item) => String(item).toLowerCase());
  if (!values.length) return true;
  if (condition.operator === "is_any_of") return values.includes(actual);
  if (condition.operator === "is_none_of") return !values.includes(actual);
  if (condition.operator === "is" || condition.operator === "eq") return actual === values[0];
  if (condition.operator === "is_not" || condition.operator === "neq") return actual !== values[0];
  if (condition.operator === "contains") return values.some((item) => actual.includes(item));
  if (condition.operator === "not_contains") return values.every((item) => !actual.includes(item));
  if (condition.operator === "starts_with") return values.some((item) => actual.startsWith(item));
  if (condition.operator === "ends_with") return values.some((item) => actual.endsWith(item));
  return true;
}

function MemberTable({ members, onAction }) {
  return (
    <AccessMemberTable
      members={members}
      displayName={memberDisplayName}
      initials={memberInitials}
      roleLabel={memberRoleLabel}
      roleVariant={memberRoleBadgeVariant}
      statusLabel={memberStatusLabel}
      statusVariant={memberStatusBadgeVariant}
      joinedAt={formatMemberJoinedAt}
      onAction={onAction}
    />
  );
}

function WorkspaceMemberRoleDialog({ member, open, onOpenChange, onSubmit }) {
  const [role, setRole] = useState(member?.role || "member");
  useEffect(() => {
    if (open) setRole(member?.role || "member");
  }, [member, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogForm onSubmit={(event) => { event.preventDefault(); onSubmit(role); }}>
          <DialogHeader>
            <DialogTitle>修改成员角色</DialogTitle>
            <DialogDescription>{member ? `${memberDisplayName(member)} · Workspace 固定角色` : "选择成员角色"}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-sm font-medium">角色</span>
                <Select items={[{ value: "owner", label: "Owner" }, { value: "admin", label: "Admin" }, { value: "member", label: "Member" }]} value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="owner">Owner</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem></SelectContent>
                </Select>
              </label>
            </div>
          </DialogBody>
          <DialogFooter layout="standard" cancel={<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>} primary={<Button type="submit">保存角色</Button>} />
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceMembersPage({ route, workspace }) {
  const navigate = useNavigate();
  const { setDetailOpen } = useWindowDetail();
  const invitationTriggerRef = useRef(null);
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState(() => createFilterQuery());
  const [memberDialog, setMemberDialog] = useState(null);
  const membersRef = useRef(null);
  const requestRef = useRef(0);
  const invitationPanelOpen = route?.panel === "invitations";
  useWindowDetailRegistration({
    key: `workspace-members:${workspace.id}`,
    storageKey: "detailPane:workspace-members:v1",
    detailLabel: "成员邀请",
    triggerRef: invitationTriggerRef,
    getDetail: () => invitationPanelOpen ? <InvitationListPanel scope="workspace" scopeKey={workspace.id} title="成员邀请" canManage={workspace.role === "owner" || workspace.role === "admin"} roleOptions={[{ value: "member", label: "Member" }, ...(workspace.role === "owner" ? [{ value: "admin", label: "Admin" }] : [])]} listInvitations={() => listWorkspaceInvitations(workspace.id)} createInvitation={(payload) => createWorkspaceInvitation(workspace.id, payload)} getCredential={(id) => getWorkspaceInvitationCredential(workspace.id, id)} rotateInvitation={(id) => rotateWorkspaceInvitation(workspace.id, id)} revokeInvitation={(id) => revokeWorkspaceInvitation(workspace.id, id)} onChanged={() => loadMembers()} /> : null,
    onClose: () => navigate(workspacePath(workspace.id, "members")),
  });
  useEffect(() => { setDetailOpen(invitationPanelOpen, { announce: false }); }, [invitationPanelOpen, setDetailOpen]);

  const loadMembers = useCallback(async ({ withToast = false } = {}) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    const toastId = withToast ? notify.loading("正在刷新成员") : undefined;
    try {
      const result = await listWorkspaceMembers(workspace.id);
      if (requestId !== requestRef.current) {
        if (toastId) notify.dismiss(toastId);
        return;
      }
      const nextMembers = Array.isArray(result) ? result : [];
      membersRef.current = nextMembers;
      setMembers(nextMembers);
      setError(null);
      if (toastId) notify.success("成员已刷新", { id: toastId });
    } catch (nextError) {
      if (requestId !== requestRef.current) {
        if (toastId) notify.dismiss(toastId);
        return;
      }
      const normalizedError = nextError instanceof Error ? nextError : new Error(String(nextError));
      setError(membersRef.current !== null ? null : normalizedError);
      if (toastId) notify.error("刷新成员失败", { id: toastId, description: normalizedError.message });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    requestRef.current += 1;
    membersRef.current = null;
    setMembers(null);
    setError(null);
    loadMembers();
    return () => { requestRef.current += 1; };
  }, [loadMembers]);


  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    const conditions = getResourceFilterConditions(filterQuery);
    return (members || []).filter((member) => {
      const searchable = [memberDisplayName(member), member.email, member.user_id]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesFilters = conditions.every((condition) => matchesMemberFilterValue(member[condition.field], condition));
      return matchesQuery && matchesFilters;
    });
  }, [filterQuery, members, query]);

  const clearMemberFilters = () => {
    setQuery("");
    setFilterQuery(createFilterQuery());
    notify.info("已清除成员筛选");
  };

  const saveMemberRole = async (role) => {
    const member = memberDialog?.member;
    if (!member) return;
    const toastId = notify.loading("正在更新成员角色");
    try {
      await updateWorkspaceMember(workspace.id, member.id, { role });
      notify.success("成员角色已更新", { id: toastId });
      setMemberDialog(null);
      await loadMembers();
    } catch (nextError) {
      const normalizedError = nextError instanceof Error ? nextError : new Error(String(nextError));
      notify.error("更新成员角色失败", { id: toastId, description: normalizedError.message });
    }
  };

  const updateMemberStatus = async (member) => {
    const nextStatus = member.status === "suspended" ? "active" : "suspended";
    const toastId = notify.loading(nextStatus === "suspended" ? "正在暂停成员" : "正在恢复成员");
    try {
      await updateWorkspaceMember(workspace.id, member.id, { status: nextStatus });
      notify.success(nextStatus === "suspended" ? "成员已暂停" : "成员已恢复", { id: toastId });
      await loadMembers();
    } catch (nextError) {
      const normalizedError = nextError instanceof Error ? nextError : new Error(String(nextError));
      notify.error(nextStatus === "suspended" ? "暂停成员失败" : "恢复成员失败", { id: toastId, description: normalizedError.message });
    }
  };

  const removeMember = async () => {
    const member = memberDialog?.member;
    if (!member) return;
    const toastId = notify.loading("正在移除成员");
    try {
      await revokeWorkspaceMember(workspace.id, member.id);
      notify.success("成员已移除", { id: toastId });
      setMemberDialog(null);
      await loadMembers();
    } catch (nextError) {
      const normalizedError = nextError instanceof Error ? nextError : new Error(String(nextError));
      notify.error("移除成员失败", { id: toastId, description: normalizedError.message });
    }
  };

  const memberActions = (member) => {
    if (!member.id || member.status === "revoked" || !["owner", "admin"].includes(workspace.role)) return null;
    const canManageTarget = workspace.role === "owner" || member.role === "member";
    if (!canManageTarget) return null;
    return <>
      {workspace.role === "owner" && <DropdownMenuItem onClick={() => setMemberDialog({ type: "role", member })}>修改角色</DropdownMenuItem>}
      {member.status === "active" && <DropdownMenuItem onClick={() => updateMemberStatus(member)}>暂停成员</DropdownMenuItem>}
      {member.status === "suspended" && <DropdownMenuItem onClick={() => updateMemberStatus(member)}>恢复成员</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => setMemberDialog({ type: "revoke", member })}>移除成员</DropdownMenuItem>
    </>;
  };

  const empty = error && !members
    ? { icon: UsersRound, title: "无法加载成员", description: error.message, action: <Button onClick={() => loadMembers({ withToast: true })} disabled={loading}><RefreshCw className={loading ? "animate-spin" : undefined} />重试</Button> }
    : members?.length === 0
      ? { icon: UsersRound, title: "暂无成员", description: "当前工作空间还没有可显示的成员。" }
      : filteredMembers.length === 0 && members
        ? { icon: UsersRound, title: "没有匹配成员", description: "请尝试调整搜索关键词或筛选条件。", action: <Button variant="outline" size="sm" onClick={clearMemberFilters}>清除筛选</Button> }
        : null;

  return (
    <ResourcePage
      back={{ to: workspacePath(workspace.id, "home"), label: workspace.name }}
      title={route?.meta?.title || "成员"}
      description={route?.meta?.description || "管理可以访问这个工作空间的团队成员。"}
      count={members?.length || 0}
      summary={members ? <span>显示 {filteredMembers.length} / {members.length} 位成员</span> : null}
      search={{ value: query, onChange: setQuery, placeholder: "搜索姓名、邮箱或用户 ID" }}
      filters={<ResourceFilters fields={memberFilterFields} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} />}
      showViewToggle={false}
      actions={{ primary: ["owner", "admin"].includes(workspace.role) ? <Button ref={invitationTriggerRef} onClick={() => navigate(`${workspacePath(workspace.id, "members")}?panel=invitations`)}><UsersRound />成员邀请</Button> : null, secondary: [<Button key="refresh" variant="outline" onClick={() => loadMembers({ withToast: true })} disabled={loading}><RefreshCw className={loading ? "animate-spin" : undefined} />刷新</Button>] }}
      floatingPrimary={["owner", "admin"].includes(workspace.role) ? <Button onClick={() => navigate(`${workspacePath(workspace.id, "members")}?panel=invitations`)}><UsersRound />成员邀请</Button> : null}
      loading={loading && !members}
      loadingContent={<MembersLoadingState />}
      empty={empty}
    >
      <ListSurface className="overflow-x-auto"><MemberTable members={filteredMembers} onAction={memberActions} /></ListSurface>
      <WorkspaceMemberRoleDialog member={memberDialog?.member} open={memberDialog?.type === "role"} onOpenChange={(open) => !open && setMemberDialog(null)} onSubmit={saveMemberRole} />
      <AlertDialog open={memberDialog?.type === "revoke"} onOpenChange={(open) => !open && setMemberDialog(null)}><AlertDialogContent size="sm"><AlertDialogHeader><AlertDialogTitle>移除工作空间成员</AlertDialogTitle><AlertDialogDescription>{memberDialog?.member ? `确认移除 ${memberDisplayName(memberDialog.member)}？这会软撤销 Workspace 访问，但不会自动撤销其独立的 Production 访问。` : "确认移除该成员？"}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter layout="standard" cancel={<AlertDialogCancel>取消</AlertDialogCancel>} primary={<AlertDialogAction variant="destructive" onClick={removeMember}>确认移除</AlertDialogAction>} /></AlertDialogContent></AlertDialog>
    </ResourcePage>
  );
}

const permissionTreeItems = {
  permissions: { label: "全部权限", children: workspacePermissionGroups.map((group) => group.key) },
  ...Object.fromEntries(
    workspacePermissionGroups.flatMap((group) => [
      [group.key, { label: group.label, children: group.permissions.map((permission) => permission.key) }],
      ...group.permissions.map((permission) => [permission.key, { label: permission.label }]),
    ])
  ),
};

function getPermissionNodeState(item, permissions) {
  if (!item.isFolder()) return permissions.has(item.getId()) ? "checked" : "unchecked";
  const children = item.getChildren();
  const childStates = children.map((child) => getPermissionNodeState(child, permissions));
  const checkedCount = childStates.filter((state) => state === "checked").length;
  if (checkedCount === childStates.length && childStates.length > 0) return "checked";
  if (checkedCount > 0 || childStates.some((state) => state === "indeterminate")) return "indeterminate";
  return "unchecked";
}

function PermissionTree({ permissions }) {
  return <AccessPermissionTree groups={workspacePermissionGroups} permissions={permissions} />;
  /*const tree = useTree({
    initialState: { expandedItems: ["permissions", ...workspacePermissionGroups.map((group) => group.key)] },
    rootItemId: "permissions",
    getItemName: (item) => item.getItemData().label,
    isItemFolder: (item) => (item.getItemData()?.children?.length || 0) > 0,
    dataLoader: {
      getItem: (itemId) => permissionTreeItems[itemId],
      getChildren: (itemId) => permissionTreeItems[itemId]?.children || [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  return (
    <Tree
      tree={tree}
      indent={22}
      toggleIconType="chevron"
      aria-label="权限预览"
      aria-readonly="true"
      className="min-w-72"
    >
      {tree.getItems().map((item) => {
        const state = getPermissionNodeState(item, permissions);
        const isFolder = item.isFolder();
        return (
          <TreeItem key={item.getId()} item={item} aria-checked={state === "indeterminate" ? "mixed" : state === "checked"}>
            <TreeItemLabel className="min-w-0 not-in-data-[folder=true]:ps-5">
              <span className="flex min-w-0 items-center gap-2">
                <Checkbox
                  checked={state === "checked"}
                  indeterminate={state === "indeterminate"}
                  disabled
                  aria-checked={state === "indeterminate" ? "mixed" : state === "checked"}
                  aria-label={`${item.getItemName()}：${state === "checked" ? "全部授权" : state === "indeterminate" ? "部分授权" : "未授权"}`}
                  className="size-3.5"
                />
                <span className={isFolder ? "font-medium" : "text-muted-foreground"}>{item.getItemName()}</span>
              </span>
            </TreeItemLabel>
          </TreeItem>
        );
      })}
    </Tree>
  );*/
}

function LegacyWorkspaceRolesPage({ route, workspace }) {
  const [selectedRole, setSelectedRole] = useState("owner");
  const role = workspaceRoles.find((item) => item.key === selectedRole) || workspaceRoles[0];
  const permissions = getWorkspaceRolePermissions(role.key);
  const roleGroups = workspaceRoles.map((item) => [item.key, item.label, ShieldCheck]);

  return (
    <div className="space-y-6">
      <WorkspacePageHeader workspace={workspace} role={workspace.role} title={route?.meta?.title || "角色与权限"} description={route?.meta?.description || "查看工作空间角色和可用权限范围。"} />
      <SettingsTabs groups={roleGroups} activeGroup={role.key} onGroupChange={setSelectedRole} ariaLabel="角色">
        <Card className="min-w-0">
          <CardHeader className="gap-4 border-b">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <Badge variant={role.key === "owner" ? "warning-light" : "primary-light"} size="sm">只读预览</Badge>
                <CardDescription>{role.description}</CardDescription>
              </div>
              <div className="flex shrink-0 gap-5 text-xs">
                <div><p className="text-muted-foreground">已授权权限</p><p className="mt-1 text-base font-semibold">{permissions.size} / {workspacePermissionGroups.flatMap((group) => group.permissions).length}</p></div>
                <div><p className="text-muted-foreground">作用范围</p><p className="mt-1 max-w-32 font-medium">{role.scope}</p></div>
              </div>
            </div>
            <div className="flex items-start gap-2 border-l-2 border-warning bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              {role.key === "owner" ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              <span>Owner 与成员管理权限会影响工作空间安全。权限树仅用于当前角色预览，权限修改尚未接入。</span>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />权限树</div>
            <div className="min-w-0 overflow-x-auto">
              <PermissionTree permissions={permissions} />
            </div>
            <p className="border-t pt-3 text-xs text-muted-foreground">父级复选框表示子权限状态：全部授权、部分授权或未授权。权限修改需要服务端支持。</p>
          </CardContent>
        </Card>
      </SettingsTabs>
    </div>
  );
}
