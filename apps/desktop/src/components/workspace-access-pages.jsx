import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleHelp,
  Ellipsis,
  KeyRound,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/components/ui/sonner";
import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameFooter, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { PageBreadcrumbs } from "@/components/stagepilot-pages";
import {
  formatMemberJoinedAt,
  listWorkspaceMembers,
  memberDisplayName,
  memberInitials,
  memberRoleBadgeVariant,
  memberRoleLabel,
  memberStatusBadgeVariant,
  memberStatusLabel,
} from "@/lib/workspace-api";
import {
  getWorkspaceRolePermissions,
  workspacePermissionGroups,
  workspaceRoles,
} from "@/lib/workspace-permissions";

function AccessPageIntro({ route, workspace, action }) {
  return (
    <div className="space-y-4">
      <PageBreadcrumbs route={route} workspace={workspace} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{route.meta.title}</h1>
          <p className="text-sm text-muted-foreground">{route.meta.description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
      <Icon className="size-6" />
      <p className="font-medium text-foreground">{title}</p>
      <p>{description}</p>
      {action}
    </div>
  );
}

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

const roleFilterOptions = [
  ["all", "全部角色"],
  ["owner", "Owner"],
  ["admin", "Admin"],
  ["member", "Member"],
];

const statusFilterOptions = [
  ["all", "全部状态"],
  ["active", "已启用"],
  ["invited", "待接受"],
  ["suspended", "已暂停"],
];

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
    <Table>
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
    </Table>
  );
}

export function WorkspaceMembersPage({ route, workspace }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const membersRef = useRef(null);
  const requestRef = useRef(0);

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
    return (members || []).filter((member) => {
      const searchable = [memberDisplayName(member), member.email, member.user_id]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesRole = roleFilter === "all" || String(member.role || "").toLowerCase() === roleFilter;
      const matchesStatus = statusFilter === "all" || String(member.status || "").toLowerCase() === statusFilter;
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [members, query, roleFilter, statusFilter]);

  const hasFilters = Boolean(query.trim() || roleFilter !== "all" || statusFilter !== "all");
  const clearFilters = () => {
    setQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
    notify.info("已清除成员筛选");
  };

  return (
    <div className="space-y-6">
      <AccessPageIntro
        route={route}
        workspace={workspace}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => notify.info("邀请成员 API 尚未接入", { description: "当前仅支持查看，不会发送邀请。" })}>
              <UserPlus />邀请成员
            </Button>
            <Button variant="outline" onClick={() => loadMembers({ withToast: true })} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : undefined} />刷新
            </Button>
          </div>
        }
      />

      {error && !members ? (
        <Card>
          <CardHeader>
            <CardTitle>无法加载成员</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => loadMembers({ withToast: true })} disabled={loading}><RefreshCw className={loading ? "animate-spin" : undefined} />重试</Button>
          </CardContent>
        </Card>
      ) : (
        <Frame spacing="sm" className="min-w-0">
          <FramePanel className="p-0!">
            <FrameHeader className="gap-3 border-b">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <FrameTitle>团队成员</FrameTitle>
                  <FrameDescription className="mt-1">查看成员身份、角色和当前访问状态。</FrameDescription>
                </div>
                {members && <p className="text-xs text-muted-foreground">显示 {filteredMembers.length} / {members.length} 位成员</p>}
              </div>
              <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(220px,1fr)_150px_150px_auto]">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或邮箱" aria-label="搜索姓名或邮箱" className="pl-8" />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-full" aria-label="按角色筛选"><SelectValue /></SelectTrigger>
                  <SelectContent>{roleFilterOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full" aria-label="按状态筛选"><SelectValue /></SelectTrigger>
                  <SelectContent>{statusFilterOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
                {hasFilters ? <Button variant="ghost" onClick={clearFilters}>清除筛选</Button> : <span />}
              </div>
            </FrameHeader>
            {loading && !members ? <MembersLoadingState /> : members?.length === 0 ? (
              <EmptyState icon={UsersRound} title="暂无成员" description="当前工作空间还没有可显示的成员。" />
            ) : filteredMembers.length === 0 ? (
              <EmptyState
                icon={Search}
                title="没有匹配成员"
                description="请尝试调整搜索关键词或筛选条件。"
                action={<Button variant="outline" size="sm" onClick={clearFilters}>清除筛选</Button>}
              />
            ) : (
              <MemberTable members={filteredMembers} />
            )}
            <FrameFooter className="border-t text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><CircleHelp className="size-3.5" />成员变更操作尚未接入，当前仅支持查看。</span>
            </FrameFooter>
          </FramePanel>
        </Frame>
      )}
    </div>
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
  const tree = useTree({
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
  );
}

export function WorkspaceRolesPage({ route, workspace }) {
  const [selectedRole, setSelectedRole] = useState("owner");
  const role = workspaceRoles.find((item) => item.key === selectedRole) || workspaceRoles[0];
  const permissions = getWorkspaceRolePermissions(role.key);

  return (
    <div className="space-y-6">
      <AccessPageIntro route={route} workspace={workspace} />
      <Frame spacing="sm" className="min-w-0 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <FramePanel className="min-w-0 p-0!">
          <FrameHeader className="border-b">
            <FrameTitle>角色</FrameTitle>
            <FrameDescription className="mt-1">选择角色查看它的权限范围。</FrameDescription>
          </FrameHeader>
          <div className="flex flex-col gap-1 p-2">
            {workspaceRoles.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`flex min-w-0 items-start gap-2 border px-3 py-3 text-left text-xs outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring ${item.key === role.key ? "border-primary/40 bg-muted" : "border-transparent"}`}
                onClick={() => setSelectedRole(item.key)}
                aria-pressed={item.key === role.key}
              >
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium">{item.label}</span>
                  <span className="mt-1 block text-muted-foreground">{item.description}</span>
                </span>
              </button>
            ))}
          </div>
          <FrameFooter className="border-t text-xs text-muted-foreground">仅展示后端当前支持的三个角色</FrameFooter>
        </FramePanel>

        <FramePanel className="min-w-0 p-0!">
          <FrameHeader className="gap-3 border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FrameTitle>{role.label}</FrameTitle>
                  <Badge variant={role.key === "owner" ? "warning-light" : "primary-light"} size="sm">只读预览</Badge>
                </div>
                <FrameDescription className="mt-1">{role.description}</FrameDescription>
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
          </FrameHeader>
          <div className="min-w-0 overflow-x-auto p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />权限树</div>
            <PermissionTree permissions={permissions} />
          </div>
          <FrameFooter className="border-t text-xs text-muted-foreground">父级复选框表示子权限状态：全部授权、部分授权或未授权。权限修改需要服务端支持。</FrameFooter>
        </FramePanel>
      </Frame>
    </div>
  );
}
