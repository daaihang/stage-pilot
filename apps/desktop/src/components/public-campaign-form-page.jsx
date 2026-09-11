import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { CampaignFormRenderer } from "@/components/campaign-form-renderer";
import { getPublicCampaignForm, submitPublicCampaignEntry } from "@/lib/campaign-public-api";
import { resolveEndingContent } from "@/lib/campaign-form-model";

function draftKey(token, short, revisionId) { return `stagepilot:campaign-draft:${short ? "short" : "long"}:${token}:${revisionId}`; }

function loadDraft(key, retentionHours) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null");
    if (!value || !value.updatedAt || Date.now() - value.updatedAt > Math.max(1, retentionHours || 72) * 3600000) {
      window.localStorage.removeItem(key);
      return { answers: {}, idempotencyKey: null };
    }
    return { answers: value.answers || {}, idempotencyKey: value.idempotencyKey || null };
  } catch { return { answers: {}, idempotencyKey: null }; }
}

export function PublicCampaignFormPage({ token, short = false }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [answers, setAnswers] = useState({});
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    let active = true;
    getPublicCampaignForm(token, { short }).then((data) => {
      if (!active) return;
      const key = draftKey(token, short, data.revision?.id || "unknown");
      const draftEnabled = data.availability?.draft_policy?.enabled !== false;
      const draft = draftEnabled ? loadDraft(key, data.availability?.draft_policy?.retention_hours) : { answers: {}, idempotencyKey: null };
      setAnswers(draft.answers);
      setIdempotencyKey(draft.idempotencyKey);
      setState({ loading: false, error: null, data });
    }).catch((error) => active && setState({ loading: false, error, data: null }));
    return () => { active = false; if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [short, token]);

  const data = state.data;
  const ending = data ? resolveEndingContent(data.form, { campaignKind: data.campaign?.kind, reviewWorkflow: data.reviewWorkflow }) : null;
  useEffect(() => {
    if (!submitted || ending?.mode !== "redirect" || !/^https:\/\/[^\s]+$/i.test(ending.redirectUrl || "")) return undefined;
    window.location.assign(ending.redirectUrl);
    return undefined;
  }, [ending, submitted]);
  const storageKey = useMemo(() => data?.revision?.id ? draftKey(token, short, data.revision.id) : null, [data?.revision?.id, short, token]);
  const draftEnabled = data?.availability?.draft_policy?.enabled !== false;
  const persist = (nextAnswers, nextKey = idempotencyKey) => {
    setAnswers(nextAnswers);
    if (!storageKey || !draftEnabled) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try { window.localStorage.setItem(storageKey, JSON.stringify({ answers: nextAnswers, idempotencyKey: nextKey, updatedAt: Date.now() })); } catch { /* storage is optional */ }
    }, 300);
  };

  const submit = async (nextAnswers) => {
    if (!data?.accepting || submitting) return;
    const key = idempotencyKey || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    setIdempotencyKey(key);
    persist(nextAnswers, key);
    setSubmitting(true);
    try {
      await submitPublicCampaignEntry(token, nextAnswers, { short, idempotencyKey: key });
      if (storageKey) window.localStorage.removeItem(storageKey);
      setSubmitted(true);
      notify.success("表单已提交");
    } catch (error) {
      notify.error("提交失败", { description: error?.message || "请稍后重试" });
      persist(nextAnswers, key);
    } finally { setSubmitting(false); }
  };

  if (state.loading) return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">正在加载表单…</main>;
  if (state.error) return <main className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md space-y-3 text-center"><h1 className="text-lg font-semibold">表单不可用</h1><p className="text-sm text-muted-foreground">{state.error.message || "公开链接不存在或已失效"}</p></div></main>;
  if (submitted) return <main className="flex min-h-screen items-center justify-center bg-background p-6"><Card className="w-full max-w-lg text-center"><CardHeader><CardTitle>{ending?.title || "感谢您的提交"}</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground"><p>{ending?.body || "我们已收到你的信息。"}</p><Button variant="outline" onClick={() => window.location.reload()}>返回表单</Button></CardContent></Card></main>;
  return <main className="min-h-screen bg-background p-6 text-foreground"><div className="mx-auto max-w-2xl space-y-6"><header><p className="text-xs text-muted-foreground">{data.production?.name || "活动表单"} · {data.campaign?.kind || "COLLECTION"}</p>{!data.form?.presentation?.welcome?.enabled ? <h1 className="mt-1 text-2xl font-semibold">{data.form?.presentation?.publicTitle || data.campaign?.name || "公开表单"}</h1> : null}{data.campaign?.description && !data.form?.presentation?.welcome?.enabled ? <p className="mt-2 text-sm text-muted-foreground">{data.campaign.description}</p> : null}</header>{!data.accepting ? <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{data.acceptingReason === "campaign_not_open" ? "表单尚未开放或已关闭。" : data.acceptingReason === "file_upload_unavailable" ? "当前表单包含暂不支持的文件字段。" : "当前暂不接受提交。"}</CardContent></Card> : null}<CampaignFormRenderer form={data.form} showTitle={false} descriptionFallback={data.campaign?.description} campaignKind={data.campaign?.kind} reviewWorkflow={data.reviewWorkflow} timezone={data.production?.timezone || "Asia/Shanghai"} title={data.campaign?.name || "公开表单"} mode="public" initialAnswers={answers} onAnswersChange={(next) => persist(next)} onSubmit={data.accepting ? submit : null} submitting={submitting} /></div></main>;
}
