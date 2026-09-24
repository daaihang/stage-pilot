import { useEffect, useMemo, useState } from "react";
import { Archive, Check, Copy, Plus, RotateCcw } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileAttachmentsSection } from "@/components/file-attachments-section";
import {
  getProductionProgramMissingInfo,
  productionProgramSourceLabels,
  productionProgramStatusLabels,
} from "@/lib/production-program-store";

function draftFrom(program) {
  return {
    name: program?.name || "",
    programTypeId: program?.programTypeId || "",
    durationMinutes: program?.durationSeconds
      ? String(Math.round(program.durationSeconds / 60))
      : "0",
    performers: Array.isArray(program?.performers)
      ? program.performers.join(", ")
      : "",
    description: program?.description || program?.notes || "",
    technicalNotes: program?.technicalNotes || "",
    status: program?.status || "draft",
  };
}

function statusClass(status) {
  if (status === "confirmed")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "needs_info")
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "archived") return "bg-muted text-muted-foreground";
  return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

export function ProductionProgramDetail({
  program,
  workspace,
  production,
  programTypes = [],
  canWrite,
  onSave,
  onDuplicate,
  onArchive,
  onRestore,
  onAddToSheets,
}) {
  const [draft, setDraft] = useState(() => draftFrom(program));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDraft(draftFrom(program));
    setDirty(false);
  }, [program?.id, program?.updatedAt]);
  const missing = useMemo(
    () => getProductionProgramMissingInfo(program),
    [program],
  );
  const editable = canWrite && program?.status !== "archived";
  const set = (key, value) => {
    setDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    const type = programTypes.find((item) => item.id === draft.programTypeId);
    try {
      await onSave({
        name: draft.name.trim(),
        programTypeId: draft.programTypeId || null,
        programTypeName: type?.name || program?.programTypeName || "",
        durationSeconds: Math.max(0, Number(draft.durationMinutes || 0) * 60),
        performers: draft.performers
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        description: draft.description.trim(),
        technicalNotes: draft.technicalNotes.trim(),
        status: draft.status,
      });
      setDirty(false);
    } catch {
      // Keep the draft and dirty state so the user can retry after an error.
    }
  };
  const cancel = () => {
    setDraft(draftFrom(program));
    setDirty(false);
  };
  return (
    <div className="min-h-full space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{program.name}</h2>
            <Badge className={statusClass(program.status)} variant="secondary">
              {productionProgramStatusLabels[program.status] || program.status}
            </Badge>
            <Badge variant="outline">
              {productionProgramSourceLabels[program.sourceKind] || "活动节目"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            活动节目 · 资料保存到云端，不会自动同步工作空间节目库
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDuplicate(program)}
            >
              <Copy />
              复制
            </Button>
          )}
          {canWrite && program.status !== "archived" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddToSheets(program)}
            >
              <Plus />
              添加到节目单
            </Button>
          )}
          {canWrite && program.status !== "archived" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onArchive(program)}
            >
              <Archive />
              归档
            </Button>
          ) : canWrite ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRestore(program)}
            >
              <RotateCcw />
              恢复
            </Button>
          ) : null}
        </div>
      </div>
      <Card variant="flush">
        <CardHeader className="border-b">
          <CardTitle>节目资料</CardTitle>
          <CardDescription>
            {dirty ? "有未保存的修改" : "修改只在点击保存后写入云端"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">节目名称</span>
            <Input
              value={draft.name}
              disabled={!editable}
              onChange={(event) => set("name", event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">节目类型</span>
            <Select
              value={draft.programTypeId || "none"}
              disabled={!editable}
              onValueChange={(value) =>
                set("programTypeId", value === "none" ? "" : value)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="未设置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未设置</SelectItem>
                {programTypes.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                    {item.is_active === false ? "（已停用）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">默认时长（分钟）</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={draft.durationMinutes}
              disabled={!editable}
              onChange={(event) => set("durationMinutes", event.target.value)}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">演出者（逗号分隔）</span>
            <Input
              value={draft.performers}
              disabled={!editable}
              onChange={(event) => set("performers", event.target.value)}
              placeholder="例如：张三, 李四"
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">说明</span>
            <Textarea
              value={draft.description}
              disabled={!editable}
              onChange={(event) => set("description", event.target.value)}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">技术备注</span>
            <Textarea
              value={draft.technicalNotes}
              disabled={!editable}
              onChange={(event) => set("technicalNotes", event.target.value)}
              placeholder="音频、灯光、视频、舞台或设备需求"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">准备状态</span>
            <Select
              value={draft.status}
              disabled={!editable}
              onValueChange={(value) => set("status", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(productionProgramStatusLabels)
                  .filter(([value]) => value !== "archived")
                  .map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
          {editable && dirty ? (
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <Button variant="outline" onClick={cancel}>
                取消
              </Button>
              <Button onClick={save} disabled={!draft.name.trim()}>
                <Check />
                保存修改
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card variant="flush">
        <CardHeader className="border-b">
          <CardTitle>资料检查</CardTitle>
          <CardDescription>
            这些提示不会阻止保存，但建议在正式发布前补齐。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 p-4">
          {missing.length ? (
            <p className="text-sm text-amber-600 dark:text-amber-300">
              待补资料：{missing.join("、")}
            </p>
          ) : (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              节目资料已基本完整。
            </p>
          )}
          {program.sourceProgramId ? (
            <p className="text-xs text-muted-foreground">
              来源节目 ID：{program.sourceProgramId}
            </p>
          ) : null}
          {program.sourceEntryId ? (
            <p className="text-xs text-muted-foreground">
              来源征集记录：{program.sourceEntryId}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <FileAttachmentsSection workspace={workspace} production={production} programId={program.id} sourceProgramId={program.sourceProgramId} />
    </div>
  );
}
