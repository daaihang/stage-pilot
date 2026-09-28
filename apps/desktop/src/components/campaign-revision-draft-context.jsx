import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getCampaignRevision, publishCampaignRevision, updateCampaignRevision, validateCampaignRevision } from "@/lib/campaign-api";
import { emptyFormVersion, clientValidateForm, normalizeFormVersion } from "@/lib/campaign-form-model";
import { notify } from "@/components/ui/sonner";
import { useWindowDetail } from "@/components/window-detail-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Eye, RefreshCw, Save } from "@/components/ui/icons";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FloatingPrimaryAction } from "@/components/page-header";

const DraftContext = createContext(null);

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function draftSnapshot(revision) {
  return {
    form: normalizeFormVersion(revision?.formVersion || emptyFormVersion()),
    policy: clone(revision?.availabilityPolicy || {}),
    processingMode: revision?.processingMode || "MANUAL_DECISION",
    reviewRecipeVersionId: revision?.reviewRecipeVersionId || "",
    reviewRecipeSource: revision?.reviewRecipeSource || null,
    reviewWorkflow: clone(revision?.reviewWorkflow || {}),
    materializationPlan: clone(revision?.materializationPlan || {}),
  };
}

function stateFromRevision(revision) {
  const snapshot = draftSnapshot(revision);
  return {
    ...snapshot,
    baseline: clone(snapshot),
    etag: revision?.etag || "",
    revisionId: revision?.id || "",
    revisionNo: revision?.revisionNo || 0,
    revisionStatus: revision?.status || "draft",
    dirty: false,
    saveState: "已保存",
    issues: [],
    conflict: null,
  };
}

function currentSnapshot(state) {
  return {
    form: state.form,
    policy: state.policy,
    processingMode: state.processingMode,
    reviewRecipeVersionId: state.reviewRecipeVersionId,
    reviewWorkflow: state.reviewWorkflow,
    materializationPlan: state.materializationPlan,
  };
}

function reduceState(state, action) {
  if (action.type === "load") return stateFromRevision(action.revision);
  if (action.type === "status") return { ...state, revisionStatus: action.status || state.revisionStatus };
  if (action.type === "set") return { ...state, [action.key]: clone(action.value), dirty: true, saveState: "未保存", issues: [], conflict: null };
  if (action.type === "save-start") return { ...state, saveState: "保存中", conflict: null };
  if (action.type === "save-success") {
    const savedSnapshot = draftSnapshot(action.saved);
    const currentHash = stableStringify(currentSnapshot(state));
    const outgoingHash = stableStringify(action.outgoing);
    const stillCurrent = currentHash === outgoingHash;
    return {
      ...state,
      ...(stillCurrent ? savedSnapshot : {}),
      baseline: clone(savedSnapshot),
      etag: action.saved.etag || state.etag,
      dirty: !stillCurrent,
      saveState: stillCurrent ? "已保存" : "未保存",
      conflict: null,
    };
  }
  if (action.type === "save-error") return { ...state, saveState: action.error?.status === 412 ? "存在冲突" : "保存失败", conflict: action.error?.status === 412 ? action.error : null };
  if (action.type === "validate") return { ...state, etag: action.etag || state.etag, issues: action.issues || [] };
  return state;
}

export function CampaignRevisionDraftProvider({ campaign, revision, production, onSaved, onPublished, onReload, operations, children }) {
  const [state, setState] = useState(() => stateFromRevision(revision));
  const [toolbarAction, setToolbarAction] = useState(null);
  const stateRef = useRef(state);
  const revisionIdRef = useRef(revision?.id || "");
  const saveChainRef = useRef(Promise.resolve());
  const saveTimerRef = useRef(null);
  const callbacksRef = useRef({ onSaved, onPublished, onReload });
  const operationsRef = useRef(operations);
  const previewTriggerRef = useRef(null);
  callbacksRef.current = { onSaved, onPublished, onReload };
  operationsRef.current = operations;
  stateRef.current = state;

  useEffect(() => {
    if (!revision?.id || revision.id === revisionIdRef.current) {
      if (revision?.status && revision.status !== stateRef.current.revisionStatus) setState((current) => ({ ...current, revisionStatus: revision.status }));
      return;
    }
    revisionIdRef.current = revision.id;
    setState(stateFromRevision(revision));
  }, [revision?.id, revision?.status]);

  const setDraft = useCallback((key, value) => setState((current) => {
    if (current.revisionStatus !== "draft" || campaign?.status === "archived") return current;
    return reduceState(current, { type: "set", key, value });
  }), [campaign?.status]);

  const registerToolbarAction = useCallback((action) => {
    setToolbarAction(() => action);
    return () => setToolbarAction((current) => current === action ? null : current);
  }, []);

  const enqueueSave = useCallback(({ force = false, withToast = false, reportAutoError = true } = {}) => {
    const operation = saveChainRef.current.then(async () => {
      const current = stateRef.current;
      if (!current.revisionId || current.revisionStatus !== "draft" || (!force && !current.dirty)) return current;
      const outgoing = clone(currentSnapshot(current));
      setState((value) => reduceState(value, { type: "save-start" }));
      try {
        const saved = operationsRef.current?.save
          ? await operationsRef.current.save(outgoing, { etag: current.etag, revisionId: current.revisionId })
          : await updateCampaignRevision(campaign.id, current.revisionId, {
            form: outgoing.form,
            availability_policy: outgoing.policy,
          processing_mode: outgoing.processingMode,
            review_recipe_version_id: outgoing.reviewRecipeVersionId || null,
            review_workflow: outgoing.reviewWorkflow,
            materialization_plan: outgoing.materializationPlan,
          }, { etag: current.etag });
        setState((value) => reduceState(value, { type: "save-success", saved, outgoing }));
        callbacksRef.current.onSaved?.(saved);
        return saved;
      } catch (error) {
        setState((value) => reduceState(value, { type: "save-error", error }));
        throw error;
      }
    });
    saveChainRef.current = operation.catch(() => {});
    if (!withToast) return reportAutoError ? operation.catch((error) => {
      notify.error("草稿自动保存失败", { id: `campaign-autosave:${campaign.id}`, description: error?.message || String(error) });
      throw error;
    }) : operation;
    return notify.promise(operation, {
      loading: "正在保存草稿…",
      success: "草稿已保存",
      error: (error) => `保存失败：${error?.message || String(error)}`,
    });
  }, [campaign?.id]);

  const save = useCallback((options = {}) => enqueueSave({ ...options, withToast: options.withToast !== false }), [enqueueSave]);
  const flushPendingSave = useCallback(() => enqueueSave({ force: false, withToast: false, reportAutoError: false }), [enqueueSave]);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (!state.dirty || state.revisionStatus !== "draft") return undefined;
    saveTimerRef.current = window.setTimeout(() => { void enqueueSave().catch(() => {}); }, 500);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [enqueueSave, state.dirty, state.revisionStatus, state.form, state.policy, state.processingMode, state.reviewRecipeVersionId, state.reviewWorkflow, state.materializationPlan]);

  // SPA navigation unmounts the editor without firing beforeunload. Flush a
  // pending draft so changes made immediately before returning to the list do
  // not remain only in React state after the autosave timer is cancelled.
  useEffect(() => () => {
    const current = stateRef.current;
    if (current.dirty && current.revisionId && current.revisionStatus === "draft") {
      void enqueueSave({ reportAutoError: true }).catch(() => {});
    }
  }, [enqueueSave]);

  useEffect(() => {
    if (!state.dirty) return undefined;
    const handler = (event) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.dirty]);

  const validate = useCallback((options = {}) => {
    const operation = (stateRef.current.dirty ? enqueueSave({ withToast: false, reportAutoError: false }) : Promise.resolve()).then(() => {
      const localIssues = clientValidateForm(stateRef.current.form);
      const validation = operationsRef.current?.validate
        ? operationsRef.current.validate(currentSnapshot(stateRef.current), { etag: stateRef.current.etag, revisionId: stateRef.current.revisionId })
        : validateCampaignRevision(campaign.id, stateRef.current.revisionId, { etag: stateRef.current.etag });
      return validation.then((result) => {
        const issues = [...localIssues, ...(result.issues || [])];
        setState((current) => reduceState(current, { type: "validate", etag: result.etag, issues }));
        return { ...result, issues, valid: Boolean(result.valid) && !issues.some((issue) => issue.severity === "error") };
      });
    });
    return options.withToast === false ? operation : notify.promise(operation, {
      loading: "正在校验草稿…",
      success: (result) => result.valid ? "校验通过" : "发现校验问题",
      error: (error) => `校验失败：${error?.message || String(error)}`,
    });
  }, [campaign?.id, enqueueSave]);

  const publish = useCallback(async () => {
    const result = operationsRef.current?.publish
      ? await operationsRef.current.publish(currentSnapshot(stateRef.current), { etag: stateRef.current.etag, revisionId: stateRef.current.revisionId })
      : await publishCampaignRevision(campaign.id, stateRef.current.revisionId, { etag: stateRef.current.etag });
    setState((current) => ({ ...current, revisionStatus: "published", dirty: false, saveState: "已保存", etag: result.revision?.etag || current.etag }));
    callbacksRef.current.onPublished?.(result);
    return result;
  }, [campaign?.id]);

  const reload = useCallback(async () => {
    const latest = operationsRef.current?.reload
      ? await operationsRef.current.reload({ revisionId: stateRef.current.revisionId })
      : await getCampaignRevision(campaign.id, stateRef.current.revisionId);
    revisionIdRef.current = latest?.id || revisionIdRef.current;
    setState(stateFromRevision(latest));
    callbacksRef.current.onReload?.(latest);
    return latest;
  }, [campaign?.id]);

  const contextValue = useMemo(() => ({
    campaign,
    production,
    ...state,
    draft: currentSnapshot(state),
    readOnly: state.revisionStatus !== "draft" || campaign?.status === "archived",
    toolbarAction,
    registerToolbarAction,
    previewTriggerRef,
    setDraft,
    setForm: (value) => setDraft("form", normalizeFormVersion(value)),
    setPolicy: (value) => setDraft("policy", value || {}),
    setProcessingMode: (value) => setDraft("processingMode", value || "MANUAL_DECISION"),
    setReview: ({ recipeVersionId, workflow, recipeSource } = {}) => {
      if (recipeVersionId !== undefined) setDraft("reviewRecipeVersionId", recipeVersionId || "");
      if (workflow !== undefined) setDraft("reviewWorkflow", workflow || {});
      if (recipeSource !== undefined) setDraft("reviewRecipeSource", recipeSource || null);
    },
    setMaterialization: (value) => setDraft("materializationPlan", value || {}),
    save,
    flushPendingSave,
    validate,
    publish,
    reload,
  }), [campaign, flushPendingSave, production, publish, reload, save, setDraft, state, toolbarAction, registerToolbarAction, validate]);

  return <DraftContext.Provider value={contextValue}>{children}</DraftContext.Provider>;
}

export function useCampaignRevisionDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error("useCampaignRevisionDraft must be used inside CampaignRevisionDraftProvider");
  return value;
}

export function RevisionEditorShell({ children, showPreview = false, previewButtonLabel = "预览", floatingPrimary = false }) {
  const draft = useCampaignRevisionDraft();
  const editorRef = useRef(null);
  const { detailOpen, setDetailOpen } = useWindowDetail();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const errorCount = draft.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = draft.issues.filter((issue) => issue.severity === "warning").length;

  const validateBeforePublish = async () => {
    setBusy(true);
    try {
      const result = await draft.validate();
      if (result.valid) setConfirmOpen(true);
    } catch {
      // notify.promise already reported the failure.
    } finally {
      setBusy(false);
    }
  };

  const confirmPublish = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      await notify.promise(draft.publish(), { loading: "正在发布表单…", success: "表单已发布", error: (error) => `发布失败：${error?.message || String(error)}` });
    } catch {
      // notify.promise already reported the failure.
    } finally {
      setBusy(false);
    }
  };

  if (draft.readOnly) return <div className="space-y-4"><div className="flex items-center justify-between"><Badge variant="secondary">{draft.revisionStatus === "published" ? "当前发布快照" : draft.revisionStatus === "superseded" ? "历史发布快照" : "只读版本"} · Revision {draft.revisionNo}</Badge>{showPreview ? <Button ref={draft.previewTriggerRef} variant="outline" size="sm" aria-pressed={detailOpen} onClick={() => setDetailOpen(!detailOpen)}><Eye />{detailOpen ? "关闭预览" : previewButtonLabel}</Button> : null}</div><div className="pointer-events-none opacity-70">{children}</div></div>;

  const publishButton = <Button type="button" size="sm" onClick={() => void validateBeforePublish()} disabled={busy}><CheckCircle2 />发布</Button>;
  return <div ref={editorRef} className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge variant={draft.saveState === "存在冲突" ? "destructive" : "outline"}>草稿 · Revision {draft.revisionNo} · {draft.saveState}</Badge>{draft.saveState === "存在冲突" ? <Button type="button" variant="ghost" size="sm" onClick={() => void notify.promise(draft.reload(), { loading: "正在重新加载最新版本…", success: "已加载最新版本", error: "重新加载失败" }).catch(() => {})}><RefreshCw />重新加载最新版本</Button> : null}</div><div className="flex flex-wrap gap-2">{draft.toolbarAction}{showPreview ? <Button ref={draft.previewTriggerRef} type="button" variant={detailOpen ? "secondary" : "outline"} size="sm" aria-pressed={detailOpen} onClick={() => setDetailOpen(!detailOpen)}><Eye />{detailOpen ? "关闭预览" : previewButtonLabel}</Button> : null}<Button type="button" variant="outline" size="sm" onClick={() => void draft.save().catch(() => {})} disabled={busy}><Save />保存</Button><Button type="button" variant="outline" size="sm" onClick={() => void draft.validate().catch(() => {})} disabled={busy}><CheckCircle2 />校验</Button>{publishButton}</div></div>{floatingPrimary && <FloatingPrimaryAction anchorRef={editorRef}>{publishButton}</FloatingPrimaryAction>}{draft.issues.length ? <Card className="border-amber-500/40"><CardHeader className="pb-2"><CardTitle className="text-sm">校验结果</CardTitle><CardDescription>{errorCount} 个错误，{warningCount} 个警告</CardDescription></CardHeader><CardContent className="space-y-1.5">{draft.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="flex gap-2 text-xs"><Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>{issue.severity === "error" ? "错误" : "警告"}</Badge><span>{issue.message}{issue.path ? <span className="ml-1 text-muted-foreground">({issue.path})</span> : null}</span></div>)}</CardContent></Card> : null}{children}<Dialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}><DialogContent size="sm"><DialogHeader><DialogTitle>确认发布表单</DialogTitle><DialogDescription>发布后当前 Revision 和 FormVersion 将锁定，后续修改会创建新的草稿版本。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button><Button type="button" onClick={() => void confirmPublish()}>确认发布</Button></DialogFooter></DialogContent></Dialog></div>;
}
