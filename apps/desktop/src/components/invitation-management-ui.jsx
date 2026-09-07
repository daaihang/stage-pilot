import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Link2, Plus, RefreshCw, Search, Trash2 } from "@/components/ui/icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { acceptInvitation } from "@/lib/invitation-api";
import { ListSurface } from "@/components/resource-page";

const statusLabels = { pending: "待接受", scheduled: "待生效", active: "部分接受", accepted: "已接受", exhausted: "已用尽", expired: "已过期", revoked: "已撤销" };
const statusVariants = { pending: "warning-light", scheduled: "secondary", active: "success-light", accepted: "success-light", exhausted: "secondary", expired: "destructive-light", revoked: "destructive-light" };

export function InvitationStatusBadge({ status }) {
  return <Badge variant={statusVariants[status] || "secondary"} size="sm">{statusLabels[status] || status || "未知状态"}</Badge>;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date);
}

function invitationLink(token) {
  return token ? `${window.location.origin}/#/invite/${token}` : "";
}

async function copyText(value) {
  try {
    await writeText(value);
    return true;
  } catch {}
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function InvitationLinkDialog({ open, onOpenChange, invitation }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!open) setCopied(false); }, [open]);
  const copy = async () => {
    if (!invitation?.link) return;
    if (await copyText(invitation.link)) {
      setCopied(true);
      notify.success("邀请链接已复制");
    } else {
      notify.error("复制失败", { description: "请在下方输入框中手动复制邀请链接。" });
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>邀请链接已生成</DialogTitle><DialogDescription>这条链接在有效期内保持不变。关闭窗口后，历史记录不能恢复旧 Token；需要发送新链接时，请使用邀请记录中的“重新生成链接”。</DialogDescription></DialogHeader><div className="space-y-2"><label className="text-sm font-medium" htmlFor="generated-invitation-link">邀请链接</label><div className="flex gap-2"><Input id="generated-invitation-link" readOnly value={invitation?.link || ""} className="min-w-0 font-mono text-xs" /><Button type="button" variant={copied ? "secondary" : "default"} onClick={copy}>{copied ? "已复制" : <><Copy />复制链接</>}</Button></div></div>{invitation?.target_email && <p className="text-xs text-muted-foreground">指定邮箱：{invitation.target_email}</p>}<DialogFooter><Button type="button" onClick={() => onOpenChange(false)}>完成</Button></DialogFooter></DialogContent></Dialog>;
}

export function InvitationDialog({ open, onOpenChange, scope, roleOptions = [], createInvitation, onCreated }) {
  const [role, setRole] = useState(roleOptions[0]?.value || "member");
  const [email, setEmail] = useState("");
  const [uses, setUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdInvitation, setCreatedInvitation] = useState(null);
  useEffect(() => { if (open) { setRole(roleOptions[0]?.value || "member"); setEmail(""); setUses("1"); setExpiresAt(""); } }, [open, roleOptions]);
  const workspace = scope === "workspace";
  const submit = async (event) => {
    event.preventDefault();
    if (workspace && !email.trim()) { notify.error("请输入受邀邮箱"); return; }
    setBusy(true);
    const toastId = notify.loading("正在创建邀请…");
    try {
      const payload = { role_key: role, ...(email.trim() ? { target_email: email.trim() } : {}), ...(expiresAt ? { expires_at: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}) };
      if (!workspace) payload.max_uses = email.trim() ? 1 : Math.min(100, Math.max(1, Number(uses) || 1));
      const result = await createInvitation(payload);
      const link = invitationLink(result?.accept_token);
      notify.success("邀请已创建", { id: toastId, description: link ? "请在弹出的窗口中复制邀请链接。" : "邀请已创建，但服务端没有返回可复制的 Token。" });
      if (link) setCreatedInvitation({ link, target_email: result?.target_email || email.trim() });
      onOpenChange(false); onCreated?.(result);
    } catch (error) { notify.error("创建邀请失败", { id: toastId, description: error?.message || String(error) }); }
    finally { setBusy(false); }
  };
  return <><Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{workspace ? "邀请工作空间成员" : "创建活动邀请"}</DialogTitle><DialogDescription>{workspace ? "接受后将进入整个工作空间。创建成功后会打开链接复制窗口。" : "可创建指定邮箱邀请或可多次领取的通用邀请链接。创建成功后会打开链接复制窗口。"}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><label className="block space-y-1"><span className="text-sm font-medium">角色</span><Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roleOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label><label className="block space-y-1"><span className="text-sm font-medium">指定邮箱{workspace ? "" : "（可选）"}</span><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={workspace ? "name@example.com" : "留空表示通用链接"} /></label>{!workspace && !email.trim() && <label className="block space-y-1"><span className="text-sm font-medium">最大领取次数（1–100）</span><Input type="number" min="1" max="100" value={uses} onChange={(event) => setUses(event.target.value)} /></label>}<label className="block space-y-1"><span className="text-sm font-medium">邀请有效期（可选，默认 7 天）</span><Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? <RefreshCw className="animate-spin" /> : <Link2 />}创建邀请</Button></DialogFooter></form></DialogContent></Dialog><InvitationLinkDialog open={Boolean(createdInvitation)} onOpenChange={(value) => !value && setCreatedInvitation(null)} invitation={createdInvitation} /></>;
}

export function InvitationListRow({ invitation, canManage, onRevoke, onRecreate, recreating }) {
  const email = invitation.target_email || "通用邀请链接";
  const isRevocable = canManage && !["revoked", "expired", "accepted", "exhausted"].includes(invitation.status);
  const isRecreatable = canManage && ["pending", "scheduled", "active"].includes(invitation.status);
  const inviteKind = invitation.invite_kind === "link" ? "通用链接" : "指定邮箱";
  const role = invitation.role_key || invitation.role_id || "—";
  return <div className="flex items-start gap-3 border-b p-4 last:border-b-0">
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{email}</span>
        <InvitationStatusBadge status={invitation.status} />
      </div>
      <div className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>角色：{role}</span>
        <span>类型：{inviteKind}</span>
        <span>{invitation.invite_kind === "link" ? `领取：${invitation.accepted_count || 0} / ${invitation.max_uses || 0}` : "单次接受"}</span>
        <span>有效至：{formatDate(invitation.expires_at)}</span>
      </div>
      {invitation.created_at && <p className="text-xs text-muted-foreground">创建于 {formatDate(invitation.created_at)}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {isRecreatable && <Button variant="ghost" size="icon-sm" aria-label="重新生成邀请链接" title="重新生成链接（会撤销旧链接）" disabled={recreating} onClick={() => onRecreate(invitation)}>{recreating ? <RefreshCw className="animate-spin" /> : <RefreshCw />}</Button>}
      {isRevocable && <Button variant="ghost" size="icon-sm" aria-label="撤销邀请" title="撤销邀请" onClick={() => onRevoke(invitation)}><Trash2 /></Button>}
    </div>
  </div>;
}

export function InvitationListPanel({ scope, scopeKey, canManage, listInvitations, createInvitation, revokeInvitation, roleOptions = [], title = "成员邀请", onChanged }) {
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdInvitation, setCreatedInvitation] = useState(null);
  const [recreatingId, setRecreatingId] = useState(null);
  const requestRef = useRef(0);
  const load = async (withToast = false) => {
    const requestId = ++requestRef.current;
    const toastId = withToast ? notify.loading("正在刷新邀请…") : undefined;
    try {
      const result = await listInvitations();
      if (requestId !== requestRef.current) { if (toastId) notify.dismiss(toastId); return; }
      setItems(Array.isArray(result) ? result : result?.items || []);
      setLoadError(null);
      if (toastId) notify.success("邀请已刷新", { id: toastId });
    } catch (error) {
      if (requestId !== requestRef.current) { if (toastId) notify.dismiss(toastId); return; }
      const nextError = error instanceof Error ? error : new Error(String(error || "请求失败"));
      setLoadError(nextError);
      if (toastId) notify.error("刷新邀请失败", { id: toastId, description: nextError.message }); else notify.error("无法加载邀请", { description: nextError.message });
    }
  };
  useEffect(() => { setItems(null); setLoadError(null); void load(); }, [scope, scopeKey]);
  const statusGroups = [["all", "全部"], ["pending", "待接受"], ["scheduled", "待生效"], ["active", "部分接受"], ["accepted", "已接受"], ["exhausted", "已用尽"], ["expired", "已过期"], ["revoked", "已撤销"]];
  const counts = useMemo(() => Object.fromEntries(statusGroups.map(([value]) => [value, value === "all" ? (items || []).length : (items || []).filter((item) => item.status === value).length])), [items]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return (items || []).filter((item) => {
      const matchesStatus = status === "all" || item.status === status;
      const searchable = [item.target_email, item.invite_kind, item.role_key, item.role_id, item.created_by].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
      return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [items, query, status]);
  const revoke = async (item) => { const toastId = notify.loading("正在撤销邀请…"); try { await revokeInvitation(item.id); notify.success("邀请已撤销", { id: toastId }); await load(); onChanged?.(); } catch (error) { notify.error("撤销邀请失败", { id: toastId, description: error?.message }); } };
  const recreate = async (item) => {
    if (recreatingId) return;
    setRecreatingId(item.id);
    const toastId = notify.loading("正在重新生成邀请链接…");
    const payload = {
      role_key: item.role_key,
      ...(item.target_email ? { target_email: item.target_email } : {}),
      ...(scope === "production" ? { max_uses: item.target_email ? 1 : Math.min(100, Math.max(1, Number(item.max_uses) || 1)) } : {}),
      ...(item.starts_at ? { starts_at: item.starts_at } : {}),
      ...(item.expires_at ? { expires_at: item.expires_at } : {}),
      ...(scope === "production" && item.member_starts_at ? { member_starts_at: item.member_starts_at } : {}),
      ...(scope === "production" && item.member_expires_at ? { member_expires_at: item.member_expires_at } : {}),
    };
    try {
      const result = await createInvitation(payload);
      const link = invitationLink(result?.accept_token);
      if (!link) throw new Error("服务端没有返回新的邀请 Token");
      let revokeError = null;
      try { await revokeInvitation(item.id); } catch (error) { revokeError = error; }
      setCreatedInvitation({ link, target_email: result?.target_email || item.target_email || "" });
      if (revokeError) notify.warning("新邀请链接已生成，但旧邀请仍有效", { id: toastId, description: revokeError?.message || "请在列表中撤销旧邀请。" });
      else notify.success("新邀请链接已生成", { id: toastId, description: "请在弹出的窗口中复制链接。" });
      await load();
      onChanged?.();
    } catch (error) {
      notify.error("重新生成邀请链接失败", { id: toastId, description: error?.message || String(error) });
    } finally {
      setRecreatingId(null);
    }
  };
  const description = scope === "workspace" ? "管理进入整个工作空间的成员邀请。" : "管理只授予当前活动访问权的邀请。";
  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canManage && <Button size="sm" onClick={() => setDialogOpen(true)}><Plus />新建邀请</Button>}
        <Button variant="outline" size="sm" onClick={() => load(true)}><RefreshCw />刷新</Button>
      </div>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>邀请状态</CardTitle>
        <p className="text-sm text-muted-foreground">按服务端计算的状态查看邀请记录。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList variant="line" className="w-full justify-start overflow-x-auto scrollbar-none">
            {statusGroups.map(([value, label]) => <TabsTrigger key={value} value={value} className="shrink-0">{label} <span className="ml-1 text-xs text-muted-foreground">{counts[value]}</span></TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮箱、角色或邀请类型" className="pl-8" aria-label="搜索邀请" />
        </div>
      </CardContent>
    </Card>

    <section className="min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">邀请记录</h2>
        <p className="text-xs text-muted-foreground">共 {filtered.length} 条匹配记录</p>
      </div>
      <ListSurface className="border-y">
        {items === null ? <div className="p-6 text-sm text-muted-foreground">正在加载邀请…</div> : loadError && filtered.length === 0 ? <div className="space-y-3 p-8 text-center text-sm"><p className="text-destructive">无法加载邀请：{loadError.message}</p><Button variant="outline" size="sm" onClick={() => load(true)}>重试</Button></div> : filtered.length ? filtered.map((item) => <InvitationListRow key={item.id} invitation={item} canManage={canManage} onRevoke={revoke} onRecreate={recreate} recreating={recreatingId === item.id} />) : <div className="p-8 text-center text-sm text-muted-foreground">暂无匹配的邀请记录</div>}
      </ListSurface>
    </section>

    <InvitationDialog open={dialogOpen} onOpenChange={setDialogOpen} scope={scope} roleOptions={roleOptions} createInvitation={createInvitation} onCreated={async () => { await load(); onChanged?.(); }} />
    <InvitationLinkDialog open={Boolean(createdInvitation)} onOpenChange={(value) => !value && setCreatedInvitation(null)} invitation={createdInvitation} />
  </div>;
}

export function JoinInvitationDialog({ open, onOpenChange, onAccepted }) {
  const [value, setValue] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event) => { event.preventDefault(); const token = value.trim().match(/(?:#\/invite\/|\/invite\/)?([^/?#\s]+)$/)?.[1]; if (!token) { notify.error("请输入有效的邀请链接或 Token"); return; } setBusy(true); const toastId = notify.loading("正在接受邀请…"); try { const result = await acceptInvitation(token); notify.success(result.scope_kind === "workspace" ? "已加入工作空间" : "已加入活动", { id: toastId }); onOpenChange(false); onAccepted?.(result); } catch (error) { notify.error("无法接受邀请", { id: toastId, description: error?.message || String(error) }); } finally { setBusy(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>加入工作空间或活动</DialogTitle><DialogDescription>粘贴邀请链接或原始 Token。Token 不会被保存。</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><Input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="粘贴邀请链接或 Token" /><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? <RefreshCw className="animate-spin" /> : <Link2 />}加入</Button></DialogFooter></form></DialogContent></Dialog>;
}
