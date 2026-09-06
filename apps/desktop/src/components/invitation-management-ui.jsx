import { useEffect, useMemo, useState } from "react";
import { Copy, Link2, Plus, RefreshCw, Trash2 } from "@/components/ui/icons";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";
import { acceptInvitation } from "@/lib/invitation-api";

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

export function InvitationDialog({ open, onOpenChange, scope, roleOptions = [], createInvitation, onCreated }) {
  const [role, setRole] = useState(roleOptions[0]?.value || "member");
  const [email, setEmail] = useState("");
  const [uses, setUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
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
      const token = result?.accept_token;
      if (token) {
        const link = `${window.location.origin}/#/invite/${token}`;
        try { await navigator.clipboard?.writeText(link); notify.success("邀请链接已复制", { id: toastId }); }
        catch { notify.success("邀请已创建", { id: toastId, description: "系统未能访问剪贴板，请重新创建并复制链接。" }); }
      } else notify.success("邀请已创建", { id: toastId });
      onOpenChange(false); onCreated?.(result);
    } catch (error) { notify.error("创建邀请失败", { id: toastId, description: error?.message || String(error) }); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{workspace ? "邀请工作空间成员" : "创建活动邀请"}</DialogTitle><DialogDescription>{workspace ? "接受后将进入整个工作空间。" : "可创建指定邮箱邀请或可多次领取的通用邀请链接。"}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><label className="block space-y-1"><span className="text-sm font-medium">角色</span><Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roleOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label><label className="block space-y-1"><span className="text-sm font-medium">指定邮箱{workspace ? "" : "（可选）"}</span><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={workspace ? "name@example.com" : "留空表示通用链接"} /></label>{!workspace && !email.trim() && <label className="block space-y-1"><span className="text-sm font-medium">最大领取次数（1–100）</span><Input type="number" min="1" max="100" value={uses} onChange={(event) => setUses(event.target.value)} /></label>}<label className="block space-y-1"><span className="text-sm font-medium">邀请有效期（可选，默认 7 天）</span><Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? <RefreshCw className="animate-spin" /> : <Link2 />}创建并复制</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function InvitationListRow({ invitation, canManage, onRevoke }) {
  const email = invitation.target_email || "通用邀请链接";
  const isRevocable = canManage && !["revoked", "expired", "accepted", "exhausted"].includes(invitation.status);
  return <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate font-medium">{email}</span><InvitationStatusBadge status={invitation.status} /></div><p className="mt-1 text-xs text-muted-foreground">{invitation.role_key} · {invitation.invite_kind === "link" ? `已领取 ${invitation.accepted_count || 0} / ${invitation.max_uses || 0}` : "指定邮箱"} · 有效至 {formatDate(invitation.expires_at)}</p></div>{isRevocable && <Button variant="ghost" size="icon-sm" aria-label="撤销邀请" onClick={() => onRevoke(invitation)}><Trash2 /></Button>}</div>;
}

export function InvitationListPanel({ scope, scopeKey, canManage, listInvitations, createInvitation, revokeInvitation, roleOptions = [], title = "成员邀请", onChanged }) {
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const load = async (withToast = false) => {
    const toastId = withToast ? notify.loading("正在刷新邀请…") : undefined;
    try { const result = await listInvitations(); setItems(Array.isArray(result) ? result : result?.items || []); setLoadError(null); if (toastId) notify.success("邀请已刷新", { id: toastId }); }
    catch (error) { const nextError = error instanceof Error ? error : new Error(String(error || "请求失败")); setLoadError(nextError); if (toastId) notify.error("刷新邀请失败", { id: toastId, description: nextError.message }); else notify.error("无法加载邀请", { description: nextError.message }); }
  };
  useEffect(() => { setItems(null); setLoadError(null); void load(); }, [scope, scopeKey]);
  const filtered = useMemo(() => (items || []).filter((item) => status === "all" || item.status === status), [items, status]);
  const revoke = async (item) => { const toastId = notify.loading("正在撤销邀请…"); try { await revokeInvitation(item.id); notify.success("邀请已撤销", { id: toastId }); await load(); onChanged?.(); } catch (error) { notify.error("撤销邀请失败", { id: toastId, description: error?.message }); } };
  return <Card className="min-w-0"><CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>{title}</CardTitle><div className="flex gap-2">{canManage && <Button size="sm" onClick={() => setDialogOpen(true)}><Plus />新建邀请</Button>}<Button variant="outline" size="sm" onClick={() => load(true)}><RefreshCw />刷新</Button></div></CardHeader><CardContent className="p-0"><div className="flex flex-wrap gap-1 border-y px-4 py-2">{[["all", "全部"], ["pending", "待接受"], ["scheduled", "待生效"], ["active", "部分接受"], ["accepted", "已接受"], ["exhausted", "已用尽"], ["expired", "已过期"], ["revoked", "已撤销"]].map(([value, label]) => <Button key={value} variant={status === value ? "secondary" : "ghost"} size="sm" onClick={() => setStatus(value)}>{label}</Button>)}</div>{items === null ? <div className="p-6 text-sm text-muted-foreground">正在加载邀请…</div> : loadError && filtered.length === 0 ? <div className="space-y-3 p-8 text-center text-sm"><p className="text-destructive">无法加载邀请：{loadError.message}</p><Button variant="outline" size="sm" onClick={() => load(true)}>重试</Button></div> : filtered.length ? filtered.map((item) => <InvitationListRow key={item.id} invitation={item} canManage={canManage} onRevoke={revoke} />) : <div className="p-8 text-center text-sm text-muted-foreground">暂无邀请记录</div>}</CardContent><InvitationDialog open={dialogOpen} onOpenChange={setDialogOpen} scope={scope} roleOptions={roleOptions} createInvitation={createInvitation} onCreated={async () => { await load(); onChanged?.(); }} /></Card>;
}

export function JoinInvitationDialog({ open, onOpenChange, onAccepted }) {
  const [value, setValue] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event) => { event.preventDefault(); const token = value.trim().match(/(?:#\/invite\/|\/invite\/)?([^/?#\s]+)$/)?.[1]; if (!token) { notify.error("请输入有效的邀请链接或 Token"); return; } setBusy(true); const toastId = notify.loading("正在接受邀请…"); try { const result = await acceptInvitation(token); notify.success(result.scope_kind === "workspace" ? "已加入工作空间" : "已加入活动", { id: toastId }); onOpenChange(false); onAccepted?.(result); } catch (error) { notify.error("无法接受邀请", { id: toastId, description: error?.message || String(error) }); } finally { setBusy(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>加入工作空间或活动</DialogTitle><DialogDescription>粘贴邀请链接或原始 Token。Token 不会被保存。</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><Input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="粘贴邀请链接或 Token" /><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? <RefreshCw className="animate-spin" /> : <Link2 />}加入</Button></DialogFooter></form></DialogContent></Dialog>;
}
