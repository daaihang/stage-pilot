import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import { CampaignFormRenderer } from "@/components/campaign-form-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { getReviewTask, listMyReviewTasks, submitReviewFeedback } from "@/lib/campaign-api";

const recommendationLabels = {
  recommend: "建议接受",
  do_not_recommend: "不建议接受",
  no_opinion: "无明确意见",
};

const taskStatusLabels = {
  pending: "待反馈",
  submitted: "已反馈",
  closed_by_decision: "决定后关闭",
};

function ReviewTaskPanel({ detail, loading, onFeedbackSaved }) {
  const [recommendation, setRecommendation] = useState("recommend");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const task = detail?.task;
  const feedback = detail?.currentFeedback;

  useEffect(() => {
    setRecommendation(feedback?.recommendation || "recommend");
    setComment(feedback?.comment || "");
  }, [feedback?.id]);

  if (loading || !task) return <div className="p-5 text-sm text-muted-foreground">{loading ? "正在加载审核任务…" : "审核任务不存在。"}</div>;
  const canSubmit = detail.canSubmit;
  const save = async (event) => {
    event.preventDefault();
    if (!comment.trim() || busy || !canSubmit) return;
    setBusy(true);
    try {
      await notify.promise(submitReviewFeedback(task.id, {
        recommendation,
        comment: comment.trim(),
        supersedesFeedbackId: feedback?.id,
      }), {
        loading: feedback ? "正在保存审核意见修订…" : "正在提交审核意见…",
        success: feedback ? "审核意见已修订" : "审核意见已提交",
        error: (error) => `提交审核意见失败：${error?.message || String(error)}`,
      });
      await onFeedbackSaved(task.id);
    } finally {
      setBusy(false);
    }
  };

  return <div className="min-h-full space-y-4 p-5">
    <div>
      <p className="text-xs text-muted-foreground">{task.productionName} · {task.campaignName}</p>
      <h2 className="mt-1 text-lg font-semibold">审核提交 {task.entryId}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2"><Badge>{taskStatusLabels[task.taskStatus] || task.taskStatus}</Badge><span className="text-xs text-muted-foreground">门槛进度 {task.completedCount}/{task.requiredCount}</span><span className="text-xs text-muted-foreground">绑定 Revision {task.campaignRevisionId}</span></div>
    </div>
    {detail.formVersion && detail.entryRevision ? <Card><CardHeader><CardTitle className="text-sm">固定版本的提交答案</CardTitle><CardDescription>答案和表单说明均绑定提交时的 Campaign Revision 与 Entry 答案版本。</CardDescription></CardHeader><CardContent><CampaignFormRenderer form={detail.formVersion} title="提交答案" mode="readonly" initialAnswers={detail.entryRevision.answers || {}} readOnly /></CardContent></Card> : <Card><CardContent className="py-6 text-sm text-muted-foreground">此提交的答案当前不可用。</CardContent></Card>}
    <Card>
      <CardHeader><CardTitle className="text-sm">审核反馈</CardTitle><CardDescription>反馈是审核意见，不会直接改变 Entry 结果；达到门槛后由具备决定权限的成员作最终决定。</CardDescription></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <Field>
            <FieldLabel>建议</FieldLabel>
            <RadioGroup value={recommendation} onValueChange={setRecommendation} disabled={!canSubmit || busy} className="grid gap-2 sm:grid-cols-3">
              {Object.entries(recommendationLabels).map(([value, label]) => <label key={value} className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm"><RadioGroupItem value={value} />{label}</label>)}
            </RadioGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="review-task-comment">审核意见（必填）</FieldLabel>
            <Textarea id="review-task-comment" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={5000} rows={5} disabled={!canSubmit || busy} placeholder="请说明判断依据，最多 5000 字。" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{feedback ? "再次提交会保留旧意见并记录修订关系。" : "提交后在最终决定前仍可修订。"}</p><Button type="submit" disabled={!canSubmit || busy || !comment.trim()}>{busy ? "正在保存…" : feedback ? "修订审核意见" : "提交审核意见"}</Button></div>
          {!canSubmit ? <p role="status" className="text-xs text-muted-foreground">最终决定已作出，此任务仅供查看。</p> : null}
        </form>
      </CardContent>
    </Card>
    {detail.feedbackHistory.length ? <Card><CardHeader><CardTitle className="text-sm">意见修订历史</CardTitle></CardHeader><CardContent className="space-y-3">{detail.feedbackHistory.map((item) => <div key={item.id} className="border-t pt-3 first:border-0 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{recommendationLabels[item.recommendation]}</span><span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span></div><p className="mt-1 whitespace-pre-wrap text-sm">{item.comment}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.isCurrent ? "当前版本" : "已被后续意见替代"} · {item.reviewerName}</p></div>)}</CardContent></Card> : null}
  </div>;
}

export function MyReviewTasks() {
  const { setDetailOpen } = useWindowDetail();
  const triggerRef = useRef(null);
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async (nextStatus = status) => {
    setLoading(true);
    try {
      const result = await listMyReviewTasks({ status: nextStatus });
      setItems(result.items || []);
    } catch (error) {
      notify.error("无法加载我的审核", { description: error?.message || String(error) });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(status); }, [load, status]);

  const openTask = (item) => {
    requestRef.current += 1;
    setSelectedId(item.id);
    setDetail(null);
    setDetailLoading(true);
    setDetailOpen(true);
  };

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    const requestId = ++requestRef.current;
    getReviewTask(selectedId).then((result) => { if (active && requestId === requestRef.current) setDetail(result); }).catch((error) => {
      if (active && requestId === requestRef.current) notify.error("无法加载审核任务", { description: error?.message || String(error) });
    }).finally(() => { if (active && requestId === requestRef.current) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  const refreshTask = useCallback(async (taskId) => {
    const [next] = await Promise.all([getReviewTask(taskId), load(status)]);
    setDetail(next);
  }, [load, status]);

  const getDetail = useCallback(() => <ReviewTaskPanel detail={detail} loading={detailLoading} onFeedbackSaved={refreshTask} />, [detail, detailLoading, refreshTask]);
  useWindowDetailRegistration({
    key: "my-review-tasks",
    storageKey: "detailPane:my-review-tasks:v1",
    detailLabel: "审核任务",
    triggerRef,
    getDetail,
    onClose: () => { requestRef.current += 1; setSelectedId(null); setDetail(null); },
  });

  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-sm">我的审核</CardTitle><CardDescription>只显示当前分配给你的审核任务；提交意见后仍可在最终决定前修订。</CardDescription></div><Tabs value={status} onValueChange={setStatus}><TabsList><TabsTrigger value="pending">待处理</TabsTrigger><TabsTrigger value="completed">已完成</TabsTrigger><TabsTrigger value="all">全部</TabsTrigger></TabsList></Tabs></CardHeader>
    <CardContent className="space-y-2">{loading ? <p className="py-8 text-center text-sm text-muted-foreground">正在加载审核任务…</p> : items.length ? items.map((item) => <button key={item.id} ref={selectedId === item.id ? triggerRef : undefined} type="button" onClick={() => openTask(item)} className="flex w-full flex-wrap items-center gap-3 border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.campaignName} · {item.entryId}</span><span className="mt-1 block text-xs text-muted-foreground">{item.productionName} · 门槛进度 {item.completedCount}/{item.requiredCount}</span></span><Badge variant={item.taskStatus === "pending" ? "secondary" : "outline"}>{taskStatusLabels[item.taskStatus] || item.taskStatus}</Badge></button>) : <p className="py-8 text-center text-sm text-muted-foreground">{status === "pending" ? "当前没有待处理的审核任务。" : "没有匹配的审核记录。"}</p>}</CardContent>
  </Card>;
}
