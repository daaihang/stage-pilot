import { useEffect, useMemo, useState } from "react";
import { useWindowDetailRegistration } from "@/components/window-detail-context";
import { Copy, GripVertical, Pencil, Plus, Trash2, X } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem as BaseSelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { notify } from "@/components/ui/sonner";
import { listReviewRecipes, listReviewRecipeVersions, listWorkspaceReviewRecipes } from "@/lib/campaign-api";
import { listProductionMembers } from "@/lib/production-api";
import { formatInstantInTimeZone, resolveWallClockTime } from "@/lib/timezone";
import { addContentBlock, addField, clientValidateForm, duplicateBlock, duplicateField, normalizeFormVersion, normalizePresentation, removeBlock, removeField, resolveEndingContent, updateBlock, updateField } from "@/lib/campaign-form-model";
import { evaluateFormState, validateAnswers } from "@/lib/campaign-form-runtime";
import { useCampaignRevisionDraft } from "@/components/campaign-revision-draft-context";
import { CampaignConsentField, CampaignFormField } from "@/components/campaign-form-fields";
import { CampaignReviewEditor as SingleRoundCampaignReviewEditor } from "@/components/campaign-review-editor";
import { resolveSelectItems } from "@/lib/select-options";

const FIELD_TYPES = { text: "单行文本", textarea: "长文本", number: "数字", email: "邮箱", phone: "电话", url: "网址", date: "日期", datetime: "日期时间", select: "下拉选择", radio: "单选", checkbox: "复选", multiselect: "多选", file: "文件", hidden: "隐藏字段" };
const BLOCK_TYPES = { text: "说明文字", section: "分组标题", field: "字段", consent: "同意确认", upload: "上传提示", divider: "分隔线" };
const LOGIC_OPERATORS = { equals: "等于", not_equals: "不等于", contains: "包含", empty: "为空", not_empty: "不为空", greater_than: "大于", greater_or_equal: "大于等于", less_than: "小于", less_or_equal: "小于等于" };
const EFFECTS = { show: "显示", hide: "隐藏", required: "设为必填", optional: "设为选填", end: "结束表单" };
const RESULT_TARGETS = { production_registration: "活动报名", production_program: "活动节目", production_person: "活动人员", requirement: "活动需求", resource_commitment: "资源承诺", form_response: "通用表单响应" };
const PRODUCTION_ROLES = { producer: "Producer", editor: "Editor", stage_manager: "Stage Manager", contributor: "Contributor", viewer: "Viewer" };
const selectOptions = (record) => Object.entries(record).map(([value, label]) => ({ value, label }));
const FIELD_TYPE_OPTIONS = selectOptions(FIELD_TYPES);
const BLOCK_TYPE_OPTIONS = selectOptions(BLOCK_TYPES).filter(({ value }) => value !== "field");
const LOGIC_OPERATOR_OPTIONS = selectOptions(LOGIC_OPERATORS);
const EFFECT_OPTIONS = selectOptions(EFFECTS);
const RESULT_TARGET_OPTIONS = selectOptions(RESULT_TARGETS);
const LOGIC_MATCH_OPTIONS = [{ value: "all", label: "全部条件" }, { value: "any", label: "任一条件" }];
const REVIEW_MODE_OPTIONS = [
  { value: "AUTO_ACCEPT", label: "无审核 / 自动确认" },
  { value: "MANUAL_DECISION", label: "人工审核" },
  { value: "SCORED_REVIEW", label: "评分审核" },
  { value: "MULTI_STAGE_REVIEW", label: "多轮审核" },
];
const FINAL_DECISION_OPTIONS = [{ value: "manual", label: "人工决定" }, { value: "auto_accept", label: "自动确认" }];
const COMPLETION_OPTIONS = [{ value: "all", label: "全部完成" }, { value: "any", label: "任一完成" }, { value: "at_least_n", label: "至少 N 人" }];
const REVIEWER_SOURCE_OPTIONS = [{ value: "explicit_members", label: "指定成员" }, { value: "production_roles", label: "Production 角色" }];
const OPTION_FIELD_TYPES = new Set(["select", "radio", "multiselect"]);
const EMPTY_ANSWERS = {};

function SelectItem({ value, children, disabled, ...props }) {
  const unavailable = value === "AUTO_ACCEPT" || value === "auto_accept";
  return <BaseSelectItem value={value} disabled={unavailable || disabled} {...props}>{unavailable ? <>{children}（暂不可用）</> : children}</BaseSelectItem>;
}

function optionsText(options) { return Array.isArray(options) ? options.map((item) => typeof item === "string" ? item : item.label || item.value || "").join("\n") : ""; }
function optionsValue(text) { return String(text || "").split("\n").map((item) => item.trim()).filter(Boolean).map((item) => ({ value: item, label: item })); }
function titleForBlock(block, field) { return field?.label || block?.title || BLOCK_TYPES[block?.type] || "内容块"; }
function orderedFields(form) {
  const byId = new Map(form.fields.map((field) => [field.id, field]));
  const ordered = form.blocks.filter((block) => block.type === "field").map((block) => byId.get(block.field_key)).filter(Boolean);
  return [...ordered, ...form.fields.filter((field) => !ordered.some((item) => item.id === field.id))];
}

export function CampaignFormPreview({ form, title = "表单预览", mode = "preview", campaignKind, reviewWorkflow, descriptionFallback = "", showTitle = true, initialAnswers = EMPTY_ANSWERS, onAnswersChange, onSubmit, submitting = false, readOnly = false, timezone = "Asia/Shanghai" }) {
  const model = normalizeFormVersion(form);
  const presentation = normalizePresentation(model.presentation, { legacyEndScreen: model.endScreen, legacyBlocks: model.blocks });
  const welcomeEnabled = presentation.welcome.enabled;
  const [answers, setAnswers] = useState(initialAnswers || {});
  const [issues, setIssues] = useState([]);
  const [started, setStarted] = useState(() => !welcomeEnabled || Object.keys(initialAnswers || {}).length > 0);
  useEffect(() => { setAnswers(initialAnswers || {}); }, [initialAnswers]);
  useEffect(() => { setStarted(!welcomeEnabled || Object.keys(initialAnswers || {}).length > 0); }, [welcomeEnabled, initialAnswers]);
  const runtime = useMemo(() => evaluateFormState(model, answers), [model, answers]);
  const state = runtime.fields;
  const issuesByField = useMemo(() => issues.reduce((grouped, issue) => {
    const fieldID = String(issue?.path || "").replace(/^\/answers\//, "");
    if (!fieldID || fieldID === issue?.path) return grouped;
    const current = grouped.get(fieldID) || [];
    grouped.set(fieldID, [...current, issue]);
    return grouped;
  }, new Map()), [issues]);
  const setAnswer = (id, value) => setAnswers((current) => {
    const next = { ...current };
    if (value === undefined || value === null || value === "") delete next[id];
    else next[id] = value;
    setIssues([]);
    onAnswersChange?.(next);
    return next;
  });
  const submit = () => {
    const result = validateAnswers(model, answers, { timezone });
    if (!result.valid) { setIssues(result.issues); return; }
    setIssues([]);
    onSubmit?.(result.answers);
  };
  const reset = () => { setAnswers({}); setStarted(!welcomeEnabled); setIssues([]); onAnswersChange?.({}); };
  if (welcomeEnabled && !started) return <Card className="border-dashed"><CardHeader><CardTitle className="text-xl">{presentation.welcome.titleMode === "custom" && presentation.welcome.titleOverride ? presentation.welcome.titleOverride : (presentation.publicTitle || title)}</CardTitle><CardDescription className="whitespace-pre-wrap">{presentation.welcome.description || descriptionFallback || "填写以下信息，提交后我们会及时处理。"}</CardDescription></CardHeader><CardContent><Button type="button" className="w-full" onClick={() => setStarted(true)}>{presentation.welcome.startLabel}</Button></CardContent></Card>;
  return <Card className="border-dashed"><CardHeader className="flex flex-row items-start justify-between gap-3"><div>{showTitle ? <CardTitle className="text-base">{presentation.publicTitle || title}</CardTitle> : null}<CardDescription>{mode === "public" ? "请填写以下信息并提交。" : "预览使用同一份规范化 FormVersion，不会创建 Entry。"}</CardDescription></div>{!readOnly ? <Button type="button" variant="ghost" size="sm" onClick={reset}><X />重置答案</Button> : null}</CardHeader><CardContent className="space-y-5">{model.blocks.map((block, index) => {
    if (runtime.endTriggered && runtime.endBlockIndex >= 0 && index > runtime.endBlockIndex) return null;
    if (block.type === "divider") return <hr key={block.id} />;
    if (block.type === "consent") return <CampaignConsentField key={block.id} block={block} value={answers[block.id]} onValueChange={(value) => setAnswer(block.id, value)} readOnly={readOnly} errors={issuesByField.get(block.id) || []} />;
    if (block.type !== "field") return <div key={block.id} className={block.type === "section" ? "border-b pb-2 text-sm font-medium" : "space-y-1"}><p className="text-sm font-medium">{block.title || BLOCK_TYPES[block.type]}</p>{block.body ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{block.body}</p> : null}</div>;
    const field = model.fields.find((item) => item.id === block.field_key);
    if (!field || state[field.id]?.visible === false || field.type === "hidden") return null;
    return <CampaignFormField key={block.id} field={field} value={answers[field.id]} onValueChange={(value) => setAnswer(field.id, value)} required={state[field.id]?.required ?? field.required} readOnly={readOnly} mode={mode} timezone={timezone} errors={issuesByField.get(field.id) || []} />;
  })}{runtime.endTriggered ? <p className="rounded-md bg-muted p-3 text-center text-xs text-muted-foreground">根据你的回答，后续问题已结束。请提交当前信息。</p> : null}{!model.blocks.length ? <p className="py-8 text-center text-sm text-muted-foreground">暂无内容块。</p> : null}{issues.length ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><ul className="list-disc space-y-1 pl-4">{issues.map((issue, index) => <li key={`${issue.code}-${issue.path}-${index}`}>{issue.message}</li>)}</ul></div> : null}{mode === "public" ? <div className="border-t pt-4"><Button type="button" className="w-full" disabled={submitting || !onSubmit} onClick={submit}>{submitting ? "提交中…" : "提交表单"}</Button></div> : null}</CardContent></Card>;
}

export function CampaignPreviewRegistration({ campaign }) {
  const draft = useCampaignRevisionDraft();
  useWindowDetailRegistration({ key: `campaign-preview:${campaign?.id}`, storageKey: "detailPane:campaign-preview:v1", detailLabel: "表单预览", triggerRef: draft.previewTriggerRef, getDetail: () => <div className="min-h-full space-y-4"><div><p className="text-xs text-muted-foreground">本地测试预览</p><h2 className="text-lg font-semibold">{campaign?.name || "表单"}</h2></div><CampaignFormPreview form={draft.form} campaignKind={campaign?.kind} reviewWorkflow={draft.reviewWorkflow} descriptionFallback={campaign?.description} timezone={draft.production?.timezone || "Asia/Shanghai"} title="公开表单效果" /></div> });
  return null;
}

function AddContentDialog({ open, onOpenChange, onChoose }) {
  const [tab, setTab] = useState("field");
  const [type, setType] = useState("text");
  useEffect(() => { if (open) { setTab("field"); setType("text"); } }, [open]);
  const choose = () => { onOpenChange(false); onChoose({ kind: tab, type }); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>添加字段/内容块</DialogTitle><DialogDescription>选择要加入公开表单的元素，下一步再填写具体内容。</DialogDescription></DialogHeader><Tabs value={tab} onValueChange={(next) => { setTab(next); setType("text"); }}><TabsList className="w-full"><TabsTrigger value="field">表单字段</TabsTrigger><TabsTrigger value="block">内容块</TabsTrigger></TabsList><TabsContent value="field" className="space-y-3 pt-3"><div className="grid gap-2 sm:grid-cols-2">{Object.entries(FIELD_TYPES).map(([value, label]) => <Button key={value} type="button" variant={type === value ? "secondary" : "outline"} className="justify-start" onClick={() => setType(value)}>{label}</Button>)}</div></TabsContent><TabsContent value="block" className="space-y-3 pt-3"><div className="grid gap-2 sm:grid-cols-2">{Object.entries(BLOCK_TYPES).filter(([value]) => value !== "field").map(([value, label]) => <Button key={value} type="button" variant={type === value ? "secondary" : "outline"} className="justify-start" onClick={() => setType(value)}>{label}</Button>)}</div></TabsContent></Tabs><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="button" onClick={choose}>继续配置</Button></DialogFooter></DialogContent></Dialog>;
}

function FieldDialog({ open, onOpenChange, field, initialType = "text", onSave }) {
  const [draft, setDraft] = useState({});
  useEffect(() => { if (open) setDraft({ id: field?.id, type: field?.type || initialType, label: field?.label || "", helpText: field?.helpText || "", required: Boolean(field?.required), placeholder: field?.placeholder || "", semantic_key: field?.semantic_key || "", options: field?.options || [], max_length: field?.max_length ?? "", max_bytes: field?.max_bytes ?? "", accept: field?.accept || [] }); }, [field, initialType, open]);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const save = (event) => { event.preventDefault(); onSave({ ...draft, label: String(draft.label || "").trim() || "新字段", options: OPTION_FIELD_TYPES.has(draft.type) ? draft.options : undefined }); onOpenChange(false); };
  const choice = OPTION_FIELD_TYPES.has(draft.type);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{field ? "编辑字段" : "添加字段"}</DialogTitle><DialogDescription>取消不会改变草稿，确认后才写入本地模型。</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={save}><div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]"><Field><FieldLabel htmlFor="field-type">类型</FieldLabel><Select items={FIELD_TYPE_OPTIONS} value={draft.type || "text"} onValueChange={(type) => set("type", type)}><SelectTrigger id="field-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(FIELD_TYPES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel htmlFor="field-label">标签</FieldLabel><Input id="field-label" autoFocus value={draft.label || ""} onChange={(event) => set("label", event.target.value)} placeholder="例如：节目名称" /></Field></div><div className="grid gap-2 sm:grid-cols-2"><Field><FieldLabel htmlFor="field-help">帮助说明</FieldLabel><Input id="field-help" value={draft.helpText || ""} onChange={(event) => set("helpText", event.target.value)} /></Field><Field><FieldLabel htmlFor="field-placeholder">占位提示</FieldLabel><Input id="field-placeholder" value={draft.placeholder || ""} onChange={(event) => set("placeholder", event.target.value)} /></Field></div><div className="flex flex-wrap items-center gap-5 text-sm"><Label className="flex items-center gap-2"><Switch checked={Boolean(draft.required)} onCheckedChange={(value) => set("required", value)} />必填</Label><Field orientation="horizontal" className="min-w-48 items-center"><FieldLabel htmlFor="field-semantic-key">语义 key</FieldLabel><Input id="field-semantic-key" value={draft.semantic_key || ""} onChange={(event) => set("semantic_key", event.target.value)} placeholder="PROGRAM_TITLE" /></Field></div>{choice ? <Field><FieldLabel htmlFor="field-options">选项（每行一个）</FieldLabel><Textarea id="field-options" value={optionsText(draft.options)} onChange={(event) => set("options", optionsValue(event.target.value))} rows={3} /></Field> : null}{draft.type === "file" ? <div className="grid gap-2 sm:grid-cols-2"><Field><FieldLabel htmlFor="field-max-bytes">最大大小（字节）</FieldLabel><Input id="field-max-bytes" type="number" min="1" value={draft.max_bytes} onChange={(event) => set("max_bytes", event.target.value ? Number(event.target.value) : "")} /></Field><Field><FieldLabel htmlFor="field-accept">允许类型</FieldLabel><Input id="field-accept" value={(draft.accept || []).join(", ")} onChange={(event) => set("accept", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="image/*, application/pdf" /></Field></div> : null}{["text", "textarea", "email", "phone", "url"].includes(draft.type) ? <Field><FieldLabel htmlFor="field-max-length">最大长度</FieldLabel><Input id="field-max-length" type="number" min="1" value={draft.max_length} onChange={(event) => set("max_length", event.target.value ? Number(event.target.value) : "")} /></Field> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">保存字段</Button></DialogFooter></form></DialogContent></Dialog>;
}

function BlockDialog({ open, onOpenChange, block, initialType = "text", onSave }) {
  const [draft, setDraft] = useState({});
  useEffect(() => { if (open) setDraft({ type: block?.type || initialType, title: block?.title || "", body: block?.body || "", required: Boolean(block?.required) }); }, [block, initialType, open]);
  const save = (event) => { event.preventDefault(); onSave({ ...draft, title: String(draft.title || "").trim() }); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{block ? "编辑内容块" : "添加内容块"}</DialogTitle><DialogDescription>内容块用于组织公开表单，不需要 JSON 配置。</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={save}><Field><FieldLabel htmlFor="block-type">类型</FieldLabel><Select items={BLOCK_TYPE_OPTIONS} value={draft.type || "text"} onValueChange={(type) => setDraft((current) => ({ ...current, type }))} disabled={Boolean(block)}><SelectTrigger id="block-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{BLOCK_TYPE_OPTIONS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>{draft.type !== "divider" ? <><Field><FieldLabel htmlFor="block-title">标题</FieldLabel><Input id="block-title" autoFocus value={draft.title || ""} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></Field><Field><FieldLabel htmlFor="block-body">内容</FieldLabel><Textarea id="block-body" value={draft.body || ""} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} rows={3} /></Field>{draft.type === "consent" ? <Label className="flex items-center gap-2 text-xs"><Switch checked={Boolean(draft.required)} onCheckedChange={(required) => setDraft((current) => ({ ...current, required }))} />必须勾选才能提交</Label> : null}</> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">保存内容块</Button></DialogFooter></form></DialogContent></Dialog>;
}

function LogicValue({ field, value, onChange }) {
  if (!field) return <Input value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "checkbox") return <Label className="flex h-8 items-center gap-2 border px-3 text-sm"><Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(Boolean(checked))} />是</Label>;
  if (OPTION_FIELD_TYPES.has(field.type)) {
    const options = (field.options || []).map((option) => ({ value: option.value || option.label, label: option.label || option.value || "未命名选项" }));
    const select = resolveSelectItems(options, { value: String(value ?? "") });
    return <Select items={select.items} value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="选择选项" /></SelectTrigger><SelectContent>{select.missingOption ? <SelectItem value={select.missingOption.value} disabled>{select.missingOption.label}</SelectItem> : null}{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>;
  }
  return <Input type={field.type === "number" ? "number" : "text"} value={value ?? ""} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)} />;
}

function LogicDialog({ open, onOpenChange, rule, fields, onSave }) {
  const [draft, setDraft] = useState({});
  useEffect(() => { if (open) setDraft({ id: rule?.id, conditions: { match: rule?.conditions?.match || "all", items: rule?.conditions?.items?.length ? rule.conditions.items : [{ field_id: fields[0]?.id || "", operator: "equals", value: "" }] }, effect: rule?.effect || "show", target_field_id: rule?.target_field_id || "" }); }, [fields, open, rule]);
  const conditions = draft.conditions?.items || [];
  const setCondition = (index, patch) => setDraft((current) => ({ ...current, conditions: { ...current.conditions, items: conditions.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item) } }));
  const sourceField = fields.find((field) => field.id === conditions[0]?.field_id);
  const sourceIndex = Math.max(0, fields.findIndex((field) => field.id === sourceField?.id));
  const targetFields = fields.filter((_, index) => index > sourceIndex);
  const targetOptions = targetFields.map((field) => ({ value: field.id, label: field.label || "未命名字段" }));
  const selectedTarget = fields.find((field) => field.id === draft.target_field_id);
  const targetSelect = resolveSelectItems(targetOptions, { value: draft.target_field_id, selectedLabel: selectedTarget?.label });
  const save = (event) => { event.preventDefault(); onSave({ ...draft, id: draft.id || undefined }); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{rule ? "编辑条件逻辑" : "添加条件逻辑"}</DialogTitle><DialogDescription>只允许受控操作符，并优先引用前置字段。</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={save}><div className="flex items-center gap-2"><span className="text-xs">条件匹配</span><Select items={LOGIC_MATCH_OPTIONS} value={draft.conditions?.match || "all"} onValueChange={(value) => setDraft((current) => ({ ...current, conditions: { ...current.conditions, match: value } }))}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{LOGIC_MATCH_OPTIONS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>{conditions.map((condition, index) => { const field = fields.find((item) => item.id === condition.field_id); const fieldOptions = fields.map((item) => ({ value: item.id, label: item.label || "未命名字段" })); const fieldSelect = resolveSelectItems(fieldOptions, { value: condition.field_id, selectedLabel: field?.label }); return <div key={`${condition.field_id}-${index}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_8rem_1fr_auto]"><Select items={fieldSelect.items} value={condition.field_id || ""} onValueChange={(value) => setCondition(index, { field_id: value, value: "" })}><SelectTrigger><SelectValue placeholder="来源字段" /></SelectTrigger><SelectContent>{fieldSelect.missingOption ? <SelectItem value={fieldSelect.missingOption.value} disabled>{fieldSelect.missingOption.label}</SelectItem> : null}{fieldOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Select items={LOGIC_OPERATOR_OPTIONS} value={condition.operator || "equals"} onValueChange={(value) => setCondition(index, { operator: value, value: "" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LOGIC_OPERATOR_OPTIONS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>{["empty", "not_empty"].includes(condition.operator) ? <div className="h-9" /> : <LogicValue field={field} value={condition.value} onChange={(value) => setCondition(index, { value })} />}<Button type="button" variant="ghost" size="icon" aria-label="删除条件" onClick={() => setDraft((current) => ({ ...current, conditions: { ...current.conditions, items: conditions.filter((_, currentIndex) => currentIndex !== index) } }))}><X /></Button></div>; })}<Button type="button" variant="outline" size="sm" onClick={() => setDraft((current) => ({ ...current, conditions: { ...current.conditions, items: [...conditions, { field_id: fields[0]?.id || "", operator: "equals", value: "" }] } }))}><Plus />添加条件</Button><div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-xs"><span>动作</span><Select items={EFFECT_OPTIONS} value={draft.effect || "show"} onValueChange={(value) => setDraft((current) => ({ ...current, effect: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{EFFECT_OPTIONS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>{draft.effect !== "end" ? <label className="space-y-1 text-xs"><span>目标字段（仅后置字段）</span><Select items={targetSelect.items} value={draft.target_field_id || ""} onValueChange={(value) => setDraft((current) => ({ ...current, target_field_id: value }))}><SelectTrigger><SelectValue placeholder="选择目标字段" /></SelectTrigger><SelectContent>{targetSelect.missingOption ? <SelectItem value={targetSelect.missingOption.value} disabled>{targetSelect.missingOption.label}</SelectItem> : null}{targetOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label> : null}</div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">保存规则</Button></DialogFooter></form></DialogContent></Dialog>;
}

function FormEditor() {
  const draft = useCampaignRevisionDraft();
  const [addOpen, setAddOpen] = useState(false);
  const [fieldDialog, setFieldDialog] = useState({ open: false, id: null, type: "text" });
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [blockDialog, setBlockDialog] = useState({ open: false, id: null, type: "text" });
  const [logicDialog, setLogicDialog] = useState({ open: false, id: null });
  const form = draft.form;
  const selectedField = fieldDialog.id ? form.fields.find((item) => item.id === fieldDialog.id) : null;
  const selectedBlock = blockDialog.id ? form.blocks.find((item) => item.id === blockDialog.id) : null;
  const selectedRule = logicDialog.id ? form.logicRules.find((item) => item.id === logicDialog.id) : null;
  const fields = orderedFields(form);
  const update = (next) => draft.setForm(next);
  useEffect(() => {
    if (draft.readOnly) return undefined;
    const action = <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}><Plus />添加字段/内容块</Button>;
    return draft.registerToolbarAction(action);
  }, [draft.readOnly, draft.registerToolbarAction]);
  return <div className="space-y-4"><Card><CardHeader><CardTitle className="text-sm">表单画布</CardTitle><CardDescription>块顺序就是公开表单显示顺序。使用顶部“添加字段/内容块”开始设计公开表单。</CardDescription></CardHeader><CardContent><Sortable value={form.blocks} getItemValue={(item) => item.id} strategy="vertical" onValueChange={(next) => update({ ...form, blocks: next })} className="space-y-2">{form.blocks.map((block, index) => { const field = block.type === "field" ? form.fields.find((item) => item.id === block.field_key) : null; return <SortableItem key={block.id} value={block.id} className="rounded-md border bg-background"><div className="flex items-center gap-2 p-2"><SortableItemHandle className="flex size-7 items-center justify-center text-muted-foreground" aria-label="拖动调整顺序"><GripVertical /></SortableItemHandle><span className="w-5 text-center text-xs text-muted-foreground">{index + 1}</span><button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => field ? setFieldDialog({ open: true, id: field.id, type: field.type }) : setBlockDialog({ open: true, id: block.id, type: block.type })}>{titleForBlock(block, field)}</button><Badge variant="outline" className="shrink-0">{field ? FIELD_TYPES[field.type] : BLOCK_TYPES[block.type]}</Badge><Button type="button" variant="ghost" size="icon" aria-label="编辑" onClick={() => field ? setFieldDialog({ open: true, id: field.id, type: field.type }) : setBlockDialog({ open: true, id: block.id, type: block.type })}><Pencil /></Button>{field ? <Button type="button" variant="ghost" size="icon" aria-label="复制" onClick={() => update(duplicateField(form, field.id))}><Copy /></Button> : <Button type="button" variant="ghost" size="icon" aria-label="复制" onClick={() => update(duplicateBlock(form, block.id))}><Copy /></Button>}<Button type="button" variant="ghost" size="icon" aria-label="删除" onClick={() => update(field ? removeField(form, field.id) : removeBlock(form, block.id))}><Trash2 /></Button></div></SortableItem>; })}</Sortable>{!form.blocks.length ? <p className="py-10 text-center text-sm text-muted-foreground">从顶部“添加字段/内容块”开始设计公开表单。</p> : null}</CardContent></Card><Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-sm">条件逻辑</CardTitle><CardDescription>结构化配置显示、隐藏和必填逻辑。</CardDescription></div><Button type="button" variant="outline" size="sm" onClick={() => setLogicDialog({ open: true, id: null })} disabled={!fields.length}><Plus />添加规则</Button></CardHeader><CardContent className="space-y-2">{form.logicRules.map((rule) => <div key={rule.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><span className="min-w-0 flex-1 truncate">{rule.conditions?.items?.map((item) => `${form.fields.find((field) => field.id === item.field_id)?.label || item.field_id} ${LOGIC_OPERATORS[item.operator] || item.operator}`).join(rule.conditions?.match === "any" ? " 或 " : " 且 ") || "条件"} → {EFFECTS[rule.effect] || rule.effect}</span><Button type="button" variant="ghost" size="sm" onClick={() => setLogicDialog({ open: true, id: rule.id })}><Pencil />编辑</Button><Button type="button" variant="ghost" size="sm" onClick={() => update({ ...form, logicRules: form.logicRules.filter((item) => item.id !== rule.id) })}><Trash2 />删除</Button></div>)}{!form.logicRules.length ? <p className="py-3 text-xs text-muted-foreground">尚未配置条件逻辑。</p> : null}</CardContent></Card><AddContentDialog open={addOpen} onOpenChange={setAddOpen} onChoose={({ kind, type }) => kind === "field" ? setFieldDialog({ open: true, id: null, type }) : setBlockDialog({ open: true, id: null, type })} /><FieldDialog open={fieldDialog.open} onOpenChange={(open) => setFieldDialog((current) => ({ ...current, open }))} field={selectedField} initialType={fieldDialog.type} onSave={(next) => update(selectedField ? updateField(form, selectedField.id, next) : addField(form, next))} /><BlockDialog open={blockDialog.open} onOpenChange={(open) => setBlockDialog((current) => ({ ...current, open }))} block={selectedBlock} initialType={blockDialog.type} onSave={(next) => update(selectedBlock ? updateBlock(form, selectedBlock.id, next) : addContentBlock(form, next.type, next))} /><LogicDialog open={logicDialog.open} onOpenChange={(open) => setLogicDialog((current) => ({ ...current, open }))} rule={selectedRule} fields={fields} onSave={(next) => update({ ...form, logicRules: selectedRule ? form.logicRules.map((item) => item.id === selectedRule.id ? next : item) : [...form.logicRules, { ...next, id: next.id || `rule_${Date.now().toString(36)}` }] })} /></div>;
}

function localDateTimeValue(value, timezone) {
  if (!value) return "";
  try { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value)).reduce((out, part) => ({ ...out, [part.type]: part.value }), {}); return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`; } catch { return ""; }
}

export function CampaignPresentationEditor() {
  const draft = useCampaignRevisionDraft();
  const presentation = normalizePresentation(draft.form?.presentation, { legacyEndScreen: draft.form?.endScreen, legacyBlocks: draft.form?.blocks });
  const setPresentation = (patch) => draft.setForm({ ...draft.form, presentation: normalizePresentation({ ...presentation, ...patch }) });
  const setWelcome = (patch) => setPresentation({ welcome: { ...presentation.welcome, ...patch } });
  const setEnding = (patch) => setPresentation({ ending: { ...presentation.ending, ...patch } });
  const endingPreview = resolveEndingContent(draft.form, { campaignKind: draft.campaign?.kind, reviewWorkflow: draft.reviewWorkflow });
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle className="text-sm">对外标题</CardTitle><CardDescription>管理端名称用于内部识别；这里的标题会显示给填写者。</CardDescription></CardHeader><CardContent className="space-y-2"><label className="space-y-1 text-xs"><span>公开标题</span><Input value={presentation.publicTitle} onChange={(event) => setPresentation({ publicTitle: event.target.value })} disabled={draft.readOnly} placeholder={draft.campaign?.name || "公开表单标题"} /></label><p className="text-xs text-muted-foreground">留空时发布会使用活动名称。</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">欢迎页</CardTitle><CardDescription>欢迎页是填写前的单一入口，不会作为内容块参与排序。</CardDescription></CardHeader><CardContent className="space-y-4"><label className="flex items-center gap-2 text-sm"><Switch checked={presentation.welcome.enabled} onCheckedChange={(enabled) => setWelcome({ enabled })} disabled={draft.readOnly} />启用欢迎页</label>{presentation.welcome.enabled ? <div className="space-y-3 rounded-md border p-3"><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs"><span>标题来源</span><Select items={[{ value: "inherit", label: "继承公开标题" }, { value: "custom", label: "自定义标题" }]} value={presentation.welcome.titleMode} onValueChange={(titleMode) => setWelcome({ titleMode })} disabled={draft.readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">继承公开标题</SelectItem><SelectItem value="custom">自定义标题</SelectItem></SelectContent></Select></label>{presentation.welcome.titleMode === "custom" ? <label className="space-y-1 text-xs"><span>自定义标题</span><Input value={presentation.welcome.titleOverride} onChange={(event) => setWelcome({ titleOverride: event.target.value })} disabled={draft.readOnly} /></label> : null}</div><label className="space-y-1 text-xs"><span>欢迎说明</span><Textarea rows={4} value={presentation.welcome.description} onChange={(event) => setWelcome({ description: event.target.value })} disabled={draft.readOnly} placeholder="介绍填写须知、截止时间或材料要求" /></label><label className="space-y-1 text-xs"><span>开始按钮文案</span><Input value={presentation.welcome.startLabel} maxLength={24} onChange={(event) => setWelcome({ startLabel: event.target.value })} disabled={draft.readOnly} /></label></div> : null}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">结束页</CardTitle><CardDescription>提交后始终显示结束结果；条件逻辑只能提前结束字段路径，不能跳过提交。</CardDescription></CardHeader><CardContent className="space-y-4"><label className="space-y-1 text-xs"><span>结束行为</span><Select items={[{ value: "default", label: "使用系统默认文案" }, { value: "custom", label: "自定义结束页" }, { value: "redirect", label: "提交后跳转" }]} value={presentation.ending.mode} onValueChange={(mode) => setEnding({ mode })} disabled={draft.readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">使用系统默认文案</SelectItem><SelectItem value="custom">自定义结束页</SelectItem><SelectItem value="redirect">提交后跳转</SelectItem></SelectContent></Select></label>{presentation.ending.mode === "custom" ? <div className="space-y-3 rounded-md border p-3"><label className="space-y-1 text-xs"><span>结束标题</span><Input value={presentation.ending.title} onChange={(event) => setEnding({ title: event.target.value })} disabled={draft.readOnly} placeholder="感谢您的提交" /></label><label className="space-y-1 text-xs"><span>结束说明</span><Textarea rows={4} value={presentation.ending.body} onChange={(event) => setEnding({ body: event.target.value })} disabled={draft.readOnly} placeholder="我们已收到你的信息。" /></label></div> : null}{presentation.ending.mode === "redirect" ? <label className="space-y-1 text-xs"><span>HTTPS 跳转地址</span><Input type="url" value={presentation.ending.redirectUrl} onChange={(event) => setEnding({ redirectUrl: event.target.value })} disabled={draft.readOnly} placeholder="https://example.com/thanks" /><span className="block text-muted-foreground">仅支持 HTTPS 地址，提交后不会再显示站内结束页。</span></label> : null}<div className="rounded-md bg-muted/50 p-3 text-sm"><p className="font-medium">默认文案预览</p><p className="mt-1">{endingPreview.title}</p><p className="mt-1 text-xs text-muted-foreground">{endingPreview.body}</p></div></CardContent></Card>
  </div>;
}


function RulesEditor() {
  const draft = useCampaignRevisionDraft();
  const value = draft.policy || {};
  const timezone = draft.production?.timezone || "Asia/Shanghai";
  const set = (key, next) => draft.setPolicy({ ...value, [key]: next });
  const number = (key, label) => <label className="space-y-1 text-xs"><span>{label}</span><Input type="number" min="0" value={value[key] ?? ""} onChange={(event) => set(key, event.target.value === "" ? null : Number(event.target.value))} /></label>;
  const setWallClock = (key, localValue) => {
    if (!localValue) return set(key, null);
    const result = resolveWallClockTime(localValue, timezone, { disambiguation: "compatible" });
    if (result.instant) set(key, result.instant);
  };
  const removeLegacyCloseBehavior = () => {
    const next = { ...value };
    delete next.close_behavior;
    draft.setPolicy(next);
    notify.success("已移除旧的截止后策略", { description: "表单将在截止时间后停止接收提交。" });
  };

  return <Card><CardHeader><CardTitle className="text-sm">开放与容量规则</CardTitle><CardDescription>时间按活动时区 {timezone} 编辑；0 或留空表示不限。提交上限控制新收件，最终名额只限制接受，候补上限单独生效，运营目标仅供参考。每邮箱上限按必填联系邮箱匹配（不代表邮箱已验证）；截止后统一停止接收。</CardDescription></CardHeader><CardContent className="space-y-4">
    {value.close_behavior === "accept_to_waitlist" ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><p className="text-muted-foreground">此草稿继承了已停用的“截止后转入候补”策略，修正后才能发布。</p><Button type="button" variant="outline" size="sm" onClick={removeLegacyCloseBehavior}>移除此旧策略</Button></div> : null}
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-xs"><span>可见性</span><Select items={[{ value: "public", label: "公开" }, { value: "workspace", label: "工作空间成员" }, { value: "invite_only", label: "仅邀请" }]} value={value.visibility || "public"} onValueChange={(next) => set("visibility", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">公开</SelectItem><SelectItem value="workspace">工作空间成员</SelectItem><SelectItem value="invite_only">仅邀请</SelectItem></SelectContent></Select></label>
      <label className="space-y-1 text-xs"><span>开放时间</span><Input type="datetime-local" value={localDateTimeValue(value.opens_at, timezone)} onChange={(event) => setWallClock("opens_at", event.target.value)} /></label>
      <label className="space-y-1 text-xs"><span>截止时间</span><Input type="datetime-local" value={localDateTimeValue(value.closes_at, timezone)} onChange={(event) => setWallClock("closes_at", event.target.value)} /></label>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">{number("submission_limit", "提交上限")}{number("per_actor_limit", "每邮箱提交次数")}{number("capacity", "最终名额")}{number("target", "运营目标")}{number("waitlist_limit", "候补上限")}</div>
    <div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><Switch checked={Boolean(value.waitlist_enabled)} onCheckedChange={(next) => set("waitlist_enabled", next)} />启用候补</label><label className="flex items-center gap-2"><Switch checked={Boolean(value.draft_policy?.enabled)} onCheckedChange={(next) => set("draft_policy", { ...(value.draft_policy || {}), enabled: next })} />允许恢复草稿</label>{value.draft_policy?.enabled ? <label className="flex items-center gap-2 text-xs"><span>保留小时</span><Input className="w-24" type="number" min="1" value={value.draft_policy?.retention_hours ?? 72} onChange={(event) => set("draft_policy", { ...(value.draft_policy || {}), retention_hours: Number(event.target.value || 72) })} /></label> : null}</div>
    {value.opens_at ? <p className="text-xs text-muted-foreground">开放：{formatInstantInTimeZone(value.opens_at, timezone)} · 截止：{value.closes_at ? formatInstantInTimeZone(value.closes_at, timezone) : "未设置"}</p> : null}
  </CardContent></Card>;
}

function ReviewEditor() {
  const draft = useCampaignRevisionDraft();
  const [recipes, setRecipes] = useState([]);
  const [members, setMembers] = useState([]);
  const value = { ...(draft.reviewWorkflow && typeof draft.reviewWorkflow === "object" ? draft.reviewWorkflow : {}), mode: draft.reviewWorkflow?.mode || "MANUAL_DECISION" };
  useEffect(() => { let active = true; setRecipesLoading(true); Promise.all([listReviewRecipes({ status: "published" }), draft.campaign?.workspaceId ? listWorkspaceReviewRecipes(draft.campaign.workspaceId, { status: "published" }) : Promise.resolve({ items: [] })]).then(([system, workspace]) => { if (active) setRecipes([...system.items, ...workspace.items]); }).catch((error) => notify.error("加载审核方案失败", { description: error?.message || String(error) })).finally(() => { if (active) setRecipesLoading(false); }); return () => { active = false; }; }, [draft.campaign?.workspaceId]);
  useEffect(() => { if (!draft.campaign?.productionId) return undefined; let active = true; listProductionMembers(draft.campaign.productionId).then((result) => { if (active) setMembers([...(result.inherited || []), ...(result.direct || [])]); }).catch(() => {}); return () => { active = false; }; }, [draft.campaign?.productionId]);
  const setWorkflow = (next) => draft.setReview({ workflow: next });
  const choose = async (id) => { const recipe = recipes.find((item) => item.id === id); if (!recipe?.latestVersionId) return; try { const result = await listReviewRecipeVersions(id); const version = result.items.find((item) => item.id === recipe.latestVersionId) || result.items[0]; if (version) draft.setReview({ recipeVersionId: version.id, workflow: version.definition }); } catch (error) { notify.error("加载审核方案失败", { description: error?.message || String(error) }); } };
  const rounds = Array.isArray(value.rounds) ? value.rounds : [];
  const setRound = (index, patch) => setWorkflow({ ...value, rounds: rounds.map((round, current) => current === index ? { ...round, ...patch } : round) });
  const addRound = () => setWorkflow({ ...value, mode: value.mode || "MANUAL_DECISION", rounds: [...rounds, { key: `round_${rounds.length + 1}`, name: `审核轮次 ${rounds.length + 1}`, execution: "parallel", reviewer_policy: { source: "explicit_members", member_ids: [], role_keys: [] }, completion: { mode: "all" }, feedback: { kind: "binary" } }] });
  const selectedRecipe = recipes.find((recipe) => recipe.latestVersionId === draft.reviewRecipeVersionId);
  const recipeOptions = [...recipes.map((recipe) => ({ value: recipe.id, label: `${recipe.name} · v${recipe.latestVersion}` })), { value: "custom", label: "自定义快照" }];
  const recipeSelectValue = selectedRecipe?.id || (draft.reviewRecipeVersionId ? String(draft.reviewRecipeVersionId) : "custom");
  const recipeSelect = resolveSelectItems(recipeOptions, { value: recipeSelectValue, loading: recipesLoading });
  if (value.mode === "AUTO_ACCEPT" || String(value.final_decision || "").toLowerCase() === "auto_accept") {
    return <Card><CardHeader><CardTitle className="text-sm">审核方案需要修正</CardTitle><CardDescription>自动确认执行链路尚未开放。该草稿在切换为人工决定并重新发布前，不能公开收件。</CardDescription></CardHeader><CardContent><Button type="button" onClick={() => { setWorkflow({ ...value, mode: "MANUAL_DECISION", final_decision: "manual" }); notify.success("已切换为人工决定"); }}>改为人工决定</Button></CardContent></Card>;
  }
  return <Card><CardHeader><CardTitle className="text-sm">审核方案</CardTitle><CardDescription>方案版本仅作为来源，当前编辑的是活动级独立快照。</CardDescription></CardHeader><CardContent className="space-y-3"><Select items={recipeSelect.items} value={recipeSelectValue} onValueChange={(id) => id !== "custom" && !recipeSelect.missingOption && void choose(id)} disabled={recipesLoading}><SelectTrigger><SelectValue placeholder="选择审核方案" /></SelectTrigger><SelectContent>{recipeSelect.missingOption ? <SelectItem value={recipeSelect.missingOption.value} disabled>{recipeSelect.missingOption.label}</SelectItem> : null}{recipes.map((recipe) => <SelectItem key={recipe.id} value={recipe.id}>{recipe.name} · v{recipe.latestVersion}</SelectItem>)}<SelectItem value="custom">自定义快照</SelectItem></SelectContent></Select><div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-xs"><span>模式</span><Select items={REVIEW_MODE_OPTIONS} value={value.mode || "AUTO_ACCEPT"} onValueChange={(mode) => setWorkflow({ ...value, mode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REVIEW_MODE_OPTIONS.map(({ value: mode, label }) => <SelectItem key={mode} value={mode}>{label}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1 text-xs"><span>最终决定</span><Select items={FINAL_DECISION_OPTIONS} value={value.final_decision || "manual"} onValueChange={(final_decision) => setWorkflow({ ...value, final_decision })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{FINAL_DECISION_OPTIONS.map(({ value: decision, label }) => <SelectItem key={decision} value={decision}>{label}</SelectItem>)}</SelectContent></Select></label></div><div className="space-y-2">{rounds.map((round, index) => <div key={round.key || index} className="rounded-md border p-3"><div className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem]"><Input value={round.name || ""} onChange={(event) => setRound(index, { name: event.target.value })} placeholder="轮次名称" /><Input value={round.key || ""} onChange={(event) => setRound(index, { key: event.target.value })} placeholder="稳定 key" /><Select items={COMPLETION_OPTIONS} value={round.completion?.mode || "all"} onValueChange={(mode) => setRound(index, { completion: { ...(round.completion || {}), mode } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COMPLETION_OPTIONS.map(({ value: mode, label }) => <SelectItem key={mode} value={mode}>{label}</SelectItem>)}</SelectContent></Select></div><div className="mt-2 flex flex-wrap items-center gap-4 text-xs"><span>轮内并行</span><label className="flex items-center gap-2"><Switch checked={round.feedback?.kind === "score"} onCheckedChange={(score) => setRound(index, { feedback: { ...(round.feedback || {}), kind: score ? "score" : "binary" } })} />启用评分</label>{round.completion?.mode === "at_least_n" ? <label className="flex items-center gap-2"><span>人数</span><Input className="w-16" type="number" min="1" value={round.completion?.n || 1} onChange={(event) => setRound(index, { completion: { ...(round.completion || {}), n: Number(event.target.value || 1) } })} /></label> : null}<Button type="button" variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => setWorkflow({ ...value, rounds: rounds.filter((_, current) => current !== index) })}>删除轮次</Button></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><Select items={REVIEWER_SOURCE_OPTIONS} value={round.reviewer_policy?.source || "explicit_members"} onValueChange={(source) => setRound(index, { reviewer_policy: { ...(round.reviewer_policy || {}), source, member_ids: source === "explicit_members" ? (round.reviewer_policy?.member_ids || []) : [], role_keys: source === "production_roles" ? (round.reviewer_policy?.role_keys || []) : [] } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REVIEWER_SOURCE_OPTIONS.map(({ value: source, label }) => <SelectItem key={source} value={source}>{label}</SelectItem>)}</SelectContent></Select>{round.reviewer_policy?.source === "production_roles" ? <div className="flex flex-wrap gap-2 rounded-md border p-2">{Object.entries(PRODUCTION_ROLES).map(([role, label]) => { const selected = (round.reviewer_policy?.role_keys || []).includes(role); return <Label key={role} className="flex items-center gap-1 text-xs"><Checkbox checked={selected} onCheckedChange={(checked) => setRound(index, { reviewer_policy: { ...(round.reviewer_policy || {}), role_keys: checked ? [...(round.reviewer_policy?.role_keys || []), role] : (round.reviewer_policy?.role_keys || []).filter((item) => item !== role) } })} />{label}</Label>; })}</div> : <div className="flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded-md border p-2">{members.map((member) => { const id = member.id || member.user_id; const selected = (round.reviewer_policy?.member_ids || []).includes(id); return <Label key={id} className="flex items-center gap-1 text-xs"><Checkbox checked={selected} onCheckedChange={(checked) => setRound(index, { reviewer_policy: { ...(round.reviewer_policy || {}), member_ids: checked ? [...(round.reviewer_policy?.member_ids || []), id] : (round.reviewer_policy?.member_ids || []).filter((item) => item !== id) } })} />{member.display_name || member.name || member.email || "未知成员"}</Label>; })}</div>}</div>{round.feedback?.kind === "score" ? <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-2"><div className="flex items-center justify-between text-xs font-medium"><span>评分标准（权重总和须为 100）</span><Button type="button" variant="ghost" size="sm" onClick={() => setRound(index, { scorecard: { ...(round.scorecard || {}), criteria: [...(round.scorecard?.criteria || []), { key: `criterion_${(round.scorecard?.criteria || []).length + 1}`, label: "新标准", scale_min: 1, scale_max: 5, weight: 0 }] } })}>添加</Button></div>{(round.scorecard?.criteria || []).map((criterion, criterionIndex) => <div key={criterion.key || criterionIndex} className="grid gap-2 sm:grid-cols-[1fr_5rem_4rem]"><Input value={criterion.label || ""} onChange={(event) => { const criteria = [...(round.scorecard?.criteria || [])]; criteria[criterionIndex] = { ...criteria[criterionIndex], label: event.target.value }; setRound(index, { scorecard: { ...(round.scorecard || {}), criteria } }); }} placeholder="标准名称" /><Input type="number" min="0" max="100" value={criterion.weight ?? 0} onChange={(event) => { const criteria = [...(round.scorecard?.criteria || [])]; criteria[criterionIndex] = { ...criteria[criterionIndex], weight: Number(event.target.value || 0) }; setRound(index, { scorecard: { ...(round.scorecard || {}), criteria } }); }} /><Button type="button" variant="ghost" size="icon" aria-label="删除评分标准" onClick={() => setRound(index, { scorecard: { ...(round.scorecard || {}), criteria: (round.scorecard?.criteria || []).filter((_, current) => current !== criterionIndex) } })}>删除</Button></div>)}</div> : null}</div>)}<Button type="button" variant="outline" size="sm" onClick={addRound}>添加审核轮次</Button></div><label className="flex items-center gap-2 text-sm"><Switch checked={Boolean(value.request_changes?.enabled)} onCheckedChange={(enabled) => setWorkflow({ ...value, request_changes: { ...(value.request_changes || {}), enabled, target: "same_round" } })} />允许补件并返回原轮次</label></CardContent></Card>;
}

function MaterializationEditor() {
  const draft = useCampaignRevisionDraft();
  const value = draft.materializationPlan || {};
  const options = RESULT_TARGET_OPTIONS;
  const select = resolveSelectItems(options, { value: value.primary_target || value.target_kind || "" });
  return <Card><CardHeader><CardTitle className="text-sm">结果映射</CardTitle><CardDescription>仅允许活动级受控结果对象，不支持任意表名或脚本。</CardDescription></CardHeader><CardContent><Select items={select.items} value={value.primary_target || value.target_kind || ""} onValueChange={(primary_target) => draft.setMaterialization({ ...value, primary_target })}><SelectTrigger><SelectValue placeholder="选择结果目标" /></SelectTrigger><SelectContent>{select.missingOption ? <SelectItem value={select.missingOption.value} disabled>{select.missingOption.label}</SelectItem> : null}{options.map(({ value: target, label }) => <SelectItem key={target} value={target}>{label}</SelectItem>)}</SelectContent></Select></CardContent></Card>;
}

export function CampaignFormBuilder() { return <FormEditor />; }
export function CampaignRulesEditor() { return <RulesEditor />; }
export function CampaignReviewEditor() { return <SingleRoundCampaignReviewEditor />; }
export function CampaignResultsEditor() { return <MaterializationEditor />; }
