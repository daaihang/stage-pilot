import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify } from "@/components/ui/sonner";
import { listReviewRecipes, listReviewRecipeVersions, listWorkspaceReviewRecipes } from "@/lib/campaign-api";
import { listProductionMembers } from "@/lib/production-api";
import { useCampaignRevisionDraft } from "@/components/campaign-revision-draft-context";

const roles = { producer: "Producer", editor: "Editor", stage_manager: "Stage Manager", contributor: "Contributor", viewer: "Viewer" };

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

function supportedWorkflow(workflow) {
  if (!workflow || workflow.mode !== "MANUAL_DECISION" || workflow.final_decision === "auto_accept" || workflow.rounds?.length !== 1) return false;
  const round = workflow.rounds[0];
  return round.execution === "parallel"
    && workflow.request_changes?.enabled !== true
    && round.feedback?.kind !== "score"
    && (!round.scorecard?.criteria?.length)
    && ["all", "any", "at_least_n"].includes(round.completion?.mode)
    && (round.completion?.mode !== "at_least_n" || Number(round.completion?.n) > 0)
    && ["explicit_members", "production_roles"].includes(round.reviewer_policy?.source);
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
  const [recipes, setRecipes] = useState([]);
  const [members, setMembers] = useState([]);
  const source = draft.reviewWorkflow && typeof draft.reviewWorkflow === "object" ? draft.reviewWorkflow : makeSingleRound();
  const supported = supportedWorkflow(source);
  const round = supported ? source.rounds[0] : null;
  const selectedRecipe = recipes.find((recipe) => recipe.latestVersionId === draft.reviewRecipeVersionId);

  useEffect(() => {
    let active = true;
    Promise.all([
      listReviewRecipes({ status: "published" }),
      draft.campaign?.workspaceId ? listWorkspaceReviewRecipes(draft.campaign.workspaceId, { status: "published" }) : Promise.resolve({ items: [] }),
    ]).then(([system, workspace]) => { if (active) setRecipes([...system.items, ...workspace.items]); })
      .catch((error) => notify.error("加载审核方案失败", { description: error?.message || String(error) }));
    return () => { active = false; };
  }, [draft.campaign?.workspaceId]);

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

  const reviewerSet = useMemo(() => new Set(round?.reviewer_policy?.source === "explicit_members" ? round.reviewer_policy.member_ids || [] : round?.reviewer_policy?.role_keys || []), [round]);
  const update = (nextRound) => draft.setReview({ workflow: { ...source, schema_version: 1, mode: "MANUAL_DECISION", rounds: [nextRound], request_changes: { enabled: false, target: "same_round" }, final_decision: "manual" } });
  const updatePolicy = (patch) => update({ ...round, reviewer_policy: { ...(round.reviewer_policy || {}), ...patch } });
  const selectRecipe = async (id) => {
    const recipe = recipes.find((item) => item.id === id);
    if (!recipe?.latestVersionId) return;
    try {
      const result = await listReviewRecipeVersions(id);
      const version = result.items.find((item) => item.id === recipe.latestVersionId) || result.items[0];
      if (!version) return;
      if (!supportedWorkflow(version.definition)) {
        notify.error("该方案不符合当前单轮审核契约", { description: "只能使用一个并行轮次、文字反馈和人工最终决定的方案。" });
        return;
      }
      draft.setReview({ recipeVersionId: version.id, workflow: version.definition });
    } catch (error) {
      notify.error("加载审核方案失败", { description: error?.message || String(error) });
    }
  };

  if (!supported) {
    return <Card><CardHeader><CardTitle className="text-sm">审核方案需要迁移到单轮模式</CardTitle><CardDescription>当前 P1 只允许单轮并行人工审核、必填文字反馈和人工决定。评分、多轮、补件及自动决定不能发布或公开收件。</CardDescription></CardHeader><CardContent className="space-y-3"><Button type="button" onClick={() => { draft.setReview({ workflow: makeSingleRound(source) }); notify.success("已转换为单轮人工审核", { description: "请检查审核人和完成门槛后再发布。" }); }}>转换为单轮人工审核</Button><p className="text-xs text-muted-foreground">转换会保留第一轮的审核人和完成门槛；其他轮次、评分与补件设置会移除。</p></CardContent></Card>;
  }

  const completionValue = round.completion.mode === "all" ? "all" : "at_least_n";
  const toggleReviewer = (key, selected, values, setter) => setter(selected ? [...values, key] : values.filter((value) => value !== key));

  return <Card>
    <CardHeader><CardTitle className="text-sm">单轮人工审核</CardTitle><CardDescription>提交后按此 Revision 快照创建并行审核任务。反馈必填文字意见，不是最终决定；完成门槛满足后由有决定权限的成员作出结果。</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <Field>
        <FieldLabel htmlFor="review-recipe">审核方案来源（可选）</FieldLabel>
        <Select value={selectedRecipe?.id || "custom"} onValueChange={(id) => { if (id !== "custom") void selectRecipe(id); }}>
          <SelectTrigger id="review-recipe"><SelectValue placeholder="选择已发布方案" /></SelectTrigger>
          <SelectContent>{recipes.map((recipe) => <SelectItem key={recipe.id} value={recipe.id}>{recipe.name} · v{recipe.latestVersion}</SelectItem>)}<SelectItem value="custom">自定义快照</SelectItem></SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">方案版本仅作为来源，活动保存独立快照；超出 P1 范围的方案不能应用。</p>
      </Field>
      <div className="flex flex-wrap items-center gap-2"><Badge>MANUAL_DECISION</Badge><Badge variant="outline">并行单轮</Badge><Badge variant="outline">文字反馈</Badge><Badge variant="outline">人工最终决定</Badge></div>
      <div className="grid gap-4 rounded-md border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="review-completion">反馈完成门槛</FieldLabel><Select value={completionValue} onValueChange={(mode) => update({ ...round, completion: mode === "all" ? { mode: "all" } : { mode: "at_least_n", n: Math.max(1, Number(round.completion?.n) || 1) } })}><SelectTrigger id="review-completion"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">所有已分配审核人完成</SelectItem><SelectItem value="at_least_n">至少 N 人完成</SelectItem></SelectContent></Select></Field>
          {completionValue === "at_least_n" ? <Field><FieldLabel htmlFor="review-completion-count">至少完成数 N</FieldLabel><Input id="review-completion-count" type="number" min="1" step="1" value={round.completion?.mode === "any" ? 1 : round.completion?.n || 1} onChange={(event) => update({ ...round, completion: { mode: "at_least_n", n: Math.max(1, Number(event.target.value) || 1) } })} /></Field> : <p className="self-end pb-2 text-xs text-muted-foreground">全部完成门槛会随任务补充分配而增加。</p>}
        </div>
        <Field>
          <FieldLabel htmlFor="reviewer-source">审核人配置</FieldLabel>
          <Select value={round.reviewer_policy?.source || "explicit_members"} onValueChange={(sourceType) => updatePolicy({ source: sourceType, member_ids: sourceType === "explicit_members" ? round.reviewer_policy?.member_ids || [] : [], role_keys: sourceType === "production_roles" ? round.reviewer_policy?.role_keys || [] : [] })}>
            <SelectTrigger id="reviewer-source"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="explicit_members">指定有效成员</SelectItem><SelectItem value="production_roles">按 Production 角色</SelectItem></SelectContent>
          </Select>
        </Field>
        {round.reviewer_policy?.source === "explicit_members" ? <div className="space-y-2"><p className="text-xs font-medium">选择审核成员</p><div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">{members.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><Checkbox checked={reviewerSet.has(member.id)} onCheckedChange={(checked) => toggleReviewer(member.id, checked === true, round.reviewer_policy?.member_ids || [], (member_ids) => updatePolicy({ member_ids }))} />{member.name}</label>)}</div>{members.length === 0 ? <p className="text-xs text-muted-foreground">当前没有可选成员；请先在活动成员管理中添加有效 Production 成员。</p> : null}</div> : <div className="space-y-2"><p className="text-xs font-medium">选择 Production 角色</p><div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">{Object.entries(roles).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={reviewerSet.has(key)} onCheckedChange={(checked) => toggleReviewer(key, checked === true, round.reviewer_policy?.role_keys || [], (role_keys) => updatePolicy({ role_keys }))} />{label}</label>)}</div></div>}
        <p className="text-xs text-muted-foreground">发布时会校验审核人和门槛。提交时成员若已失效，系统保留原门槛并将运行标记为“待补足审核人”，不会自动降低要求。</p>
      </div>
    </CardContent>
  </Card>;
}
