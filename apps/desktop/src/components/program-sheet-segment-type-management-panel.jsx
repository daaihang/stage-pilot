import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ResourcePage } from "@/components/resource-page";
import { notify } from "@/components/ui/sonner";
import { createSegmentType, deleteSegmentType, loadSegmentTypes, restoreSegmentTypes, updateSegmentType } from "@/lib/program-sheet-segment-type-store";

const emptyForm = { name: "", category: "自定义", color: "#64748b", defaultDurationSeconds: 0, countsTowardDuration: true, audienceVisible: true, requiresExecution: true, isActive: true };

export function ProgramSheetSegmentTypeManagementPanel({ workspace, canWrite = false, usedTypeIds = [] }) {
  const [types, setTypes] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const reload = useCallback(async () => setTypes(await loadSegmentTypes(workspace.id)), [workspace.id]);
  useEffect(() => { reload().catch((error) => notify.error("环节类型加载失败", { description: error.message })); }, [reload]);
  const filtered = useMemo(() => types.filter((item) => (!query || `${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase())) && (status === "all" || (status === "active" ? item.isActive : !item.isActive))), [query, status, types]);
  const openEdit = (item) => { setForm({ ...item, defaultDurationSeconds: Math.round(item.defaultDurationSeconds / 60) }); setDialog(item); };
  const save = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return notify.error("请输入环节类型名称");
    try {
      const payload = { ...form, name: form.name.trim(), defaultDurationSeconds: Math.max(0, Number(form.defaultDurationSeconds || 0) * 60), isActive: Boolean(form.isActive) };
      const editing = dialog && dialog !== "new";
      const saved = editing ? await updateSegmentType(workspace.id, dialog.id, payload) : await createSegmentType(workspace.id, payload);
      setTypes((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setDialog(null); notify.success(editing ? "环节类型已保存" : "环节类型已创建");
    } catch (error) { notify.error("环节类型保存失败", { description: error.message }); }
  };
  const toggle = async (item, checked) => { try { const saved = await updateSegmentType(workspace.id, item.id, { isActive: checked }); setTypes((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate)); notify.success(checked ? "环节类型已启用" : "环节类型已停用"); } catch (error) { notify.error("环节类型更新失败", { description: error.message }); } };
  const remove = async (item) => { try { await deleteSegmentType(workspace.id, item.id, usedTypeIds); setTypes((current) => current.filter((candidate) => candidate.id !== item.id)); notify.success("环节类型已删除"); } catch (error) { notify.error("环节类型删除失败", { description: error.message }); } };
  return <div className="min-h-full space-y-4 p-4"><ResourcePage title="环节类型" description="工作空间级节目单环节类型；当前保存在本机，尚未同步到服务器。" count={filtered.length} search={{ value: query, onChange: setQuery, placeholder: "搜索环节类型" }} filters={<Select value={status} onValueChange={setStatus}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="active">启用</SelectItem><SelectItem value="inactive">停用</SelectItem></SelectContent></Select>} showViewToggle={false} headerActions={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => reload()}><RefreshCw />刷新</Button>{canWrite && <Button size="sm" onClick={() => { setForm(emptyForm); setDialog("new"); }}><Plus />新建类型</Button>}</div>} empty={!filtered.length ? { title: "暂无环节类型", description: "恢复内置类型或新建自定义类型。", action: <Button variant="outline" onClick={async () => { setTypes(await restoreSegmentTypes(workspace.id)); notify.success("内置环节类型已恢复"); }}>恢复默认</Button> } : null}><Card variant="flush"><CardContent className="divide-y p-0">{filtered.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-3"><span className="size-3 rounded-full" style={{ backgroundColor: item.color }} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.name}</span><Badge variant="outline">{item.category}</Badge>{item.isSystem && <Badge variant="secondary">系统</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">默认 {Math.round(item.defaultDurationSeconds / 60)} 分钟 · {item.countsTowardDuration ? "计入总时长" : "不计时"} · {item.audienceVisible ? "面向观众" : "内部"} · {item.requiresExecution ? "需执行" : "资料项"}</p></div><Switch checked={item.isActive} disabled={!canWrite || item.systemKey === "other"} onCheckedChange={(checked) => toggle(item, checked)} aria-label={`${item.name}启用状态`} />{canWrite && <Button variant="ghost" size="icon-sm" onClick={() => openEdit(item)} aria-label={`编辑${item.name}`}><Pencil /></Button>}{canWrite && !item.isSystem && <Button variant="ghost" size="icon-sm" onClick={() => remove(item)} aria-label={`删除${item.name}`}><Trash2 /></Button>}</div>)}</CardContent></Card></ResourcePage><Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>{dialog === "new" ? "新建环节类型" : `编辑${dialog?.name || "环节类型"}`}</DialogTitle><DialogDescription>类型默认行为只影响新建条目，已有条目会保留创建时快照。</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={save}><label className="block space-y-1"><span>名称</span><Input value={form.name} disabled={dialog?.isSystem} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="block space-y-1"><span>分类</span><Input value={form.category} disabled={dialog?.isSystem} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></label><label className="block space-y-1"><span>颜色</span><Input type="color" value={form.color} disabled={dialog?.isSystem} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} /></label><label className="block space-y-1"><span>默认时长（分钟）</span><Input type="number" min="0" step="1" value={form.defaultDurationSeconds} onChange={(event) => setForm((current) => ({ ...current, defaultDurationSeconds: event.target.value }))} /></label>{[["countsTowardDuration", "默认计入总时长"], ["audienceVisible", "默认面向观众"], ["requiresExecution", "默认需要执行"], ["isActive", "启用"]].map(([key, label]) => <label key={key} className="flex items-center justify-between border-y py-2"><span>{label}</span><Switch checked={Boolean(form[key])} disabled={dialog?.systemKey === "other" && key === "isActive"} onCheckedChange={(value) => setForm((current) => ({ ...current, [key]: value }))} /></label>)}<DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(null)}>取消</Button><Button type="submit">保存</Button></DialogFooter></form></DialogContent></Dialog></div>;
}
