import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogBody, } from "@/components/ui/alert-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";
import { getWorkspaceReviewCatalog } from "@/lib/campaign-api";
import { listProductionMembers } from "@/lib/production-api";
import { useCampaignRevisionDraft } from "@/components/campaign-revision-draft-context";
import { isExecutableSingleRoundWorkflow, resolveReviewRecipeSource, reviewRecipeSourceFromCatalogItem, reviewRecipeSourceStatus, reviewWorkflowCustomized, selectableReviewRecipes, shouldConfirmReviewRecipeChange } from "@/lib/review-workflow-options";
import { resolveSelectItems } from "@/lib/select-options";

const roles = { producer: "Producer", editor: "Editor", stage_manager: "Stage Manager", contributor: "Contributor", viewer: "Viewer" };
const processingModes = [
  { value: "COLLECT_ONLY", label: "仅收集" },
  { value: "DIRECT_MANUAL_DECISION", label: "免评审人工决定" },
  { value: "MANUAL_DECISION", label: "单轮人工审核后决定" },
  { value: "AUTO_ACCEPT", label: "自动接受" },
];

function newRound(source = {}) {
  const policy = source.reviewer_policy || {};
  const completion = source.completion || {};
  const mode = completion.mode === "at_least_n" || completion.mode === "any" ? "at_least_n" : "all";
  return {
    key: source.key || "review",
    name: source.name || "单轮审核",
    execution: "parallel",
    reviewer_policy: {
      source: policy.source === "production_roles" ? "production_roles" : "explicit_members",
      member_ids: policy.source === "explicit_members" ? policy.member_ids || [] : [],
      role_keys: policy.source === "production_roles" ? policy.role_keys || [] : [],
    },
    completion: mode === "all" ? { mode } : { mode, n: completion.mode === "any" ? 1 : Math.max(1, Number(completion.n) || 1) },
    feedback: { kind: "binary" },
  };
}

function makeSingleRound(workflow = {}) {
  const sourceRound = Array.isArray(workflow.rounds) ? workflow.rounds[0] : null;
  return {
    schema_version: 1,
    mode: "MANUAL_DECISION",
    rounds: [newRound(sourceRound || {})],
    request_changes: { enabled: false, target: "same_round" },
    final_decision: "manual",
  };
}

export function CampaignReviewEditor() {
  const draft = useCampaignRevisionDraft();
  const workspaceId = draft.campaign?.workspaceId;
  const isTemplate = Boolean(draft.campaign?.isTemplate);
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [pendingRecipeVersionId, setPendingRecipeVersionId] = useState("");
  const [confirmRecipeChange, setConfirmRecipeChange] = useState(false);
  const source = draft.reviewWorkflow && typeof draft.reviewWorkflow === "object" ? draft.reviewWorkflow : makeSingleRound();
  const processingMode = draft.processingMode || "MANUAL_DECISION";
  const processingModeField = <Field>
    <FieldLabel htmlFor="campaign-processing-mode">提交后处理方式</FieldLabel>
    <Select items={processingModes} value={processingMode} disabled={draft.readOnly} onValueChange={(value) => draft.setProcessingMode(value)}>
      <SelectTrigger id="campaign-processing-mode"><SelectValue /></SelectTrigger>
      <SelectContent>{processingModes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  </Field>;
  const hasSavedWorkflow = Boolean(draft.reviewWorkflow && typeof draft.reviewWorkflow === "object" && Object.keys(draft.reviewWorkflow).length);
  const supported = isExecutableSingleRoundWorkflow(source);
  const round = supported ? source.rounds[0] : null;

  useEffect(() => {
    let active = true;
    if (!workspaceId) {
      setRecipes([]);
      setRecipesLoading(false);
      return undefined;
    }
    setRecipesLoading(true);
    getWorkspaceReviewCatalog(workspaceId).then((catalog) => {
      if (active) setRecipes(selectableReviewRecipes(catalog.items || []));
    })
      .catch((error) => notify.error("加载审核方案失败", { description: error?.message || String(error) }))
      .finally(() => { if (active) setRecipesLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);

  useEffect(() => {
    if (!draft.campaign?.productionId) return undefined;
    let active = true;
    listProductionMembers(draft.campaign.productionId).then((result) => {
      if (!active) return;
      const candidates = [
        ...(result.inherited || []).map((member) => ({ id: member.user_id, name: member.display_name || member.email || member.user_id })),
        ...(result.direct || []).filter((member) => member.effective_status === "active").map((member) => ({ id: member.user_id, name: member.display_name || member.email || member.user_id })),
      ];
      setMembers([...new Map(candidates.filter((member) => member.id).map((member) => [member.id, member])).values()]);
    }).catch((error) => notify.error("加载可用审核人失败", { description: error?.message || String(error) }));
    return () => { active = false; };
  }, [draft.campaign?.productionId]);

  const reviewerSet = useMemo(() => new Set(!isTemplate && round?.reviewer_policy?.source === "explicit_members" ? round.reviewer_policy.member_ids || [] : round?.reviewer_policy?.role_keys || []), [isTemplate, round]);
  const update = (nextRound) => draft.setReview({ workflow: { ...source, schema_version: 1, mode: "MANUAL_DECISION", rounds: [nextRound], request_changes: { enabled: false, target: "same_round" }, final_decision: "manual" } });
  const updatePolicy = (patch) => update({ ...round, reviewer_policy: { ...(round.reviewer_policy || {}), ...(isTemplate ? { source: "production_roles", member_ids: [] } : {}), ...patch } });
  const workflowForContext = (workflow) => {
    const next = makeSingleRound(workflow);
    if (isTemplate) {
      const sourcePolicy = workflow?.rounds?.[0]?.reviewer_policy || {};
      next.rounds[0].reviewer_policy = {
        source: "production_roles",
        member_ids: [],
        role_keys: sourcePolicy.source === "production_roles" ? sourcePolicy.role_keys || [] : [],
      };
    }
    return next;
  };
  const selectedRecipe = recipes.find((recipe) => recipe.publishedVersionId === draft.reviewRecipeVersionId);
  const sourceInfo = resolveReviewRecipeSource(draft.reviewRecipeVersionId, recipes, draft.reviewRecipeSource);
  const customized = sourceInfo?.definition
    ? reviewWorkflowCustomized(source, workflowForContext(sourceInfo.definition))
    : Boolean(draft.reviewRecipeVersionId || hasSavedWorkflow);
  const applyRecipe = (recipe) => {
    if (!recipe?.publishedVersionId || !recipe.publishedDefinition) return;
    draft.setReview({
      recipeVersionId: recipe.publishedVersionId,
      workflow: workflowForContext(recipe.publishedDefinition),
      recipeSource: reviewRecipeSourceFromCatalogItem(recipe),
    });
    notify.success("已应用单轮审核方案", { description: "请明确选择审核人并检查完成门槛。" });
  };
  const selectRecipe = (versionId) => {
    const recipe = recipes.find((item) => item.publishedVersionId === versionId);
    if (!recipe) return;
    if (shouldConfirmReviewRecipeChange({ customized, currentVersionId: draft.reviewRecipeVersionId, nextVersionId: versionId })) {
      setPendingRecipeVersionId(versionId);
      setConfirmRecipeChange(true);
      return;
    }
    applyRecipe(recipe);
  };
  const confirmRecipeSelection = () => {
    const recipe = recipes.find((item) => item.publishedVersionId === pendingRecipeVersionId);
    setConfirmRecipeChange(false);
    setPendingRecipeVersionId("");
    applyRecipe(recipe);
  };

  if (processingMode !== "MANUAL_DECISION") {
    const processingModeCopy = {
      COLLECT_ONLY: {
        title: "仅收集",
        description: "提交后只保存 Entry 和答案版本，不创建审核任务或决定；工作人员可查看记录，但不能从该路径作出接受、候补或拒绝决定。",
      },
      DIRECT_MANUAL_DECISION: {
        title: "免评审人工决定",
        description: "提交后 Entry 保持“已提交”，不创建审核任务；具备决定权限的成员可直接接受、候补或拒绝。",
      },
      AUTO_ACCEPT: {
        title: "自动接受",
        description: "公开提交事务会同时写入 accepted Entry 和系统 Decision；容量满时停止收件，竞态提交会收到明确冲突。",
      },
    }[processingMode];
    return <Card>
      <CardHeader><CardTitle className="text-sm">{processingModeCopy?.title || "处理方式"}</CardTitle><CardDescription>{processingModeCopy?.description}</CardDescription></CardHeader>
      <CardContent className="space-y-4">{processingModeField}<div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">原有审核方案来源与参数保留为未启用草稿配置，不会运行。切回单轮人工审核时，这些参数会重新参与发布校验。</div></CardContent>
    </Card>;
  }

  if (!supported) {
    return <Card><CardHeader><CardTitle className="text-sm">审核配置需要切换到单轮模式</CardTitle><CardDescription>当前只能发布单轮并行人工审核。评分、多轮、补件及自动决定暂不可运行。</CardDescription></CardHeader><CardContent className="space-y-3">{processingModeField}<Button type="button" disabled={draft.readOnly || !recipes.length} onClick={() => { draft.setReview({ recipeVersionId: recipes[0].publishedVersionId, workflow: workflowForContext(source), recipeSource: reviewRecipeSourceFromCatalogItem(recipes[0]) }); notify.success("已转换为单轮人工审核", { description: "请检查审核人和完成门槛后再发布。" }); }}>转换为单轮人工审核</Button><p className="text-xs text-muted-foreground">转换会保留第一轮的审核人和完成门槛；其他轮次、评分与补件设置会移除。</p></CardContent></Card>;
  }

  const completionValue = round.completion.mode === "all" ? "all" : "at_least_n";
  const recipeOptions = recipes.map((recipe) => ({ value: recipe.publishedVersionId, label: `${recipe.name} · v${recipe.publishedVersion}` }));
  const recipeValue = selectedRecipe?.publishedVersionId || "";
  const recipeSelect = resolveSelectItems(recipeOptions, { value: recipeValue, loading: recipesLoading });
  const completionOptions = [{ value: "all", label: "所有已分配审核人完成" }, { value: "at_least_n", label: "至少 N 人完成" }];
  const reviewerSourceOptions = [{ value: "explicit_members", label: "指定有效成员" }, { value: "production_roles", label: "按 Production 角色" }];
  const toggleReviewer = (key, selected, values, setter) => setter(selected ? [...values, key] : values.filter((value) => value !== key));

  return <Card>
    <CardHeader><CardTitle className="text-sm">单轮人工审核</CardTitle><CardDescription>提交后按此版本快照创建并行审核任务。反馈必填文字意见，不是最终决定；完成门槛满足后由有决定权限的成员作出结果。</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {processingModeField}
      <Field>
        <FieldLabel htmlFor="review-recipe">审核方案来源</FieldLabel>
        <Select items={recipeSelect.items} value={recipeValue} disabled={draft.readOnly || recipesLoading || recipes.length === 0} onValueChange={selectRecipe}>
          <SelectTrigger id="review-recipe"><SelectValue placeholder={draft.reviewRecipeVersionId ? "当前来源不可选，请重新选择" : "选择工作空间允许的已发布方案"} /></SelectTrigger>
          <SelectContent>{recipes.map((recipe) => <SelectItem key={recipe.publishedVersionId} value={recipe.publishedVersionId}>{recipe.name} · v{recipe.publishedVersion}</SelectItem>)}</SelectContent>
        </Select>
        <div className="space-y-1 text-xs text-muted-foreground">
          {sourceInfo ? <p>来源：{sourceInfo.name} · v{sourceInfo.version} · {reviewRecipeSourceStatus(sourceInfo)}。{customized ? (isTemplate ? "模板快照已定制。" : "活动快照已定制。") : "快照与来源基线一致。"}</p> : <p>{draft.reviewRecipeVersionId ? "来源版本信息不可用；请从当前允许目录重新选择方案。" : "请先选择工作空间允许的可运行方案。"}</p>}
          <p>来源只记录出处；本{isTemplate ? "模板" : "活动 Revision"}的完整审核快照独立保存并用于后续提交。</p>
        </div>
      </Field>
      <div className="flex flex-wrap items-center gap-2"><Badge>MANUAL_DECISION</Badge><Badge variant="outline">并行单轮</Badge><Badge variant="outline">文字反馈</Badge><Badge variant="outline">人工最终决定</Badge></div>
      <div className="grid gap-4 rounded-md border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="review-completion">反馈完成门槛</FieldLabel><Select items={completionOptions} value={completionValue} onValueChange={(mode) => update({ ...round, completion: mode === "all" ? { mode: "all" } : { mode: "at_least_n", n: Math.max(1, Number(round.completion?.n) || 1) } })}><SelectTrigger id="review-completion"><SelectValue /></SelectTrigger><SelectContent>{completionOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
          {completionValue === "at_least_n" ? <Field><FieldLabel htmlFor="review-completion-count">至少完成数 N</FieldLabel><Input id="review-completion-count" type="number" min="1" step="1" value={round.completion?.mode === "any" ? 1 : round.completion?.n || 1} onChange={(event) => update({ ...round, completion: { mode: "at_least_n", n: Math.max(1, Number(event.target.value) || 1) } })} /></Field> : <p className="self-end pb-2 text-xs text-muted-foreground">全部完成门槛会随任务补充分配而增加。</p>}
        </div>
        {!isTemplate ? <Field>
          <FieldLabel htmlFor="reviewer-source">审核人配置</FieldLabel>
          <Select items={reviewerSourceOptions} value={round.reviewer_policy?.source || "explicit_members"} onValueChange={(sourceType) => updatePolicy({ source: sourceType, member_ids: sourceType === "explicit_members" ? round.reviewer_policy?.member_ids || [] : [], role_keys: sourceType === "production_roles" ? round.reviewer_policy?.role_keys || [] : [] })}>
            <SelectTrigger id="reviewer-source"><SelectValue /></SelectTrigger><SelectContent>{reviewerSourceOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </Field> : <p className="text-xs text-muted-foreground">模板不绑定某个活动的具体成员；请选择 Production 角色，应用到活动后再按需要指定成员。</p>}
        {!isTemplate && round.reviewer_policy?.source === "explicit_members" ? <div className="space-y-2"><p className="text-xs font-medium">选择审核成员</p><div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">{members.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><Checkbox checked={reviewerSet.has(member.id)} onCheckedChange={(checked) => toggleReviewer(member.id, checked === true, round.reviewer_policy?.member_ids || [], (member_ids) => updatePolicy({ member_ids }))} />{member.name}</label>)}</div>{members.length === 0 ? <p className="text-xs text-muted-foreground">当前没有可选成员；请先在活动成员管理中添加有效 Production 成员。</p> : null}</div> : <div className="space-y-2"><p className="text-xs font-medium">{isTemplate ? "模板默认 Production 角色" : "选择 Production 角色"}</p><div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">{Object.entries(roles).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={reviewerSet.has(key)} onCheckedChange={(checked) => toggleReviewer(key, checked === true, round.reviewer_policy?.role_keys || [], (role_keys) => updatePolicy({ role_keys }))} />{label}</label>)}</div></div>}
        <p className="text-xs text-muted-foreground">发布时会校验审核人和门槛。提交时成员若已失效，系统保留原门槛并将运行标记为“待补足审核人”，不会自动降低要求。</p>
      </div>
    </CardContent>
    <AlertDialog open={confirmRecipeChange} onOpenChange={setConfirmRecipeChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>切换审核方案并重置参数？</AlertDialogTitle>
          <AlertDialogDescription>当前审核参数已偏离来源基线。切换后将用新方案的已发布版本重新初始化此草稿的审核参数；取消则保留现有来源和配置。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPendingRecipeVersionId("")}>保留当前配置</AlertDialogCancel>
          <AlertDialogAction onClick={confirmRecipeSelection}>切换并重置参数</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Card>;
}
