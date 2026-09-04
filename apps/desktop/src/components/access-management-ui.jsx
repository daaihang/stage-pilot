import { useMemo } from "react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { AlertTriangle, Ellipsis, KeyRound, ShieldAlert, ShieldCheck } from "@/components/ui/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { SettingsTabs } from "@/components/settings-tabs";

export function AccessMembersLoadingState() {
  return <div className="space-y-3 p-4" aria-label="正在加载成员">{["one", "two", "three", "four"].map((key) => <div key={key} className="flex items-center gap-3 border-b pb-3 last:border-0"><Skeleton className="size-8 rounded-full" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-56 max-w-full" /></div><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-20" /></div>)}</div>;
}

export function AccessMemberTable({ members, columns = {}, displayName, initials, roleLabel, roleVariant, statusLabel, statusVariant, joinedAt, onAction }) {
  const showSource = columns.source; const showExpiry = columns.expiry; const showRole = columns.role !== false;
  return <Table className="min-w-[760px]"><TableHeader><TableRow><TableHead className="min-w-56">成员</TableHead><TableHead className="min-w-52">邮箱</TableHead>{showRole && <TableHead>角色</TableHead>}{showSource && <TableHead>访问来源</TableHead>}<TableHead>状态</TableHead>{showExpiry ? <TableHead>访问期限</TableHead> : <TableHead>加入时间</TableHead>}<TableHead className="w-12 text-right"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{members.map((member) => <TableRow key={member.id || member.membership_id || member.user_id}><TableCell><div className="flex min-w-44 items-center gap-3"><Avatar size="sm"><AvatarImage src={member.avatar_url || undefined} alt={displayName(member)} /><AvatarFallback>{initials(member)}</AvatarFallback></Avatar><span className="min-w-0 truncate font-medium">{displayName(member)}</span></div></TableCell><TableCell className="max-w-64 truncate text-muted-foreground">{member.email || "未设置邮箱"}</TableCell>{showRole && <TableCell><div className="flex flex-wrap gap-1">{member.workspace_role && <Badge variant="outline" size="sm">Workspace {member.workspace_role}</Badge>}{member.direct_role || member.role_key || member.role ? <Badge variant={roleVariant?.(member.direct_role || member.role_key || member.role) || "primary-light"} size="sm">{roleLabel(member.direct_role || member.role_key || member.role)}</Badge> : <Badge variant="secondary" size="sm">继承查看</Badge>}</div></TableCell>}{showSource && <TableCell className="text-muted-foreground">{member.source === "both" ? "Workspace + 活动" : member.source === "workspace" ? "Workspace 继承" : "活动直接授权"}</TableCell>}<TableCell>{member.status ? <Badge variant={statusVariant?.(member.status) || "secondary"} size="sm">{statusLabel?.(member.status) || member.status}</Badge> : <Badge variant="secondary" size="sm">有效</Badge>}</TableCell><TableCell className="text-muted-foreground">{showExpiry ? (member.expires_at ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(member.expires_at)) : "长期访问") : (joinedAt?.(member) || "")}</TableCell><TableCell className="text-right">{onAction ? <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`打开 ${displayName(member)} 的成员操作`} />}><Ellipsis /></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-40">{onAction(member)}</DropdownMenuContent></DropdownMenu> : null}</TableCell></TableRow>)}</TableBody></Table>;
}

export function AccessPermissionTree({ groups, permissions }) {
  const items = useMemo(() => ({ permissions: { label: "全部权限", children: groups.map((group) => group.key) }, ...Object.fromEntries(groups.flatMap((group) => [[group.key, { label: group.label, children: group.permissions.map((item) => item.key) }], ...group.permissions.map((item) => [item.key, { label: item.label }])])) }), [groups]);
  const tree = useTree({ initialState: { expandedItems: ["permissions", ...groups.map((group) => group.key)] }, rootItemId: "permissions", getItemName: (item) => item.getItemData().label, isItemFolder: (item) => (item.getItemData()?.children?.length || 0) > 0, dataLoader: { getItem: (id) => items[id], getChildren: (id) => items[id]?.children || [] }, features: [syncDataLoaderFeature, hotkeysCoreFeature] });
  const state = (item) => { if (!item.isFolder()) return permissions.has(item.getId()) ? "checked" : "unchecked"; const children = item.getChildren().map(state); const checked = children.filter((value) => value === "checked").length; return checked === children.length && children.length ? "checked" : checked || children.includes("indeterminate") ? "indeterminate" : "unchecked"; };
  return <Tree tree={tree} indent={22} toggleIconType="chevron" aria-label="权限预览" aria-readonly="true" className="min-w-72">{tree.getItems().map((item) => { const itemState = state(item); return <TreeItem key={item.getId()} item={item} aria-checked={itemState === "indeterminate" ? "mixed" : itemState === "checked"}><TreeItemLabel className="min-w-0 not-in-data-[folder=true]:ps-5"><span className="flex min-w-0 items-center gap-2"><Checkbox checked={itemState === "checked"} indeterminate={itemState === "indeterminate"} disabled aria-checked={itemState === "indeterminate" ? "mixed" : itemState === "checked"} className="size-3.5" /><span className={item.isFolder() ? "font-medium" : "text-muted-foreground"}>{item.getItemName()}</span></span></TreeItemLabel></TreeItem>; })}</Tree>;
}

export function AccessRolesLayout({ roles, selectedRole, onRoleChange, permissionsForRole, groups, scopeForRole, header, warningForRole }) {
  const role = roles.find((item) => item.key === selectedRole) || roles[0];
  const permissions = permissionsForRole(role.key);
  const roleGroups = roles.map((item) => [item.key, item.label, ShieldCheck]);
  return <SettingsTabs groups={roleGroups} activeGroup={role.key} onGroupChange={onRoleChange} ariaLabel="角色"><AccessRolePreview role={role} permissions={permissions} groups={groups} scope={scopeForRole?.(role) || role.scope} warning={warningForRole?.(role) || "权限修改尚未接入。"} /></SettingsTabs>;
}

export function AccessRolePreview({ role, permissions, groups, scope, warning = "权限修改尚未接入。", warningTone = "warning" }) {
  const total = groups.flatMap((group) => group.permissions).length;
  const toneClass = warningTone === "danger" ? "border-destructive bg-destructive/10 text-destructive" : "border-warning bg-warning/10 text-warning-foreground";
  return <Card className="min-w-0"><CardHeader className="gap-4 border-b"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><CardTitle>{role.label}</CardTitle><Badge variant={role.key === "owner" || role.key === "producer" ? "warning-light" : "primary-light"} size="sm">只读预览</Badge></div><CardDescription>{role.description}</CardDescription></div><div className="flex shrink-0 gap-5 text-xs"><div><p className="text-muted-foreground">已授权权限</p><p className="mt-1 text-base font-semibold">{permissions.size} / {total}</p></div><div><p className="text-muted-foreground">作用范围</p><p className="mt-1 max-w-32 font-medium">{scope || role.scope}</p></div></div></div><div className={`flex items-start gap-2 border-l-2 px-3 py-2 text-xs ${toneClass}`}><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{warning}</span></div></CardHeader><CardContent className="min-w-0 space-y-3 p-4"><div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />权限树</div><div className="min-w-0 overflow-x-auto"><AccessPermissionTree groups={groups} permissions={permissions} /></div><p className="border-t pt-3 text-xs text-muted-foreground">父级复选框表示子权限状态：全部授权、部分授权或未授权。</p></CardContent></Card>;
}
