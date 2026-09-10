import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import { CampaignFormRenderer } from "@/components/campaign-form-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, RefreshCw, Search, Star } from "@/components/ui/icons";
import { notify } from "@/components/ui/sonner";
import { getEntry, listCampaignEntries, listEntryRevisions, updateEntryInboxState } from "@/lib/campaign-api";

const STATUS_LABELS = {
  draft: "草稿", submitted: "已提交", in_review: "审核中", needs_changes: "待补件",
  accepted: "已确认", waitlisted: "候补", rejected: "未通过", withdrawn: "已撤回",
  converted: "已转化", conversion_failed: "转化异常",
};

function formatDate(value) {
  if (!value) return "未设置";
  try { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return value; }
}

function InboxDetail({ detail, revisions, onStateChanged }) {
  const [raw, setRaw] = useState(false);
  const entry = detail?.entry;
  const state = detail?.inboxState || {};
  const toggle = async (key, value) => {
    try {
      const next = await updateEntryInboxState(entry.id, { [key]: value });
      onStateChanged(next);
      notify.success(key === "is_starred" ? (value ? "已标记星标" : "已取消星标") : (value ? "已标记为已读" : "已标记为未读"));
    } catch (error) {
      notify.error("更新收件箱状态失败", { description: error?.message || String(error) });
    }
  };
  if (!entry) return <div className="p-5 text-sm text-muted-foreground">选择一条提交记录查看详情。</div>;
  return <div className="min-h-full space-y-4 p-5">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">Entry</p><h2 className="truncate text-lg font-semibold">{entry.id}</h2><p className="mt-1 text-xs text-muted-foreground">提交于 {formatDate(entry.submittedAt)}</p></div><Button type="button" variant={state.isStarred ? "secondary" : "ghost"} size="icon" aria-label={state.isStarred ? "取消星标" : "标记星标"} onClick={() => void toggle("is_starred", !state.isStarred)}><Star className={state.isStarred ? "fill-current" : ""} /></Button></div>
    <div className="flex flex-wrap items-center gap-2"><Badge>{STATUS_LABELS[entry.status] || entry.status}</Badge>{entry.contactEmail ? <span className="text-xs text-muted-foreground">{entry.contactEmail}</span> : null}<Button type="button" variant="ghost" size="sm" onClick={() => void toggle("is_read", !state.isRead)}>{state.isRead ? "标记未读" : "标记已读"}</Button></div>
    <Card><CardHeader><CardTitle className="text-sm">提交信息</CardTitle></CardHeader><CardContent className="space-y-2 text-xs"><div className="flex justify-between gap-3"><span className="text-muted-foreground">Campaign Revision</span><span className="font-mono">{entry.campaignRevisionId}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">当前答案版本</span><span>v{entry.currentRevisionNo}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">最近活动</span><span>{formatDate(entry.lastActivityAt)}</span></div></CardContent></Card>
    {detail.formVersion && detail.currentRevision ? <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><div><CardTitle className="text-sm">答案</CardTitle><CardDescription>使用提交时绑定的 FormVersion 渲染，不用当前最新表单解释历史答案。</CardDescription></div><Button type="button" variant="outline" size="sm" onClick={() => setRaw((value) => !value)}>{raw ? "表单视图" : "原始 JSON"}</Button></CardHeader><CardContent>{raw ? <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(detail.currentRevision.answers || {}, null, 2)}</pre> : <CampaignFormRenderer form={detail.formVersion} title="提交答案" mode="readonly" initialAnswers={detail.currentRevision.answers || {}} readOnly />}</CardContent></Card> : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">暂无答案内容。</CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-sm">版本历史</CardTitle></CardHeader><CardContent className="space-y-1">{revisions.length ? revisions.map((revision) => <div key={revision.id} className="flex items-center justify-between gap-3 border-b py-2 text-xs last:border-0"><span>Revision {revision.revisionNo}</span><span className="text-muted-foreground">{revision.source} · {formatDate(revision.createdAt)}</span></div>) : <p className="text-sm text-muted-foreground">暂无历史版本。</p>}</CardContent></Card>
    <div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardTitle className="text-sm">决定</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{detail.decision ? `${detail.decision.type} · ${detail.decision.reason || "无备注"}` : "当前没有 Decision。"}</CardContent></Card><Card><CardHeader><CardTitle className="text-sm">转化</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{detail.materializations?.length ? `${detail.materializations.length} 条转化记录` : "当前没有 Materialization。"}</CardContent></Card></div>
  </div>;
}

export function CampaignEntryInbox({ campaignId }) {
  const { detailOpen, setDetailOpen } = useWindowDetail();
  const triggerRef = useRef(null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [isUnread, setIsUnread] = useState("all");
  const [isStarred, setIsStarred] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const filters = useMemo(() => ({ q: query.trim() || undefined, status: status === "all" ? undefined : status, is_unread: isUnread === "all" ? undefined : isUnread === "true", is_starred: isStarred === "all" ? undefined : isStarred === "true", limit: 50 }), [isStarred, isUnread, query, status]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const result = await listCampaignEntries(campaignId, filters); setItems(result.items); setSummary(result.summary || {}); }
    catch (nextError) { setError(nextError); notify.error("无法加载提交记录", { description: nextError?.message || String(nextError) }); }
    finally { setLoading(false); }
  }, [campaignId, filters]);
  useEffect(() => { void load(); }, [load]);

  const openEntry = async (item) => {
    setSelectedId(item.id); setDetailLoading(true); setDetail(null); setRevisions([]); setDetailOpen(true);
    try { const [nextDetail, history] = await Promise.all([getEntry(item.id), listEntryRevisions(item.id)]); setDetail(nextDetail); setRevisions(history.items || []); setItems((current) => current.map((row) => row.id === item.id ? { ...row, inboxState: { ...row.inboxState, isRead: true } } : row)); }
    catch (nextError) { notify.error("无法加载提交详情", { description: nextError?.message || String(nextError) }); }
    finally { setDetailLoading(false); }
  };
  const onStateChanged = (next) => { setDetail((current) => current ? { ...current, inboxState: { isRead: next.isRead, isStarred: next.isStarred } } : current); setItems((current) => current.map((item) => item.id === selectedId ? { ...item, inboxState: { isRead: next.isRead, isStarred: next.isStarred } } : item)); };
  const getDetail = useCallback(() => detailLoading ? <div className="p-5 text-sm text-muted-foreground">正在加载提交详情…</div> : <InboxDetail detail={detail} revisions={revisions} onStateChanged={onStateChanged} />, [detail, detailLoading, revisions, selectedId]);
  useWindowDetailRegistration({ key: `campaign-entry:${campaignId}`, storageKey: "detailPane:campaign-entry:v1", detailLabel: "Entry 详情", triggerRef, getDetail, onClose: () => { setSelectedId(null); setDetail(null); setRevisions([]); } });

  return <Card><CardHeader className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Entry 收件箱</CardTitle><CardDescription>提交记录查询投影；已读和星标只属于当前用户，不改变 Entry 状态。</CardDescription></div><Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw />刷新</Button></div><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_8rem_8rem]"><div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Entry、邮箱或答案" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={isUnread} onValueChange={setIsUnread}><SelectTrigger><SelectValue placeholder="已读状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部已读状态</SelectItem><SelectItem value="true">未读</SelectItem><SelectItem value="false">已读</SelectItem></SelectContent></Select><Select value={isStarred} onValueChange={setIsStarred}><SelectTrigger><SelectValue placeholder="星标" /></SelectTrigger><SelectContent><SelectItem value="all">全部星标</SelectItem><SelectItem value="true">已标星</SelectItem><SelectItem value="false">未标星</SelectItem></SelectContent></Select></div></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>全部 {summary.all ?? 0}</span><span>已提交 {summary.submitted ?? 0}</span><span>审核中 {summary.in_review ?? 0}</span><span>待补件 {summary.needs_changes ?? 0}</span></div>{loading ? <div className="flex min-h-36 items-center justify-center text-sm text-muted-foreground">正在加载提交记录…</div> : error ? <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><p>提交记录加载失败。</p><Button type="button" variant="outline" size="sm" onClick={() => void load()}>重试</Button></div> : items.length ? <div className="divide-y rounded-md border">{items.map((item) => <div key={item.id} className={`flex items-center gap-3 px-3 py-3 text-sm transition-colors hover:bg-muted/40 ${!item.inboxState.isRead ? "bg-primary/5" : ""}`}><button type="button" ref={selectedId === item.id ? triggerRef : undefined} className="min-w-0 flex-1 text-left" onClick={() => void openEntry(item)}><div className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{item.id}</span>{!item.inboxState.isRead ? <Badge variant="secondary">未读</Badge> : null}<Badge variant="outline">{STATUS_LABELS[item.status] || item.status}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.contactEmail || "匿名提交"} · {formatDate(item.submittedAt || item.lastActivityAt)} · Revision {item.currentRevisionNo}</p></button><Button type="button" variant={item.inboxState.isStarred ? "secondary" : "ghost"} size="icon" aria-label={item.inboxState.isStarred ? "取消星标" : "标记星标"} onClick={async (event) => { event.stopPropagation(); try { const next = await updateEntryInboxState(item.id, { isStarred: !item.inboxState.isStarred }); setItems((current) => current.map((row) => row.id === item.id ? { ...row, inboxState: { ...row.inboxState, isStarred: next.isStarred } } : row)); notify.success(next.isStarred ? "已标记星标" : "已取消星标"); } catch (nextError) { notify.error("更新星标失败", { description: nextError?.message || String(nextError) }); } }}><Star className={item.inboxState.isStarred ? "fill-current" : ""} /></Button><Button type="button" variant="ghost" size="icon" aria-label="打开 Entry 详情" onClick={() => void openEntry(item)}><Eye /></Button></div>)}</div> : <div className="flex min-h-36 items-center justify-center border border-dashed text-sm text-muted-foreground">当前筛选下暂无提交记录。</div>}</CardContent></Card>;
}
