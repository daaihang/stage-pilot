import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { CampaignFormRenderer } from "@/components/campaign-form-renderer";
import { getPublicCampaignForm, submitPublicCampaignEntry } from "@/lib/campaign-public-api";
import { publicCampaignDraftKey } from "@/lib/campaign-public-submission";
import { resolveEndingContent } from "@/lib/campaign-form-model";

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

function acceptingReasonText(reason) {
  if (reason === "campaign_not_open") return "表单尚未开放或已关闭。";
  if (reason === "campaign_closed") return "表单收件已截止。";
  if (reason === "submission_limit_reached") return "当前提交名额已满。";
  if (reason === "file_upload_unavailable") return "当前表单包含暂不支持的文件字段。";
  if (reason === "auto_accept_unavailable") return "此表单的自动确认审核流程暂不可用，请联系管理员。";
  if (reason === "contact_email_required_for_actor_limit") return "此表单的邮箱提交次数限制尚未正确配置，请联系管理员。";
  if (reason === "close_behavior_unsupported") return "此表单使用了暂不支持的截止后策略，请联系管理员。";
  return "当前暂不接受提交。";
}

export function PublicCampaignFormPage({ token, short = false }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [answers, setAnswers] = useState({});
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [versionNotice, setVersionNotice] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    let active = true;
    getPublicCampaignForm(token, { short }).then((data) => {
      if (!active) return;
      const key = publicCampaignDraftKey(token, short, data.revision?.id || "unknown");
      const draftEnabled = data.availability?.draft_policy?.enabled !== false;
      const draft = draftEnabled ? loadDraft(key, data.availability?.draft_policy?.retention_hours) : { answers: {}, idempotencyKey: null };
      setAnswers(draft.answers);
      setIdempotencyKey(draft.idempotencyKey);
      setState({ loading: false, error: null, data });
    }).catch((error) => active && setState({ loading: false, error, data: null }));
    return () => { active = false; if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [short, token]);

  const data = state.data;
  const ending = data ? resolveEndingContent(data.form) : null;
  useEffect(() => {
    if (!submitted || ending?.mode !== "redirect" || !/^https:\/\/[^\s]+$/i.test(ending.redirectUrl || "")) return undefined;
    window.location.assign(ending.redirectUrl);
    return undefined;
  }, [ending, submitted]);
  const storageKey = useMemo(() => data?.revision?.id ? publicCampaignDraftKey(token, short, data.revision.id) : null, [data?.revision?.id, short, token]);
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
    if (!data?.accepting || submitting || versionNotice) return;
    const key = idempotencyKey || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    setIdempotencyKey(key);
    persist(nextAnswers, key);
    setSubmitting(true);
    try {
      await submitPublicCampaignEntry(token, data.revision.id, nextAnswers, { short, idempotencyKey: key });
      if (storageKey) window.localStorage.removeItem(storageKey);
      setSubmitted(true);
      notify.success("表单已提交");
    } catch (error) {
      persist(nextAnswers, key);
      if (error?.code === "form_version_changed") {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        if (storageKey) {
          try { window.localStorage.setItem(storageKey, JSON.stringify({ answers: nextAnswers, idempotencyKey: key, updatedAt: Date.now() })); } catch { /* best-effort preservation on conflict */ }
        }
        setVersionNotice({ loading: true, latestData: null, error: null });
        getPublicCampaignForm(token, { short }).then((latestData) => {
          setVersionNotice({ loading: false, latestData, error: null });
          notify.error("表单版本已更新", { description: "旧版答案仍保留；请查看新版后手动选择是否切换。" });
        }).catch((loadError) => {
          setVersionNotice({ loading: false, latestData: null, error: loadError });
          notify.error("表单版本已更新，但新版加载失败", { description: loadError?.message || "当前草稿仍保留，请稍后重新加载。" });
        });
      } else {
        notify.error("提交失败", { description: error?.message || "请稍后重试" });
      }
    } finally { setSubmitting(false); }
  };

  const switchToLatest = () => {
    const latestData = versionNotice?.latestData;
    if (!latestData?.revision?.id) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (storageKey) {
      try { window.localStorage.setItem(storageKey, JSON.stringify({ answers, idempotencyKey, updatedAt: Date.now() })); } catch { /* the active draft remains in memory */ }
    }
    const latestKey = publicCampaignDraftKey(token, short, latestData.revision.id);
    const latestDraft = latestData.availability?.draft_policy?.enabled !== false
      ? loadDraft(latestKey, latestData.availability?.draft_policy?.retention_hours)
      : { answers: {}, idempotencyKey: null };
    setAnswers(latestDraft.answers);
    setIdempotencyKey(latestDraft.idempotencyKey);
    setState({ loading: false, error: null, data: latestData });
    setVersionNotice(null);
    notify.info("已切换到新版表单", { description: "新版使用独立草稿，旧版本答案仍保留在原草稿中。" });
  };

  if (state.loading) return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">正在加载表单…</main>;
  if (state.error) return <main className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md space-y-3 text-center"><h1 className="text-lg font-semibold">表单不可用</h1><p className="text-sm text-muted-foreground">{state.error.message || "公开链接不存在或已失效"}</p></div></main>;
  if (submitted) return <main className="flex min-h-screen items-center justify-center bg-background p-6"><Card className="w-full max-w-lg text-center"><CardHeader><CardTitle>{ending?.title || "感谢您的提交"}</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground"><p>{ending?.body || "我们已收到你的信息。"}</p><Button variant="outline" onClick={() => window.location.reload()}>返回表单</Button></CardContent></Card></main>;
  return <main className="min-h-screen bg-background p-6 text-foreground"><div className="mx-auto max-w-2xl space-y-6"><header><p className="text-xs text-muted-foreground">{data.production?.name || "活动表单"} · {data.campaign?.kind || "COLLECTION"}</p>{!data.form?.presentation?.welcome?.enabled ? <h1 className="mt-1 text-2xl font-semibold">{data.form?.presentation?.publicTitle || data.campaign?.name || "公开表单"}</h1> : null}{data.campaign?.description && !data.form?.presentation?.welcome?.enabled ? <p className="mt-2 text-sm text-muted-foreground">{data.campaign.description}</p> : null}</header>{versionNotice ? <Card role="status"><CardContent className="space-y-3 py-4"><p className="text-sm font-medium">此表单已发布新版</p><p className="text-sm text-muted-foreground">当前填写内容保留在旧版本草稿中，不会自动迁移。{versionNotice.loading ? "正在获取新版信息…" : versionNotice.error ? "暂时无法获取新版信息，请检查网络后重新加载页面。" : `新版为第 ${versionNotice.latestData?.revision?.revisionNo || versionNotice.latestData?.revision?.revision_no || "最新"} 版。`}</p>{versionNotice.latestData ? <Button type="button" onClick={switchToLatest}>查看并切换到新版</Button> : null}</CardContent></Card> : null}{!data.accepting ? <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{acceptingReasonText(data.acceptingReason)}</CardContent></Card> : null}<CampaignFormRenderer form={data.form} showTitle={false} descriptionFallback={data.campaign?.description} campaignKind={data.campaign?.kind} timezone={data.production?.timezone || "Asia/Shanghai"} title={data.campaign?.name || "公开表单"} mode="public" initialAnswers={answers} onAnswersChange={(next) => persist(next)} onSubmit={data.accepting && !versionNotice ? submit : null} submitting={submitting} /></div></main>;
}
