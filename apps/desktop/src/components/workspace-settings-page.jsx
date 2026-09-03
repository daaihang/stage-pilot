import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { notify } from "@/components/ui/sonner";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { getWorkspace, roleAtLeast, roleLabel, updateWorkspace } from "@/lib/workspace-api";

/**
 * 工作空间设置（Phase 9）：General + Members。
 * 仅限路由 /w/:workspaceId/settings。OWNER/ADMIN 可修改 General，
 * MEMBER 只读；成员列表所有成员可见。
 */
export function WorkspaceSettingsPage({ workspaceId }) {
  const { membershipRole, refreshWorkspaces } = useWorkspaceContext();
  const [workspace, setWorkspace] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = roleAtLeast(membershipRole, "admin");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const found = await getWorkspace(workspaceId);
      setWorkspace(found);
      setName(found.name);
      setDescription(found.description || "");
    } catch (error) {
      setLoadError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      notify.error("工作空间名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateWorkspace(workspaceId, { name: trimmed, description });
      setWorkspace((current) => ({ ...current, ...updated }));
      notify.success("工作空间设置已保存");
      refreshWorkspaces();
    } catch (error) {
      notify.error("保存失败", { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>无法加载工作空间设置</CardTitle>
          <CardDescription>{loadError.message}</CardDescription>
        </CardHeader>
        <CardContent><Button onClick={load}>重试</Button></CardContent>
      </Card>
    );
  }
  if (!workspace) return <div className="py-16 text-center text-sm text-muted-foreground">正在加载设置…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>常规</CardTitle>
          <CardDescription>工作空间的基础信息。{canManage ? "OWNER / ADMIN 可以修改。" : "你在这个工作空间是 MEMBER，只能查看。"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={save}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">名称</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={!canManage} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">描述</span>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} disabled={!canManage} />
            </label>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Slug</span>
              <p className="flex h-9 items-center border bg-muted/40 px-3 text-sm text-muted-foreground">{workspace.slug}</p>
            </div>
            {canManage && <Button type="submit" disabled={saving}>{saving ? "保存中…" : "保存更改"}</Button>}
          </form>
        </CardContent>
      </Card>
      <Separator />
      <MembersSection workspaceId={workspaceId} />
    </div>
  );
}

function MembersSection({ workspaceId }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { listWorkspaceMembers } = await import("@/lib/workspace-api");
      setMembers(await listWorkspaceMembers(workspaceId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>成员</CardTitle>
          <CardDescription>无法加载成员列表：{error.message}</CardDescription>
        </CardHeader>
        <CardContent><Button onClick={load}>重试</Button></CardContent>
      </Card>
    );
  }
  if (!members) return <div className="py-10 text-center text-sm text-muted-foreground">正在加载成员…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>成员</CardTitle>
        <CardDescription>这个工作空间目前有 {members.length} 位成员。邀请功能将在后续阶段开放。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>成员</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>加入时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{member.display_name || member.email || member.user_id}</span>
                    {member.email && <span className="text-xs text-muted-foreground">{member.email}</span>}
                  </div>
                </TableCell>
                <TableCell><Badge variant={member.role === "owner" ? "default" : "secondary"}>{roleLabel(member.role)}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(member.created_at).toLocaleDateString("zh-CN")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
