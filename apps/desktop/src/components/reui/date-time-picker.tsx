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
}) {
  const [open, setOpen] = useState(false)
  // 面板内的待定日期：选中日期但不选时间时，不产生不完整提交。
  const [pendingDate, setPendingDate] = useState(null)
  const [month, setMonth] = useState(undefined)

  const { date: valueDate, minutes: valueMinutes } = instantToParts(value, timezone)
  const today = useMemo(() => todayInTimezone(timezone), [timezone, open])

  useEffect(() => {
    if (open) {
      setPendingDate(valueDate ?? null)
      setMonth(valueDate ?? todayInTimezone(timezone))
    }
  }, [open, timezone])

  const slots = useMemo(
    () => Array.from({ length: SLOTS_PER_DAY }, (_, index) => index * TIME_SLOT_STEP_MINUTES),
    [],
  )

  const commit = (date, minutes) => {
    if (!date) return
    const key = toDateKey(date)
    const instant = wallClockToInstant(`${key}T${formatSlotLabel(minutes)}`, timezone)
    if (!instant) return
    onChange?.(instant)
    setOpen(false)
  }

  const handleSelectDate = (date) => {
    setPendingDate(date ?? null)
    if (!date) return
    // 已有完整值的时间部分作为默认时刻；否则整点（草稿常见 00:00 起步）。
    const fallbackMinutes = valueDate && valueMinutes != null && toDateKey(valueDate) === toDateKey(date)
      ? valueMinutes
      : 9 * 60
    commit(date, fallbackMinutes)
  }

  const display = formatDateTimeValue(value, timezone)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("group/date-time w-full justify-between font-normal", className)}
            aria-label="选择日期与时间"
          >
            <span className={cn("truncate", !display && "text-muted-foreground")}>
              {display || placeholder}
            </span>
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
        <div className="flex max-sm:flex-col">
          <CalendarYearView
            selected={pendingDate ?? undefined}
            onSelect={handleSelectDate}
            month={month}
            onMonthChange={setMonth}
            footer={
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                先选日期，再在右侧选择时间
              </div>
            }
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
                        variant={
                          pendingDate && valueDate && toDateKey(pendingDate) === toDateKey(valueDate) && valueMinutes === slot
                            ? "default"
                            : "outline"
                        }
                        onClick={() => {
                          if (!pendingDate) return
                          commit(pendingDate, slot)
                        }}
                        disabled={!pendingDate}
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
        {clearable && (value || pendingDate) && (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => {
                setPendingDate(null)
                onChange?.("")
                setOpen(false)
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
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
