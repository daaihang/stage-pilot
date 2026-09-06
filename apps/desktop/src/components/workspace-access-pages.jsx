import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ellipsis,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from "@/components/ui/icons";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/components/ui/sonner";
import { Badge } from "@/components/reui/badge";
import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { SettingsTabs } from "@/components/settings-tabs";
import { WorkspacePageHeader } from "@/components/workspace-page-shell";
import { ResourcePage } from "@/components/resource-page";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { createFilterQuery } from "@/components/reui/filters/filters-query";
import { AccessMemberTable, AccessPermissionTree, AccessRolesLayout } from "@/components/access-management-ui";
import { InvitationListPanel } from "@/components/invitation-management-ui";
import { useNavigate } from "react-router-dom";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import {
  formatMemberJoinedAt,
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  memberDisplayName,
  memberInitials,
  memberRoleBadgeVariant,
  memberRoleLabel,
  memberStatusBadgeVariant,
  memberStatusLabel,
  revokeWorkspaceInvitation,
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
  return <div className="space-y-6"><WorkspacePageHeader workspace={workspace} role={workspace.role} title={route?.meta?.title || "角色与权限"} description={route?.meta?.description || "查看工作空间角色和可用权限范围。"} /><AccessRolesLayout roles={workspaceRoles} selectedRole={selectedRole} onRoleChange={setSelectedRole} permissionsForRole={getWorkspaceRolePermissions} groups={workspacePermissionGroups} scopeForRole={(role) => role.scope} warningForRole={(role) => role.key === "owner" ? "Owner 与成员管理权限会影响工作空间安全。权限树仅用于当前角色预览，权限修改尚未接入。" : "权限树仅用于当前角色预览，权限修改尚未接入。"} /></div>;
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

function MemberActionMenu({ member }) {
  const memberStatus = String(member.status || "").toLowerCase();
  const informUnavailable = (action) => {
    const name = memberDisplayName(member);
    notify.info(`${action}尚未接入`, {
      description: `${name} 的成员操作当前仅支持查看，不会修改成员数据。`,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`打开 ${memberDisplayName(member)} 的成员操作`} />}
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={() => informUnavailable("修改角色")}>修改角色</DropdownMenuItem>
        {memberStatus === "invited" && <DropdownMenuItem onClick={() => informUnavailable("重发邀请")}>重发邀请</DropdownMenuItem>}
        {memberStatus === "active" && <DropdownMenuItem onClick={() => informUnavailable("暂停成员")}>暂停成员</DropdownMenuItem>}
        {memberStatus === "suspended" && <DropdownMenuItem onClick={() => informUnavailable("恢复成员")}>恢复成员</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => informUnavailable("移除成员")}>移除成员</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MemberTable({ members }) {
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
      onAction={(member) => <>
        <DropdownMenuItem onClick={() => notify.info("修改角色尚未接入", { description: `${memberDisplayName(member)} 的成员操作当前仅支持查看。` })}>修改角色</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => notify.info("移除成员尚未接入", { description: `${memberDisplayName(member)} 的成员操作当前仅支持查看。` })}>移除成员</DropdownMenuItem>
      </>}
    />
    /*
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-56">成员</TableHead>
          <TableHead className="min-w-52">邮箱</TableHead>
          <TableHead>角色</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>加入时间</TableHead>
          <TableHead className="w-12 text-right"><span className="sr-only">操作</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id || member.user_id}>
            <TableCell>
              <div className="flex min-w-44 items-center gap-3">
                <Avatar size="sm">
                  <AvatarImage src={member.avatar_url || undefined} alt={memberDisplayName(member)} />
                  <AvatarFallback>{memberInitials(member)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate font-medium">{memberDisplayName(member)}</span>
              </div>
            </TableCell>
            <TableCell className="max-w-64 truncate text-muted-foreground">{member.email || "未设置邮箱"}</TableCell>
            <TableCell><Badge variant={memberRoleBadgeVariant(member.role)} size="sm">{memberRoleLabel(member.role)}</Badge></TableCell>
            <TableCell><Badge variant={memberStatusBadgeVariant(member.status)} size="sm">{memberStatusLabel(member.status)}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{formatMemberJoinedAt(member)}</TableCell>
            <TableCell className="text-right"><MemberActionMenu member={member} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>*/
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
  const membersRef = useRef(null);
  const requestRef = useRef(0);
  const invitationPanelOpen = route?.panel === "invitations";
  useWindowDetailRegistration({
    key: `workspace-members:${workspace.id}`,
    storageKey: "detailPane:workspace-members:v1",
    detailLabel: "成员邀请",
    triggerRef: invitationTriggerRef,
    getDetail: () => invitationPanelOpen ? <InvitationListPanel scope="workspace" scopeKey={workspace.id} title="成员邀请" canManage={workspace.role === "owner" || workspace.role === "admin"} roleOptions={[{ value: "member", label: "Member" }, ...(workspace.role === "owner" ? [{ value: "admin", label: "Admin" }] : [])]} listInvitations={() => listWorkspaceInvitations(workspace.id)} createInvitation={(payload) => createWorkspaceInvitation(workspace.id, payload)} revokeInvitation={(id) => revokeWorkspaceInvitation(workspace.id, id)} onChanged={() => loadMembers()} /> : null,
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

  const empty = error && !members
    ? { icon: UsersRound, title: "无法加载成员", description: error.message, action: <Button onClick={() => loadMembers({ withToast: true })} disabled={loading}><RefreshCw className={loading ? "animate-spin" : undefined} />重试</Button> }
    : members?.length === 0
      ? { icon: UsersRound, title: "暂无成员", description: "当前工作空间还没有可显示的成员。" }
      : filteredMembers.length === 0 && members
        ? { icon: UsersRound, title: "没有匹配成员", description: "请尝试调整搜索关键词或筛选条件。", action: <Button variant="outline" size="sm" onClick={clearMemberFilters}>清除筛选</Button> }
        : null;

  return (
    <ResourcePage
      title={route?.meta?.title || "成员"}
      description={route?.meta?.description || "管理可以访问这个工作空间的团队成员。"}
      count={members?.length || 0}
      summary={members ? <span>显示 {filteredMembers.length} / {members.length} 位成员</span> : null}
      search={{ value: query, onChange: setQuery, placeholder: "搜索姓名、邮箱或用户 ID" }}
      filters={<ResourceFilters fields={memberFilterFields} value={filterQuery} onChange={setFilterQuery} onClear={() => setFilterQuery(createFilterQuery())} />}
      showViewToggle={false}
      headerActions={<>{["owner", "admin"].includes(workspace.role) && <Button ref={invitationTriggerRef} onClick={() => navigate(`${workspacePath(workspace.id, "members")}?panel=invitations`)}><UsersRound />成员邀请</Button>}<Button variant="outline" onClick={() => loadMembers({ withToast: true })} disabled={loading}><RefreshCw className={loading ? "animate-spin" : undefined} />刷新</Button></>}
      loading={loading && !members}
      loadingContent={<MembersLoadingState />}
      empty={empty}
    >
      <Card variant="flush"><CardContent className="p-0"><MemberTable members={filteredMembers} /></CardContent></Card>
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
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{role.label}</CardTitle>
                  <Badge variant={role.key === "owner" ? "warning-light" : "primary-light"} size="sm">只读预览</Badge>
                </div>
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
