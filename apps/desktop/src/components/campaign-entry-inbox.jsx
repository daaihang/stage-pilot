import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import { CampaignFormRenderer } from "@/components/campaign-form-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, RefreshCw, Search, Star } from "@/components/ui/icons";
import { notify } from "@/components/ui/sonner";
import { assignEntryReviewTask, createEntryDecision, getEntry, listCampaignEntries, listEntryRevisions, updateEntryInboxState } from "@/lib/campaign-api";
import { listProductionMembers } from "@/lib/production-api";

const STATUS_LABELS = {
  draft: "草稿", submitted: "已提交", in_review: "审核中", needs_changes: "待补件",
  accepted: "已确认", waitlisted: "候补", rejected: "未通过", withdrawn: "已撤回",
  converted: "已转化", conversion_failed: "转化异常",
};

const DECISION_ACTIONS = {
  accept: { label: "接受", loading: "正在接受提交…", success: "已接受提交", variant: "default" },
  waitlist: { label: "候补", loading: "正在设为候补…", success: "已设为候补", variant: "secondary" },
  reject: { label: "拒绝", loading: "正在拒绝提交…", success: "已拒绝提交", variant: "destructive" },
};

const DECIDABLE_STATUSES = new Set(["submitted", "in_review", "needs_changes", "accepted", "waitlisted", "rejected"]);

function formatDate(value) {
  if (!value) return "未设置";
  try { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return value; }
}

function DecisionDialog({ actionType, busy, legacyRequired, onOpenChange, onSubmit }) {
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [legacyOverride, setLegacyOverride] = useState(false);
  const action = actionType ? DECISION_ACTIONS[actionType] : null;
  const requiresReason = actionType === "reject" || legacyRequired;
  const missingReason = requiresReason && attempted && !reason.trim();

  useEffect(() => {
    if (actionType) {
      setReason("");
      setAttempted(false);
      setLegacyOverride(false);
    }
  }, [actionType]);

  const submit = async (event) => {
    event.preventDefault();
    setAttempted(true);
    if (!action || (requiresReason && !reason.trim()) || (legacyRequired && !legacyOverride)) return;
    try {
      await onSubmit({ type: actionType, reason: reason.trim(), legacyOverride });
      onOpenChange(false);
    } catch {
      // notify.promise in the owning mutation already presents the failure.
    }
  };

  if (!action) return null;
  return (
    <Dialog open={Boolean(actionType)} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>确认{action.label}提交</DialogTitle>
            <DialogDescription>{legacyRequired ? "当前 Entry 属于未兼容的存量审核流程。覆盖操作会留存处理原因与审计标记。" : requiresReason ? "拒绝原因将作为当前决定的一部分保存，并向可查看该 Entry 的成员展示。" : "此操作会追加一条决定记录，并将 Entry 状态更新为当前决定结果。"}</DialogDescription>
          </DialogHeader>
          {legacyRequired ? <label className="flex items-start gap-2 text-xs"><Checkbox checked={legacyOverride} onCheckedChange={(checked) => setLegacyOverride(checked === true)} /><span>我确认按存量流程覆盖此审核结果</span></label> : null}
          <Field data-invalid={missingReason || undefined}>
            <FieldLabel htmlFor="entry-decision-reason">{legacyRequired ? "遗留流程处理原因" : "决定备注"}{requiresReason ? "（必填）" : "（可选）"}</FieldLabel>
            <Textarea id="entry-decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} aria-invalid={missingReason || undefined} aria-describedby={missingReason ? "entry-decision-reason-error" : undefined} autoFocus />
            {missingReason ? <FieldError id="entry-decision-reason-error">请填写拒绝原因。</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
            <Button type="submit" variant={action.variant} disabled={busy || (legacyRequired && !legacyOverride)}>{busy ? "正在保存…" : "确认" + action.label}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRunCard({ detail, members, onAssign, assignmentBusy }) {
  const [taskId, setTaskId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const run = detail?.review;
  const activeReviewers = members || [];
  useEffect(() => { setTaskId(""); setReviewerId(""); setReason(""); }, [run?.id]);
  if (!run) return <Card><CardHeader><CardTitle className="text-sm">审核状态</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>该存量提交没有可运行的审核任务。管理员可使用带原因的遗留流程覆盖作出决定。</p></CardContent></Card>;
  const runLabels = { awaiting_assignment: "待补足审核人", collecting_feedback: "收集审核意见中", ready_for_decision: "已达到决定门槛", decided: "已完成决定", blocked_unsupported: "存量审核配置不兼容", legacy_override_decided: "已通过遗留流程覆盖" };
  const pendingTasks = run.tasks.filter((task) => task.status === "pending");
  const currentTask = run.tasks.find((task) => task.id === taskId);
  const submitAssignment = async (event) => {
    event.preventDefault();
    if (!reviewerId || !reason.trim()) return;
    try {
      await onAssign(detail.entry.id, { taskId, reviewerId, reason: reason.trim() });
      setTaskId(""); setReviewerId(""); setReason("");
    } catch {
      // The owning mutation presents the failure toast and keeps the draft intact.
    }
  };
  return <Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-sm">单轮审核</CardTitle><Badge variant={run.status === "ready_for_decision" ? "default" : "secondary"}>{runLabels[run.status] || run.status}</Badge></div><CardDescription>门槛进度 {run.completedCount}/{run.requiredCount} · 已分配 {run.assignedCount}/{run.taskCount} · {run.completionMode === "all" ? "要求全员完成" : "至少 N 人完成"}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {run.tasks.map((task, index) => {
        const assignment = task.assignments.find((item) => item.current);
        return <div key={task.id} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">审核任务 {index + 1}</span><Badge variant="outline">{task.status === "pending" ? "待反馈" : task.status === "submitted" ? "已反馈" : "决定后关闭"}</Badge></div>
          <p className="text-xs text-muted-foreground">当前审核人：{assignment?.name || "待分配"}{assignment ? ` · ${assignment.reviewerId}${assignment.current && !assignment.active ? " · 成员已失效，需改派" : ""}` : ""}</p>
          {task.assignments.length > 1 ? <div className="space-y-1 border-l pl-3 text-[11px] text-muted-foreground">{task.assignments.map((item) => <p key={item.id}>{item.name || item.reviewerId} · {item.source === "manual" ? `改派：${item.reason}` : item.source === "migration_backfill" ? item.reason : "提交时分配"}</p>)}</div> : null}
          {task.feedback.map((item) => <div key={item.id} className="rounded bg-muted/50 p-2 text-xs"><p className="font-medium">{item.reviewerName} · {item.recommendation === "recommend" ? "建议接受" : item.recommendation === "do_not_recommend" ? "不建议接受" : "无明确意见"}{item.isCurrent ? " · 当前" : " · 已修订"}</p><p className="mt-1 whitespace-pre-wrap">{item.comment}</p><p className="mt-1 text-muted-foreground">{formatDate(item.createdAt)}</p></div>)}
        </div>;
      })}
      {detail.canManageReview && run.status !== "blocked_unsupported" && run.status !== "decided" && run.status !== "legacy_override_decided" ? <form className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-2" onSubmit={(event) => void submitAssignment(event)}>
        <p className="text-xs font-medium sm:col-span-2">补充或改派审核人</p>
        <Select value={taskId || "__new__"} onValueChange={(value) => setTaskId(value === "__new__" ? "" : value)}><SelectTrigger aria-label="选择待改派任务"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__new__">新增审核任务</SelectItem>{pendingTasks.map((task, index) => <SelectItem key={task.id} value={task.id}>改派待反馈任务 {index + 1}</SelectItem>)}</SelectContent></Select>
        <Select value={reviewerId} onValueChange={setReviewerId}><SelectTrigger aria-label="选择有效审核人"><SelectValue placeholder="选择有效审核人" /></SelectTrigger><SelectContent>{activeReviewers.map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>)}</SelectContent></Select>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="sm:col-span-2" placeholder={currentTask ? "必填：说明改派原因" : "必填：说明补充分配原因"} />
        <Button type="submit" size="sm" className="sm:col-span-2 sm:justify-self-end" disabled={assignmentBusy || !reviewerId || !reason.trim()}>{assignmentBusy ? "正在保存…" : taskId ? "确认改派" : "补充审核人"}</Button>
      </form> : null}
      {run.status === "awaiting_assignment" ? <p className="text-xs text-amber-700">当前有效审核人不足以满足原门槛；提交仍已保存，门槛不会自动降低。</p> : null}
      {run.status === "blocked_unsupported" ? <p className="text-xs text-amber-700">此运行保留为存量异常记录，不能补派或提交新反馈；最终决定需要走带原因的遗留流程覆盖。</p> : null}
    </CardContent>
  </Card>;
}

function InboxDetail({ detail, revisions, members, onStateChanged, onDecision, onAssign, decisionBusy, assignmentBusy }) {
  const [raw, setRaw] = useState(false);
  const [decisionType, setDecisionType] = useState(null);
  const entry = detail?.entry;
  const state = detail?.inboxState || {};
  const runReady = detail?.review?.status === "ready_for_decision" || detail?.review?.status === "decided" || detail?.review?.status === "legacy_override_decided";
  const hasPriorDecision = Boolean(detail?.decision);
  const canDecide = Boolean(detail?.canDecide && DECIDABLE_STATUSES.has(entry?.status) && (runReady || hasPriorDecision || detail?.review?.status === "blocked_unsupported" || !detail?.review));
  const legacyRequired = detail?.review?.status === "blocked_unsupported" || !detail?.review;

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

  return (
    <div className="min-h-full space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Entry</p>
          <h2 className="truncate text-lg font-semibold">{entry.id}</h2>
          <p className="mt-1 text-xs text-muted-foreground">提交于 {formatDate(entry.submittedAt)}</p>
        </div>
        <Button type="button" variant={state.isStarred ? "secondary" : "ghost"} size="icon" aria-label={state.isStarred ? "取消星标" : "标记星标"} onClick={() => void toggle("is_starred", !state.isStarred)}>
          <Star className={state.isStarred ? "fill-current" : ""} />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{STATUS_LABELS[entry.status] || entry.status}</Badge>
        {entry.contactEmail ? <span className="text-xs text-muted-foreground">{entry.contactEmail}</span> : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => void toggle("is_read", !state.isRead)}>{state.isRead ? "标记未读" : "标记已读"}</Button>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">提交信息</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Campaign Revision</span><span className="font-mono">{entry.campaignRevisionId}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">当前答案版本</span><span>v{entry.currentRevisionNo}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">最近活动</span><span>{formatDate(entry.lastActivityAt)}</span></div>
        </CardContent>
      </Card>
      {detail.formVersion && detail.currentRevision ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div><CardTitle className="text-sm">答案</CardTitle><CardDescription>使用提交时绑定的 FormVersion 渲染，不用当前最新表单解释历史答案。</CardDescription></div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRaw((value) => !value)}>{raw ? "表单视图" : "原始 JSON"}</Button>
          </CardHeader>
          <CardContent>{raw ? <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(detail.currentRevision.answers || {}, null, 2)}</pre> : <CampaignFormRenderer form={detail.formVersion} title="提交答案" mode="readonly" initialAnswers={detail.currentRevision.answers || {}} readOnly />}</CardContent>
        </Card>
      ) : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">暂无答案内容。</CardContent></Card>}
      <ReviewRunCard detail={detail} members={members} onAssign={onAssign} assignmentBusy={assignmentBusy} />
      <Card>
        <CardHeader><CardTitle className="text-sm">版本历史</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {revisions.length ? revisions.map((revision) => <div key={revision.id} className="flex items-center justify-between gap-3 border-b py-2 text-xs last:border-0"><span>Revision {revision.revisionNo}</span><span className="text-muted-foreground">{revision.source} · {formatDate(revision.createdAt)}</span></div>) : <p className="text-sm text-muted-foreground">暂无历史版本。</p>}
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-sm">决定</CardTitle>
            {detail.canDecide && DECIDABLE_STATUSES.has(entry.status) && !runReady && !hasPriorDecision && detail.review?.status !== "blocked_unsupported" && detail.review ? <p className="text-xs text-muted-foreground">审核门槛尚未达到，当前不可作最终决定。</p> : null}
            {canDecide ? <div className="flex flex-wrap gap-2">{Object.entries(DECISION_ACTIONS).map(([type, action]) => <Button key={type} type="button" size="sm" variant={action.variant} onClick={() => setDecisionType(type)} disabled={decisionBusy}>{action.label}</Button>)}</div> : null}
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {detail.decision ? <div className="rounded-md border p-3"><p className="font-medium text-foreground">当前：{DECISION_ACTIONS[detail.decision.type]?.label || detail.decision.type}</p><p className="mt-1">{detail.decision.reason || "无备注"}</p><p className="mt-1 text-xs">作出于 {formatDate(detail.decision.decidedAt)}</p></div> : <p>当前没有 Decision。</p>}
            {detail.decisionHistory?.length ? <div className="space-y-2"><p className="text-xs font-medium text-foreground">决定历史</p>{detail.decisionHistory.map((decision) => <div key={decision.id} className="border-t pt-2 text-xs"><p className="font-medium text-foreground">{DECISION_ACTIONS[decision.type]?.label || decision.type}</p><p>{decision.reason || "无备注"} · {formatDate(decision.decidedAt)}</p></div>)}</div> : null}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-sm">转化</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{detail.materializations?.length ? detail.materializations.length + " 条转化记录" : "当前没有 Materialization。"}</CardContent></Card>
      </div>
      <DecisionDialog actionType={decisionType} busy={decisionBusy} legacyRequired={legacyRequired} onOpenChange={(open) => !open && setDecisionType(null)} onSubmit={(payload) => onDecision(entry.id, payload)} />
    </div>
  );
}

export function CampaignEntryInbox({ campaignId }) {
  const { setDetailOpen } = useWindowDetail();
  const triggerRef = useRef(null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [isUnread, setIsUnread] = useState("all");
  const [isStarred, setIsStarred] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reviewMembers, setReviewMembers] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const listRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const nextCursorRef = useRef(null);
  const loadingMoreRef = useRef(false);

  const filters = useMemo(() => ({
    q: query.trim() || undefined,
    status: status === "all" ? undefined : status,
    is_unread: isUnread === "all" ? undefined : isUnread === "true",
    is_starred: isStarred === "all" ? undefined : isStarred === "true",
    limit: 50,
  }), [isStarred, isUnread, query, status]);

  const load = useCallback(async ({ append = false } = {}) => {
    if (append && (loadingMoreRef.current || !nextCursorRef.current)) return;
    const requestId = ++listRequestSeqRef.current;
    const cursor = append ? nextCursorRef.current : undefined;
    if (append) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      nextCursorRef.current = null;
      setNextCursor(null);
      setLoading(true);
    }
    setError(null);
    try {
      const result = await listCampaignEntries(campaignId, { ...filters, cursor });
      if (requestId !== listRequestSeqRef.current) return;
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setSummary(result.summary || {});
      nextCursorRef.current = result.nextCursor || null;
      setNextCursor(nextCursorRef.current);
    } catch (nextError) {
      if (requestId !== listRequestSeqRef.current) return;
      setError(nextError);
      notify.error("无法加载提交记录", { description: nextError?.message || String(nextError) });
    } finally {
      if (append) {
        loadingMoreRef.current = false;
        if (requestId === listRequestSeqRef.current) setLoadingMore(false);
      } else if (requestId === listRequestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [campaignId, filters]);

  useEffect(() => { void load(); }, [load]);

  const openEntry = async (item) => {
    const requestId = ++detailRequestSeqRef.current;
    setSelectedId(item.id);
    setDetailLoading(true);
    setDetail(null);
    setReviewMembers([]);
    setRevisions([]);
    setDetailOpen(true);
    try {
      const [nextDetail, history] = await Promise.all([getEntry(item.id), listEntryRevisions(item.id)]);
      if (requestId !== detailRequestSeqRef.current) return;
      setDetail(nextDetail);
      setRevisions(history.items || []);
      if (nextDetail.canManageReview && nextDetail.entry?.productionId) {
        try {
          const result = await listProductionMembers(nextDetail.entry.productionId);
          if (requestId !== detailRequestSeqRef.current) return;
          const candidates = [
            ...(result.inherited || []).map((member) => ({ userId: member.user_id, name: member.display_name || member.email || member.user_id, active: true })),
            ...(result.direct || []).filter((member) => member.effective_status === "active").map((member) => ({ userId: member.user_id, name: member.display_name || member.email || member.user_id, active: true })),
          ];
          setReviewMembers([...new Map(candidates.filter((member) => member.userId).map((member) => [member.userId, member])).values()]);
        } catch {
          // The detail remains readable; the backend still validates every assignment.
        }
      }
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, inboxState: { ...row.inboxState, isRead: true } } : row));
    } catch (nextError) {
      if (requestId !== detailRequestSeqRef.current) return;
      notify.error("无法加载提交详情", { description: nextError?.message || String(nextError) });
    } finally {
      if (requestId === detailRequestSeqRef.current) setDetailLoading(false);
    }
  };

  useEffect(() => () => { detailRequestSeqRef.current += 1; }, [campaignId]);

  const onStateChanged = useCallback((next) => {
    setDetail((current) => current ? { ...current, inboxState: { isRead: next.isRead, isStarred: next.isStarred } } : current);
    setItems((current) => current.map((item) => item.id === selectedId ? { ...item, inboxState: { isRead: next.isRead, isStarred: next.isStarred } } : item));
  }, [selectedId]);

  const onDecision = useCallback(async (entryId, payload) => {
    if (decisionBusy) return;
    const action = DECISION_ACTIONS[payload.type];
    setDecisionBusy(true);
    try {
      await notify.promise(createEntryDecision(entryId, payload), {
        loading: action.loading,
        success: action.success,
        error: (nextError) => action.label + "失败：" + (nextError?.message || String(nextError)),
      });
      try {
        const [nextDetail, history] = await Promise.all([getEntry(entryId), listEntryRevisions(entryId)]);
        if (entryId === selectedId) {
          setDetail(nextDetail);
          setRevisions(history.items || []);
        }
        await load();
      } catch (nextError) {
        notify.error("决定已保存，但刷新失败", { description: nextError?.message || String(nextError) });
      }
    } finally {
      setDecisionBusy(false);
    }
  }, [decisionBusy, load, selectedId]);

  const onAssign = useCallback(async (entryId, payload) => {
    if (assignmentBusy) return;
    setAssignmentBusy(true);
    try {
      await notify.promise(assignEntryReviewTask(entryId, payload), {
        loading: payload.taskId ? "正在改派审核任务…" : "正在补充分配审核人…",
        success: payload.taskId ? "审核任务已改派" : "已补充审核人",
        error: (nextError) => `更新审核分配失败：${nextError?.message || String(nextError)}`,
      });
      const nextDetail = await getEntry(entryId);
      if (entryId === selectedId) setDetail(nextDetail);
      await load();
    } catch (error) {
      // notify.promise presents the operation failure.
      throw error;
    } finally {
      setAssignmentBusy(false);
    }
  }, [assignmentBusy, load, selectedId]);

  const getDetail = useCallback(() => detailLoading ? <div className="p-5 text-sm text-muted-foreground">正在加载提交详情…</div> : <InboxDetail detail={detail} revisions={revisions} members={reviewMembers} onStateChanged={onStateChanged} onDecision={onDecision} onAssign={onAssign} decisionBusy={decisionBusy} assignmentBusy={assignmentBusy} />, [assignmentBusy, decisionBusy, detail, detailLoading, onAssign, onDecision, onStateChanged, reviewMembers, revisions]);

  useWindowDetailRegistration({
    key: `campaign-entry:${campaignId}`,
    storageKey: "detailPane:campaign-entry:v1",
    detailLabel: "Entry 详情",
    triggerRef,
    getDetail,
    onClose: () => { detailRequestSeqRef.current += 1; setSelectedId(null); setDetail(null); setRevisions([]); },
  });

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="text-sm">Entry 收件箱</CardTitle><CardDescription>提交记录查询投影；已读和星标只属于当前用户，不改变 Entry 状态。</CardDescription></div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw />刷新</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_8rem_8rem]">
          <div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Entry、邮箱或答案" /></div>
          <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <Select value={isUnread} onValueChange={setIsUnread}><SelectTrigger><SelectValue placeholder="已读状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部已读状态</SelectItem><SelectItem value="true">未读</SelectItem><SelectItem value="false">已读</SelectItem></SelectContent></Select>
          <Select value={isStarred} onValueChange={setIsStarred}><SelectTrigger><SelectValue placeholder="星标" /></SelectTrigger><SelectContent><SelectItem value="all">全部星标</SelectItem><SelectItem value="true">已标星</SelectItem><SelectItem value="false">未标星</SelectItem></SelectContent></Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>全部 {summary.all ?? 0}</span><span>已提交 {summary.submitted ?? 0}</span><span>审核中 {summary.in_review ?? 0}</span><span>待补件 {summary.needs_changes ?? 0}</span></div>
        {loading ? <div className="flex min-h-36 items-center justify-center text-sm text-muted-foreground">正在加载提交记录…</div> : error ? <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><p>提交记录加载失败。</p><Button type="button" variant="outline" size="sm" onClick={() => void load()}>重试</Button></div> : items.length ? <>
          <div className="divide-y rounded-md border">
            {items.map((item) => <div key={item.id} className={`flex items-center gap-3 px-3 py-3 text-sm transition-colors hover:bg-muted/40 ${!item.inboxState?.isRead ? "bg-primary/5" : ""}`}>
              <button type="button" ref={selectedId === item.id ? triggerRef : undefined} className="min-w-0 flex-1 text-left" onClick={() => void openEntry(item)}>
                <div className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{item.id}</span>{!item.inboxState?.isRead ? <Badge variant="secondary">未读</Badge> : null}<Badge variant="outline">{STATUS_LABELS[item.status] || item.status}</Badge></div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.contactEmail || "匿名提交"} · {formatDate(item.submittedAt || item.lastActivityAt)} · Revision {item.currentRevisionNo}</p>
              </button>
              <Button type="button" variant={item.inboxState?.isStarred ? "secondary" : "ghost"} size="icon" aria-label={item.inboxState?.isStarred ? "取消星标" : "标记星标"} onClick={async (event) => { event.stopPropagation(); try { const next = await updateEntryInboxState(item.id, { isStarred: !item.inboxState?.isStarred }); setItems((current) => current.map((row) => row.id === item.id ? { ...row, inboxState: { ...row.inboxState, isStarred: next.isStarred } } : row)); notify.success(next.isStarred ? "已标记星标" : "已取消星标"); } catch (nextError) { notify.error("更新星标失败", { description: nextError?.message || String(nextError) }); } }}><Star className={item.inboxState?.isStarred ? "fill-current" : ""} /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label="打开 Entry 详情" onClick={() => void openEntry(item)}><Eye /></Button>
            </div>)}
          </div>
          {nextCursor ? <div className="flex justify-center pt-2"><Button type="button" variant="outline" size="sm" onClick={() => void load({ append: true })} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多"}</Button></div> : null}
        </> : <div className="flex min-h-36 items-center justify-center border border-dashed text-sm text-muted-foreground">当前筛选下暂无提交记录。</div>}
      </CardContent>
    </Card>
  );
}
