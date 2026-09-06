import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, Check, Copy, Plus } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ActivityTimeText as TimeText } from "@/components/time-text";
import { occurrenceTitle, occurrenceType, formatDuration } from "@/lib/program-sheet-utils";

export function NewProgramSheetDialog({ open, onOpenChange, onCreate, nextRevision = 1 }) {
  const [name, setName] = useState("");
  const [changeNote, setChangeNote] = useState("");
  useEffect(() => {
    if (open) {
      setName(`节目单 v${nextRevision}`);
      setChangeNote("");
    }
  }, [open, nextRevision]);
  const submit = (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, changeNote: changeNote.trim(), revision: nextRevision });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>新建节目单</DialogTitle><DialogDescription>创建一个可继续编辑的本地节目单草稿。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submit}><label className="block space-y-1"><span className="text-sm font-medium">名称</span><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="例如：首演版" /></label><label className="block space-y-1"><span className="text-sm font-medium">变更说明</span><Input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={240} placeholder="例如：彩排后调整节目顺序" /></label><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={!name.trim()}><Plus />创建草稿</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function AssignOccurrencesDialog({ open, onOpenChange, sheet, occurrences = [], timezone, onApply }) {
  const [selected, setSelected] = useState(new Set());
  useEffect(() => {
    if (open) setSelected(new Set((sheet?.assignments || []).map((item) => item.occurrenceId).filter(Boolean)));
  }, [open, sheet]);
  const toggle = (id, checked) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>关联场次</DialogTitle><DialogDescription>同一个节目单可以复用于多个场次；发布时可将选中的场次设为正式版本。</DialogDescription></DialogHeader><div className="max-h-80 space-y-2 overflow-y-auto">{occurrences.length ? occurrences.map((occurrence) => { const id = occurrence.id; const checked = selected.has(id); return <label key={id} className="flex cursor-pointer items-start gap-3 border p-3 hover:bg-muted/40"><Checkbox checked={checked} onCheckedChange={(value) => toggle(id, Boolean(value))} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="truncate">{occurrenceTitle(occurrence)}</span><Badge variant="outline">{occurrenceType(occurrence)}</Badge></span><span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{occurrence.scheduledStartAt ? <TimeText instant={occurrence.scheduledStartAt} timezone={timezone} /> : "时间待定"}{occurrence.scheduledEndAt ? <> — <TimeText instant={occurrence.scheduledEndAt} timezone={timezone} /></> : null}</span></span></label>; }) : <p className="border border-dashed p-6 text-center text-sm text-muted-foreground">暂无可关联的场次，请先在“场次”页面创建。</p>}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={() => { onApply([...selected]); onOpenChange(false); }}><Check />保存关联</Button></DialogFooter></DialogContent></Dialog>;
}

export function PublishProgramSheetDialog({ open, onOpenChange, sheet, occurrences = [], replacements = [], onConfirm }) {
  const assigned = useMemo(() => new Set((sheet?.assignments || []).map((item) => item.occurrenceId)), [sheet]);
  const selectedOccurrences = occurrences.filter((item) => assigned.has(item.id));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>发布节目单并设为正式</DialogTitle><DialogDescription>发布后该版本将只读。修改需要复制为新的草稿版本。</DialogDescription></DialogHeader><div className="space-y-4 text-sm"><div className="border p-3"><p className="font-medium">{sheet?.name} · v{sheet?.revision}</p><p className="mt-1 text-xs text-muted-foreground">{sheet?.items?.length || 0} 个条目 · {formatDuration(sheet?.items?.reduce((total, item) => item.kind === "program" || item.kind === "interval" ? total + (Number(item.durationSeconds) || 0) : total, 0) || 0)}</p></div><div className="space-y-2"><p className="font-medium">正式场次</p>{selectedOccurrences.length ? selectedOccurrences.map((occurrence) => <div key={occurrence.id} className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="size-3.5" /><span>{occurrenceTitle(occurrence)}</span></div>) : <p className="text-destructive">尚未关联场次，请先保存场次关联。</p>}</div>{replacements.length ? <div className="border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300"><p className="font-medium">以下场次已有正式节目单，确认后会替换：</p><p className="mt-1">{replacements.map((item) => occurrenceTitle(item)).join("、")}</p></div> : null}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!selectedOccurrences.length} onClick={() => { onConfirm(); onOpenChange(false); }}><Check />确认发布</Button></DialogFooter></DialogContent></Dialog>;
}

export function ArchiveProgramSheetDialog({ open, onOpenChange, sheet, onConfirm }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>归档节目单</DialogTitle><DialogDescription>归档后版本会保留历史记录，但不会出现在默认草稿列表中。</DialogDescription></DialogHeader><div className="border p-3 text-sm"><p className="font-medium">{sheet?.name} · v{sheet?.revision}</p><p className="mt-1 text-xs text-muted-foreground">归档不会删除本地内容，也不会修改已保存的条目。</p></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button variant="secondary" onClick={() => { onConfirm(); onOpenChange(false); }}><Archive />确认归档</Button></DialogFooter></DialogContent></Dialog>;
}

export function CopyProgramSheetDialog({ open, onOpenChange, sheet, nextRevision, onConfirm }) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(`${sheet?.name || "节目单"} · 复制版 v${nextRevision}`); }, [open, sheet, nextRevision]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>复制为新草稿</DialogTitle><DialogDescription>复制后会生成新的条目 ID，正式场次关联不会自动继承。</DialogDescription></DialogHeader><label className="block space-y-1"><span className="text-sm font-medium">新版本名称</span><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!name.trim()} onClick={() => { onConfirm(name.trim()); onOpenChange(false); }}><Copy />复制草稿</Button></DialogFooter></DialogContent></Dialog>;
}

export function CustomProgramDialog({ open, onOpenChange, onConfirm }) {
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (open) {
      setName("");
      setMinutes("0");
      setNotes("");
    }
  }, [open]);
  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    onConfirm({ name: name.trim(), durationSeconds: Math.max(0, Number(minutes || 0) * 60), notes: notes.trim() });
    onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>新建活动内节目</DialogTitle><DialogDescription>该节目只属于当前活动，不会写入工作空间节目库。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submit}><label className="block space-y-1"><span className="text-sm font-medium">节目名称</span><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：现场特别节目" /></label><label className="block space-y-1"><span className="text-sm font-medium">默认时长（分钟）</span><Input type="number" min="0" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label className="block space-y-1"><span className="text-sm font-medium">备注（可选）</span><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="演出者或技术说明" /></label><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={!name.trim()}><Plus />添加节目</Button></DialogFooter></form></DialogContent></Dialog>;
}
