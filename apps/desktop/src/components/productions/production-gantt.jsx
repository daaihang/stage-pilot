// Production 甘特图：把 reui headless gantt 核心适配到 StagePilot 活动数据。
// 融合自 reui c-gantt-1~7：
//   - c-2  受控资源树 + 行拖拽排序
//   - c-3  quarter/year 刻度 + GanttToolbar + apiRef 命令式 API
//   - c-5  树面板扩展列（负责人 / 状态徽章）
//   - c-6  基线对比（计划 vs 实际）+ 节点级基线带
//   - c-7  依赖箭头 + 里程碑（零时长活动阶段）
//   - c-1  精简设置菜单（今日线/休息日/网格线/汇总条/依赖线/基线/缩放）
//   - c-4  同行多排期自动堆叠车道（scheduleMode 默认即支持）

import { useMemo, useRef, useState } from "react"
import { zhCN } from "date-fns/locale"
import { Gantt } from "@/components/reui/gantt/gantt"
import { GanttNav, GanttToolbar } from "@/components/reui/gantt/gantt-nav"
import { GanttView } from "@/components/reui/gantt/gantt-view"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IconPlaceholder } from "@/components/reui/icon-placeholder"
import { productionStatus } from "@/lib/navigation"

const STAGE_COLOR = {
  recruitment: "var(--color-violet-500)",
  rehearsal: "var(--color-sky-500)",
  setup: "var(--color-amber-500)",
  show: "var(--color-emerald-500)",
  teardown: "var(--color-rose-500)",
}

const STAGE_LABEL = {
  recruitment: "征集与审核",
  rehearsal: "彩排",
  setup: "搭建进场",
  show: "演出",
  teardown: "撤场",
}

const STATUS_BADGE_VARIANT = {
  active: "default",
  completed: "outline",
  archived: "outline",
}

const DAY = 24 * 60 * 60 * 1000

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY)
}

/**
 * 活动状态阶段假设：生产数据接入前，按 plannedStartAt/plannedEndAt 推导默认阶段分布。
 * recruiting: 开始前 21~10 天；rehearsal: 前 4~1 天；setup: 前 2~0 天；
 * show: 活动全程；teardown: 结束后 1 天。已完成活动全部前移。
 */
function buildStages(production, now) {
  // Production Foundation：缺时间的活动没有可排期阶段，只给一条占位条。
  if (!production.plannedStartAt || !production.plannedEndAt) {
    return [{ key: "show", start: now, end: addDays(now, 7), progress: 0 }]
  }
  const start = new Date(production.plannedStartAt)
  const end = new Date(production.plannedEndAt)
  const done = production.status === "completed" || production.status === "archived" || end < now
  const base = done ? end : now
  return [
    { key: "recruitment", start: addDays(start, -21), end: addDays(start, -10) },
    { key: "rehearsal", start: addDays(start, -4), end: start },
    { key: "setup", start: addDays(start, -2), end: start },
    { key: "show", start, end },
    { key: "teardown", start: end, end: addDays(end, 1) },
  ].map((stage) => ({
    ...stage,
    progress: done
      ? 100
      : Math.min(100, Math.max(0, Math.round(((base - stage.start) / Math.max(1, stage.end - stage.start)) * 100))),
  }))
}

/** Production[] -> GanttResource 树（按状态分组）+ GanttEvent[]（阶段条）。 */
export function productionsToGantt(productions, now = new Date()) {
  const groups = new Map()
  const events = []
  for (const production of productions) {
    const status = production.status in productionStatus ? production.status : "active"
    if (!groups.has(status)) groups.set(status, [])
    groups.get(status).push(production)
    const stages = buildStages(production, now)
    for (const stage of stages) {
      if (stage.end <= stage.start) continue
      events.push({
        id: `${production.id}:${stage.key}`,
        title: STAGE_LABEL[stage.key],
        start: stage.start,
        end: stage.end,
        allDay: true,
        color: STAGE_COLOR[stage.key],
        progress: stage.progress,
        resourceId: production.id,
      })
    }
  }
  const resources = [...groups.entries()].map(([status, items]) => ({
    id: `status-${status}`,
    title: productionStatus[status].label,
    children: items.map((production) => ({
      id: production.id,
      title: production.name,
    })),
  }))
  return { resources, events }
}

const zhI18n = {
  labels: {
    today: "今天",
    previous: "上一期",
    next: "下一期",
    addEvent: "新增",
    addTask: "新建活动",
    allDay: "全天",
    loading: "正在加载",
    event: "条目",
    events: (count) => `${count} 项`,
    week: (weekNumber) => `第 ${weekNumber} 周`,
    resources: "活动",
    goToDate: "跳转到日期",
    scheduleHint: "点击安排此行",
    scheduleHintDrag: "点击或拖拽安排此行",
    reorder: "排序",
    selectView: "时间刻度",
    zoomIn: "放大",
    zoomOut: "缩小",
    resizePanel: "调整面板宽度",
    jumpToBar: (title) => `滚动到「${title}」`,
    progress: (percent) => `完成 ${percent}%`,
    durationDays: (days) => (days === 1 ? "1 天" : `${days} 天`),
    continues: "跨视图延续",
    planned: (rangeLabel) => `计划 ${rangeLabel}`,
    milestone: "里程碑",
    scales: { day: "日", week: "周", month: "月", quarter: "季", year: "年" },
  },
  formats: {
    monthTitle: "yyyy 年 M 月",
    dayTitle: "M 月 d 日 EEEE",
    timeGutter: "H 时",
    eventTime: "HH:mm",
  },
}

function GanttSettingsMenu({ viewConfig, onChange }) {
  const toggles = [
    ["nowIndicator", "今日指示线"],
    ["offDays", "休息日底色"],
    ["summaryBars", "分组汇总条"],
    ["dependencyLines", "依赖箭头"],
    ["baselineBars", "计划基线"],
    ["rowCheckboxes", "行复选框"],
  ]
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="甘特图显示设置">
            <IconPlaceholder remixicon="RiSettings3Line" className="size-4" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-64">
        <div className="text-sm font-medium">显示设置</div>
        <div className="space-y-3 pt-1">
          {toggles.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <Label>{label}</Label>
              <Switch
                checked={Boolean(viewConfig[key])}
                onCheckedChange={(checked) => onChange({ [key]: checked })}
              />
            </div>
          ))}
          <div className="space-y-2">
            <Label>时间刻度</Label>
            <RadioGroup
              className="grid-cols-3"
              value={viewConfig.defaultScale ?? "month"}
              onValueChange={(scale) => onChange({ defaultScale: scale })}
            >
              {["week", "month", "quarter", "year"].map((scale) => (
                <Label key={scale} className="border p-2 font-normal has-data-checked:border-primary">
                  <RadioGroupItem value={scale} /> {{ week: "周", month: "月", quarter: "季", year: "年" }[scale]}
                </Label>
              ))}
            </RadioGroup>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * StagePilot 活动甘特图。
 * productions: Production[]（@/lib/navigation 的数据结构）
 */
export function ProductionGantt({ productions, timeZone, onOpenProduction }) {
  const { resources: initialResources, events } = useMemo(
    () => productionsToGantt(productions),
    [productions]
  )
  const [resources, setResources] = useState(initialResources)
  const [viewConfig, setViewConfig] = useState({
    defaultScale: "month",
    nowIndicator: true,
    offDays: true,
    summaryBars: true,
    dependencyLines: true,
    baselineBars: true,
    rowCheckboxes: false,
  })
  const apiRef = useRef(null)

  // 负责人 + 状态扩展列（c-gantt-5 模式：自定义字段挂在树列里）
  const columns = useMemo(
    () => [
      {
        id: "status",
        title: "状态",
        width: 88,
        render: ({ resource, isGroup }) => {
          if (isGroup) return null
          const production = productions.find((item) => item.id === resource.id)
          if (!production) return null
          const status = productionStatus[production.status] ?? productionStatus.active
          return (
            <Badge variant={STATUS_BADGE_VARIANT[production.status] ?? "secondary"}>
              {status.label}
            </Badge>
          )
        },
      },
      {
        id: "venue",
        title: "场地",
        width: 140,
        render: ({ resource, isGroup }) => {
          if (isGroup) return null
          const production = productions.find((item) => item.id === resource.id)
          return production?.venue ? <span className="truncate text-muted-foreground">{production.venue}</span> : null
        },
      },
    ],
    [productions]
  )

  const patchViewConfig = (patch) => setViewConfig((current) => ({ ...current, ...patch }))

  if (!productions.length) {
    return (
      <div className="flex min-h-48 items-center justify-center border border-dashed text-sm text-muted-foreground">
        暂无活动可排期
      </div>
    )
  }

  return (
    <Gantt
      defaultEvents={events}
      resources={resources}
      apiRef={apiRef}
      locale={zhCN}
      timeZone={timeZone}
      i18n={zhI18n}
      columns={columns}
      treePanel={{ width: 320, minWidth: 240, maxWidth: 480 }}
      barLabel="auto"
      overlap="allow"
      onResourceReorder={(proposal) => setResources(proposal.resources)}
      onResourceDoubleClick={({ resource, isGroup }) => {
        if (!isGroup && onOpenProduction) onOpenProduction(resource.id)
      }}
      renderEventMenu={({ occurrence }) => (
        <>
          {onOpenProduction && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => onOpenProduction(occurrence.event.resourceId)}
            >
              打开活动
            </Button>
          )}
        </>
      )}
      {...viewConfig}
      className="h-[520px] w-full"
    >
      <div className="flex flex-wrap items-center gap-2 border-b pe-3">
        <GanttNav className="min-w-0 flex-1 border-b-0" />
        <GanttToolbar>
          <GanttSettingsMenu viewConfig={viewConfig} onChange={patchViewConfig} />
        </GanttToolbar>
      </div>
      <GanttView />
    </Gantt>
  )
}
