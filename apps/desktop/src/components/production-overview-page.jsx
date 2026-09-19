import { useEffect, useMemo, useState } from "react";

import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock3,
  Copy,
  FileText,
  MoreHorizontal,
  Pencil,
  Sparkles,
  UsersRound,
  Workflow,
} from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { previewProductionTimezone, productionStatusLabel } from "@/lib/production-api";
import { getSupportedTimeZones, resolveWallClockTime, timeZoneCityLabel } from "@/lib/timezone";
import { formatSlotLabel, instantToParts, toDateKey } from "@/lib/date-time";
import { notify } from "@/components/ui/sonner";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { ProductionDateTimePopoverField } from "@/components/production-overview/production-datetime-popover-field";
import { ProductionLocationPopover } from "@/components/production-overview/production-location-popover";
import { ProductionOverviewField } from "@/components/production-overview/production-overview-field";
import { ActivityTimeText } from "@/components/time-text";

const defaultActivityNamePattern = /^活动-\d+$/;

function ChecklistItem({ complete, icon: Icon, title, description, future = false }) {
  return (
    <div className="flex items-start gap-3 border-b py-3 last:border-b-0">
      <div className="mt-0.5">
        {complete ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
      </div>
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {future && <Badge variant="outline">即将开放</Badge>}
    </div>
  );
}

function ProductionActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="活动操作"><MoreHorizontal /></Button>} />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>活动操作</DropdownMenuLabel>
          <DropdownMenuItem disabled><Copy />复制活动</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>更多操作即将开放</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function validateName(value) {
  if (!String(value ?? "").trim()) return "请输入活动名称。";
  return null;
}

function validateTimezone(value, timezones) {
  return timezones.includes(value) ? null : "请选择有效的项目时区。";
}

const TIMEZONE_KEEP_WALL_TIME = "keep_wall_time";
const TIMEZONE_KEEP_INSTANT = "keep_instant";

function ProductionTimezoneChangeDialog({ open, onOpenChange, currentTimezone, nextTimezone, strategy, onStrategyChange, onConfirm, busy, preview, previewLoading }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>更改活动时区</DialogTitle>
          <DialogDescription>
            {timeZoneCityLabel(currentTimezone)}（{currentTimezone}）→ {timeZoneCityLabel(nextTimezone)}（{nextTimezone}）。请选择如何处理已有的计划时间；实际发生时间不会改变。
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={strategy} onValueChange={onStrategyChange} className="gap-2">
          <label className="flex cursor-pointer items-start gap-2 border p-3">
            <RadioGroupItem value={TIMEZONE_KEEP_WALL_TIME} className="mt-0.5" />
            <span><span className="block text-sm font-medium">保持本地时间</span><span className="text-xs text-muted-foreground">活动、场次、彩排和安排的计划时间保持原来的墙钟时间，同时重新计算 UTC 时刻。</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 border p-3">
            <RadioGroupItem value={TIMEZONE_KEEP_INSTANT} className="mt-0.5" />
            <span><span className="block text-sm font-medium">保持实际时间</span><span className="text-xs text-muted-foreground">保留 UTC 时刻不变，计划时间会按新时区显示为不同的本地时间。</span></span>
          </label>
        </RadioGroup>
        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          {previewLoading ? "正在计算受影响的计划…" : preview ? <><p>将影响 {preview.counts.occurrences} 个场次、{preview.counts.rehearsals} 个彩排和 {preview.counts.schedule_items} 个排程项目。</p>{preview.samples?.some((item) => item.date_changed) ? <p className="mt-1 text-amber-600">部分时间会发生日期变化，请确认后继续。</p> : null}</> : "无法加载影响摘要，确认后服务端仍会再次校验。"}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>{busy ? "保存中…" : "确认更改"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductionTimezoneField({ productionId, timezone, timezones, onSave, disabled = false, isCreationSession = false }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingTimezone, setPendingTimezone] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [strategy, setStrategy] = useState(TIMEZONE_KEEP_WALL_TIME);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    if (!dialogOpen || !pendingTimezone || isCreationSession) return;
    let cancelled = false;
    setPreviewLoading(true);
    previewProductionTimezone(productionId, pendingTimezone, strategy).then((result) => { if (!cancelled) setPreview(result); }).catch(() => { if (!cancelled) setPreview(null); }).finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [dialogOpen, pendingTimezone, strategy, isCreationSession, productionId]);
  const selectTimezone = (nextTimezone) => {
    if (!nextTimezone || nextTimezone === timezone || saving) {
      setOpen(false);
      return;
    }
    if (validateTimezone(nextTimezone, timezones)) return;
    setOpen(false);
    setPendingTimezone(nextTimezone);
    setPreview(null);
    setStrategy(TIMEZONE_KEEP_WALL_TIME);
    setDialogOpen(true);
  };
  const confirmTimezone = async () => {
    if (!pendingTimezone || saving) return;
    setSaving(true);
    const toast = notify.loading("正在更新活动时区…");
    try {
      const result = await onSave(pendingTimezone, strategy);
      if (result !== false && result?.ok !== false) {
        setDialogOpen(false);
        setPendingTimezone("");
        if (isCreationSession) notify.success("活动时区已更新");
      }
    } finally {
      notify.dismiss(toast);
      setSaving(false);
    }
  };
  return <div className="flex min-w-0 items-start gap-2">
    <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0 flex-1">
      <p className="text-xs text-muted-foreground">活动时区 · 高级设置</p>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-lg">
        <span className="min-w-0 truncate">{timeZoneCityLabel(timezone)} · {timezone}</span>
        <TimezoneCombobox
          value={timezone}
          open={open}
          onOpenChange={(next) => !saving && setOpen(next)}
          onValueChange={selectTimezone}
          disabled={disabled || saving}
          trigger={<Button type="button" variant="ghost" size="icon-xs" aria-label="编辑项目时区" title="编辑项目时区"><Pencil /></Button>}
        />
      </div>
    </div>
    <ProductionTimezoneChangeDialog open={dialogOpen} onOpenChange={setDialogOpen} currentTimezone={timezone} nextTimezone={pendingTimezone} strategy={strategy} onStrategyChange={setStrategy} onConfirm={confirmTimezone} busy={saving} preview={preview} previewLoading={previewLoading} />
  </div>;
}

function ProductionSummary({ workspace, production, onSave, onTimezoneSave, onLocationChanged, locationRefreshKey, disabled = false }) {
  const timezones = useMemo(() => getSupportedTimeZones(), []);
  const timezone = production.timezone || "Asia/Shanghai";

  return (
    <section className="grid gap-4 @min-[40rem]/production-overview:grid-cols-2 @min-[64rem]/production-overview:grid-cols-4">
      <Card>
        <CardHeader>
          <CardDescription>地点</CardDescription>
          <CardTitle>
            <ProductionLocationPopover workspace={workspace} production={production} onChanged={onLocationChanged} refreshKey={locationRefreshKey} disabled={disabled} />
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <ProductionDateTimePopoverField
            label="项目开始"
            value={production.plannedStartAt}
            timezone={timezone}
            disabled={disabled}
            onSave={(value) => onSave("plannedStartAt", value)}
          />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <ProductionDateTimePopoverField
            label="预计完成"
            value={production.plannedEndAt}
            timezone={timezone}
            disabled={disabled}
            onSave={(value) => onSave("plannedEndAt", value)}
          />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <ProductionTimezoneField productionId={production.id} timezone={timezone} timezones={timezones} onSave={onTimezoneSave || ((value, strategy) => onSave("timezone", value, strategy))} isCreationSession={production.isCreationSession} disabled={disabled} />
        </CardHeader>
      </Card>

      {production.actualCompletedAt && (
        <Card>
          <CardHeader>
            <CardDescription>实际完成</CardDescription>
            <CardTitle className="flex min-h-8 items-center gap-2 text-lg">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              <ActivityTimeText instant={production.actualCompletedAt} timezone={timezone} />
            </CardTitle>
          </CardHeader>
        </Card>
      )}
    </section>
  );
}

function rebaseCreationInstant(instant, sourceTimezone, targetTimezone) {
  if (!instant) return "";
  const { date, minutes } = instantToParts(instant, sourceTimezone);
  if (!date || minutes == null) return "";
  const result = resolveWallClockTime(`${toDateKey(date)}T${formatSlotLabel(minutes)}`, targetTimezone);
  return result.status === "valid" ? result.instant : "";
}

export function ProductionOverviewPage({ workspace, production, onUpdateProduction, onLeaveCreation, creationBusy = false }) {
  const isCreationSession = Boolean(production.isCreationSession);
  const status = productionStatusLabel(production.status);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);

  const saveField = async (key, explicitValue, timezoneChangeStrategy) => {
    let value = explicitValue ?? "";
    if (key === "name" || key === "description") value = String(value).trim();
    return onUpdateProduction?.({ [key]: value, ...(timezoneChangeStrategy ? { timezoneChangeStrategy } : {}) });
  };
  const saveTimezone = async (nextTimezone, changeStrategy) => {
    if (!isCreationSession || changeStrategy === TIMEZONE_KEEP_INSTANT) {
      return saveField("timezone", nextTimezone, changeStrategy);
    }
    const sourceTimezone = production.timezone || "Asia/Shanghai";
    const plannedStartAt = rebaseCreationInstant(production.plannedStartAt, sourceTimezone, nextTimezone);
    const plannedEndAt = rebaseCreationInstant(production.plannedEndAt, sourceTimezone, nextTimezone);
    if ((production.plannedStartAt && !plannedStartAt) || (production.plannedEndAt && !plannedEndAt)) {
      notify.error("无法同步活动时间", { description: "目标时区中的计划时间无效，请改用“保持实际时间”或先调整计划时间。" });
      return false;
    }
    return onUpdateProduction?.({ timezone: nextTimezone, plannedStartAt, plannedEndAt });
  };

  const complete = Boolean(
    production.name?.trim() &&
    !defaultActivityNamePattern.test(production.name.trim()) &&
    production.plannedStartAt &&
    production.plannedEndAt,
  );
  const checklist = useMemo(
    () => [
      [complete, Sparkles, "设置基本信息", "名称、时间、地点与简介"],
      [false, ClipboardCheck, "添加节目", "从工作空间节目库选择，或创建本场活动的节目"],
      [false, UsersRound, "邀请工作人员", "从工作空间添加成员，或创建外部协作者邀请"],
      [false, Workflow, "配置排程", "场次、彩排和总日程页面正在接入服务端", true],
    ],
    [complete],
  );

  return (
    <div className="@container/production-overview min-w-0 space-y-6">
      <ProductionPageHeader
        workspace={workspace}
        production={production}
        onLeaveCreation={isCreationSession ? onLeaveCreation : undefined}
        subtitle={isCreationSession ? "活动工作区 · 填写基础信息后创建正式活动" : `${workspace.name} · 活动工作区`}
        actions={{ overflow: <ProductionActions /> }}
        titleContent={
          <div className="flex flex-wrap items-center gap-3">
            <ProductionOverviewField
              label="活动名称"
              value={production.name}
              displayValue={production.name || "未命名活动"}
              placeholder="未命名活动"
              hideLabel
              variant="title"
              disabled={creationBusy}
              validate={validateName}
              onSave={(value) => saveField("name", value)}
              renderEditor={({ draft, setDraft, disabled, id }) => (
                <Input
                  id={id}
                  autoFocus
                  value={draft}
                  disabled={disabled}
                  maxLength={120}
                  placeholder="输入活动名称"
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
              contentClassName="w-80"
            />
            {!isCreationSession && <Badge className={status.className} variant="secondary">{status.label}</Badge>}
          </div>
        }
      />

      <ProductionSummary workspace={workspace} production={production} onSave={saveField} onTimezoneSave={saveTimezone} onLocationChanged={() => setLocationRefreshKey((value) => value + 1)} locationRefreshKey={locationRefreshKey} disabled={creationBusy} />

      <section className="grid gap-4 @min-[64rem]/production-overview:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader><CardTitle>活动说明</CardTitle></CardHeader>
          <CardContent className="min-h-28 text-sm text-muted-foreground">
            <ProductionOverviewField
              label="活动说明"
              value={production.description}
              displayValue={production.description || "尚未填写描述。"}
              hideLabel
              disabled={creationBusy}
              onSave={(value) => saveField("description", value)}
              renderEditor={({ draft, setDraft, disabled, id }) => (
                <textarea
                  id={id}
                  autoFocus
                  className="min-h-28 w-full resize-y border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={draft}
                  disabled={disabled}
                  maxLength={500}
                  placeholder="添加这场活动的内部说明…"
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
              contentClassName="w-96"
              className="items-start"
              valueClassName="line-clamp-4 text-sm text-muted-foreground"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>下一步</CardTitle><CardDescription>根据当前已接入模块显示。</CardDescription></CardHeader>
          <CardContent>{checklist.map(([done, Icon, title, description, future]) => <ChecklistItem key={title} complete={done} icon={Icon} title={title} description={description} future={future} />)}</CardContent>
        </Card>
      </section>

      <Card className="border-dashed">
        <CardContent className="min-h-24 py-5 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 size-5 shrink-0" />
            <div className="space-y-1">
              <p>已接入：活动基础资料、成员与邀请、文件资料、活动地点，以及工作空间资源库。</p>
              <p>当前仍为本地预览：活动节目和节目单编排；场次、彩排、总日程与报名征集正在接入服务端。</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
