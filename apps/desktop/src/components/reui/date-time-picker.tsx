// Title: DateTimePicker
// Description: 日期时间复合选择器：左侧 calendar-26 年份视图日历，右侧全天生成的
// 15 分钟粒度时间槽。value/onChange 走 UTC instant 串，墙钟解释一律按活动时区
// （@date-fns/tz），替代散落的 datetime-local + 机器时区换算。

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { zhCN as dateFnsZhCN } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { IconPlaceholder } from "@/components/reui/icon-placeholder"
import { CalendarYearView } from "@/components/reui/calendar-26"
import {
  DEFAULT_TIMEZONE,
  SLOTS_PER_DAY,
  TIME_SLOT_STEP_MINUTES,
  formatChineseDate,
  formatSlotLabel,
  instantToParts,
  toDateKey,
  todayInTimezone,
  wallClockToInstant,
} from "@/lib/date-time"

const DAY_MINUTES = 24 * 60

function formatDateTimeValue(instant, timezone) {
  if (!instant) return ""
  const { date, minutes } = instantToParts(instant, timezone)
  if (!date) return ""
  const dateText = formatChineseDate(date)
  return minutes == null ? dateText : `${dateText} ${formatSlotLabel(minutes)}`
}

/**
 * 日期时间选择面板。它不创建自己的 Popover，因此可以嵌入字段编辑
 * Popover 中；调用方决定何时关闭面板以及何时真正保存业务字段。
 */
export function DateTimePickerPanel({
  value,
  onChange,
  timezone = DEFAULT_TIMEZONE,
  active = true,
  disabled = false,
  clearable = true,
}) {
  const [pendingDate, setPendingDate] = useState(null)
  const [pendingMinutes, setPendingMinutes] = useState(null)
  const [month, setMonth] = useState(undefined)
  const { date: valueDate, minutes: valueMinutes } = instantToParts(value, timezone)
  const today = useMemo(() => todayInTimezone(timezone), [timezone, active])

  useEffect(() => {
    if (!active) return
    setPendingDate(valueDate ?? null)
    setPendingMinutes(valueMinutes ?? 9 * 60)
    setMonth(valueDate ?? todayInTimezone(timezone))
  }, [active, timezone, value])

  const slots = useMemo(
    () => Array.from({ length: SLOTS_PER_DAY }, (_, index) => index * TIME_SLOT_STEP_MINUTES),
    [],
  )

  const handleSelectDate = (date) => {
    setPendingDate(date ?? null)
    if (!date) return
    const fallbackMinutes = valueDate && valueMinutes != null && toDateKey(valueDate) === toDateKey(date)
      ? valueMinutes
      : 9 * 60
    setPendingMinutes(fallbackMinutes)
  }

  const confirm = () => {
    if (!pendingDate || pendingMinutes == null) return
    const key = toDateKey(pendingDate)
    const instant = wallClockToInstant(`${key}T${formatSlotLabel(pendingMinutes)}`, timezone)
    if (instant) onChange?.(instant)
  }

  return (
    <div className="w-auto">
      <div className="flex max-sm:flex-col">
        <CalendarYearView
          selected={pendingDate ?? undefined}
          onSelect={handleSelectDate}
          month={month ?? today}
          onMonthChange={setMonth}
        />
        <div className="relative w-full max-sm:h-48 sm:w-40">
          <div className="absolute inset-0 py-4 max-sm:border-t">
            <ScrollArea className="h-full sm:border-s">
              <div className="space-y-3">
                <div className="flex h-5 shrink-0 items-center px-5">
                  <p className="text-sm font-medium">
                    {pendingDate ? format(pendingDate, "M月d日 EEEE", { locale: dateFnsZhCN }) : "选择时间"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1.5 px-5 sm:grid-cols-1">
                  {slots.map((slot) => (
                    <Button
                      key={slot}
                      type="button"
                      className="w-full"
                      size="sm"
                      variant={pendingDate && pendingMinutes === slot ? "default" : "outline"}
                      onClick={() => {
                        if (pendingDate) setPendingMinutes(slot)
                      }}
                      disabled={disabled || !pendingDate}
                    >
                      {formatSlotLabel(slot)}
                    </Button>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
      {(clearable || pendingDate) && (
        <div className="flex items-center justify-end gap-2 border-t p-2">
          {clearable && (value || pendingDate) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={disabled}
              onClick={() => {
                setPendingDate(null)
                setPendingMinutes(null)
                onChange?.("")
              }}
            >
              <IconPlaceholder
                lucide="XIcon"
                tabler="IconX"
                hugeicons="Cancel01Icon"
                phosphor="XIcon"
                remixicon="RiCloseLine"
                aria-hidden="true"
              />
              清除时间
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={confirm}
            disabled={disabled || !pendingDate || pendingMinutes == null}
          >
            应用
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * @param {string|null} value UTC instant 串或空
 * @param {(instant: string) => void} onChange 合成完成（含时间）后回调
 * @param {string} timezone 活动时区（IANA），墙钟解释基准
 */
export function DateTimePicker({
  value,
  onChange,
  timezone = DEFAULT_TIMEZONE,
  disabled = false,
  placeholder = "未设置",
  clearable = true,
  className,
  align = "start",
  iconOnly = false,
}) {
  const [open, setOpen] = useState(false)
  const display = formatDateTimeValue(value, timezone)

  const handleChange = (instant) => {
    onChange?.(instant)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            size={iconOnly ? "icon" : "default"}
            className={cn(iconOnly ? "size-8" : "group/date-time w-full justify-between font-normal", className)}
            aria-label={iconOnly ? (display || "选择日期与时间") : undefined}
            title={iconOnly ? (display || "选择日期与时间") : undefined}
          >
            {!iconOnly && <span className={cn("truncate", !display && "text-muted-foreground")}>
              {display || placeholder}
            </span>}
            <IconPlaceholder
              lucide="CalendarIcon"
              tabler="IconCalendarEvent"
              hugeicons="Calendar04Icon"
              phosphor="CalendarBlankIcon"
              remixicon="RiCalendarLine"
              aria-hidden="true"
              className="text-muted-foreground/80 group-hover:text-foreground shrink-0 transition-colors"
            />
          </Button>
        }
      />
      <PopoverContent align={align} className="w-auto p-0">
        <DateTimePickerPanel
          value={value}
          timezone={timezone}
          active={open}
          disabled={disabled}
          clearable={clearable}
          onChange={handleChange}
        />
      </PopoverContent>
    </Popover>
  )
}
