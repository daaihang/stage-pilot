import { useMemo, useState } from "react";

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
import { formatProductionInstant, productionStatusLabel } from "@/lib/production-api";
import { getSupportedTimeZones, timeZoneCityLabel } from "@/lib/timezone";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import { ProductionPageHeader } from "@/components/production-page-shell";
import { ProductionDateTimePopoverField } from "@/components/production-overview/production-datetime-popover-field";
import { ProductionLocationPopover } from "@/components/production-overview/production-location-popover";
import { ProductionOverviewField } from "@/components/production-overview/production-overview-field";

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

function ProductionTimezoneField({ timezone, timezones, onSave, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectTimezone = async (nextTimezone) => {
    if (!nextTimezone || nextTimezone === timezone || saving) {
      setOpen(false);
      return;
    }
    if (validateTimezone(nextTimezone, timezones)) return;
    setSaving(true);
    try {
      const result = await onSave(nextTimezone);
      if (result !== false) setOpen(false);
    } finally {
      setSaving(false);
    }
  };
  return <div className="flex min-w-0 items-start gap-2">
    <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0 flex-1">
      <p className="text-xs text-muted-foreground">项目时区</p>
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
  </div>;
}

function ProductionSummary({ workspace, production, onSave, onLocationChanged, locationRefreshKey, disabled = false }) {
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
          <ProductionTimezoneField timezone={timezone} timezones={timezones} onSave={(value) => onSave("timezone", value)} disabled={disabled} />
        </CardHeader>
      </Card>

      {production.actualCompletedAt && (
        <Card>
          <CardHeader>
            <CardDescription>实际完成</CardDescription>
            <CardTitle className="flex min-h-8 items-center gap-2 text-lg">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              {formatProductionInstant(production.actualCompletedAt, timezone)}
            </CardTitle>
          </CardHeader>
        </Card>
      )}
    </section>
  );
}

export function ProductionOverviewPage({ workspace, production, onUpdateProduction, onLeaveCreation, creationBusy = false }) {
  const isCreationSession = Boolean(production.isCreationSession);
  const status = productionStatusLabel(production.status);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);

  const saveField = async (key, explicitValue) => {
    let value = explicitValue ?? "";
    if (key === "name" || key === "description") value = String(value).trim();
    return onUpdateProduction?.({ [key]: value });
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
      [false, ClipboardCheck, "添加节目", "节目库和活动节目将在后续阶段接入", true],
      [false, UsersRound, "邀请工作人员", "人员与岗位模块将在后续阶段接入", true],
      [false, Workflow, "创建 Rundown", "流程编排将在后续阶段接入", true],
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
        actions={<ProductionActions />}
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

      <ProductionSummary workspace={workspace} production={production} onSave={saveField} onLocationChanged={() => setLocationRefreshKey((value) => value + 1)} locationRefreshKey={locationRefreshKey} disabled={creationBusy} />

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
        <CardContent className="flex min-h-24 items-center gap-3 text-sm text-muted-foreground">
          <FileText className="size-5" />
          征集、节目、人员、文件与现场模块尚未接入。本次概览不展示虚构业务指标。
        </CardContent>
      </Card>
    </div>
  );
}
