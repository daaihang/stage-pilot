import { useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { zhCN as dateFnsZhCN } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { IconPlaceholder } from "@/components/reui/icon-placeholder"
import { CalendarYearView } from "@/components/reui/calendar-26"
import { DEFAULT_TIMEZONE, formatChineseDate, formatSlotLabel, instantToParts, toDateKey, todayInTimezone } from "@/lib/date-time"
import { resolveWallClockTime } from "@/lib/timezone"

const DAY_MINUTES = 24 * 60

function formatDateTimeValue(instant, timezone) {
  if (!instant) return ""
  const { date, minutes } = instantToParts(instant, timezone)
  if (!date || minutes == null) return ""
  return `${formatChineseDate(date)} ${formatSlotLabel(minutes)}`
}

function parseTimeInput(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim())
  if (!match) return null
  const hour = Number(match[1]); const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null
}

function draftFromValue(value, timezone) {
  const { date, minutes } = instantToParts(value, timezone)
  return { date: date ?? null, minutes: minutes ?? 9 * 60, timeInput: minutes == null ? "09:00" : formatSlotLabel(minutes) }
}

export function DateTimePickerPanel({ value, onChange, onDraftChange, timezone = DEFAULT_TIMEZONE, active = true, disabled = false, clearable = true, step = 15, showFooter = true, showApply = true }) {
  const safeStep = Number.isInteger(step) && step >= 1 && step <= 60 ? step : 15
  const [pendingDate, setPendingDate] = useState(null)
  const [pendingMinutes, setPendingMinutes] = useState(null)
  const [timeInput, setTimeInput] = useState("09:00")
  const [month, setMonth] = useState(undefined)
  const [error, setError] = useState("")
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const committedRef = useRef("")
  const { date: valueDate, minutes: valueMinutes } = instantToParts(value, timezone)
  const today = useMemo(() => todayInTimezone(timezone), [timezone, active])

  const syncDraft = () => {
    const draft = draftFromValue(value, timezone)
    setPendingDate(draft.date); setPendingMinutes(valueDate ? draft.minutes : null); setTimeInput(draft.timeInput)
    setMonth(draft.date ?? todayInTimezone(timezone)); setError(""); setCandidates([]); setSelectedCandidate(null); setDirty(false); setConflict(false); committedRef.current = value || ""
  }

  useEffect(() => { if (active) syncDraft() }, [active, timezone])
  useEffect(() => {
    if (!active) return
    const next = value || ""
    if (next === committedRef.current) return
    if (dirty) { setConflict(true); return }
    syncDraft()
  }, [value, active, dirty])

  const slots = useMemo(() => {
    if (safeStep < 5 || DAY_MINUTES / safeStep > 288) return []
    return Array.from({ length: Math.floor(DAY_MINUTES / safeStep) }, (_, index) => index * safeStep)
  }, [safeStep])

  const pushDraft = (next) => {
    onDraftChange?.(next)
    committedRef.current = next || ""
    setDirty(false)
    setConflict(false)
  }

  const handleSelectDate = (date) => {
    setPendingDate(date ?? null); setDirty(true); setError(""); setCandidates([]); setSelectedCandidate(null)
    if (!date) { setPendingMinutes(null); pushDraft(""); return }
    const fallback = valueDate && valueMinutes != null && toDateKey(valueDate) === toDateKey(date) ? valueMinutes : 9 * 60
    setPendingMinutes(fallback); setTimeInput(formatSlotLabel(fallback))
    const draft = resolveWallClockTime(`${toDateKey(date)}T${formatSlotLabel(fallback)}`, timezone)
    if (draft.status === "valid") pushDraft(draft.instant)
  }

  const handleTimeInput = (next) => {
    setTimeInput(next); setDirty(true); setCandidates([]); setSelectedCandidate(null)
    const minutes = parseTimeInput(next)
    if (minutes == null) { setPendingMinutes(null); setError("请输入有效时间，例如 09:30"); return }
    if (minutes % safeStep !== 0) { setPendingMinutes(null); setError(`分钟必须按 ${safeStep} 分钟步长对齐`); return }
    setPendingMinutes(minutes); setError("")
    if (pendingDate) {
      const draft = resolveWallClockTime(`${toDateKey(pendingDate)}T${formatSlotLabel(minutes)}`, timezone)
      if (draft.status === "valid") pushDraft(draft.instant)
    }
  }

  const commit = () => {
    if (!pendingDate && (value || dirty)) { onChange?.(""); committedRef.current = ""; setDirty(false); return true }
    if (!pendingDate || pendingMinutes == null) return false
    const result = resolveWallClockTime(`${toDateKey(pendingDate)}T${timeInput}`, timezone, selectedCandidate ? { disambiguation: selectedCandidate === "later" ? "later" : "earlier" } : undefined)
    setCandidates(result.candidates || [])
    if (result.status === "nonexistent") { setError("该时间在此时区不存在，请选择其他时间"); return false }
    if (result.status === "ambiguous" && !selectedCandidate) { setError("该时间在此时区重复，请选择一个 UTC 偏移"); return false }
    if (!result.instant) { setError("日期时间无效，请重新选择"); return false }
    onChange?.(result.instant); committedRef.current = result.instant; setDirty(false); setConflict(false); setError(""); return true
  }

  const selectCandidate = (candidate) => {
    setSelectedCandidate(candidate.instant === candidates[candidates.length - 1]?.instant ? "later" : "earlier")
    setError(""); pushDraft(candidate.instant)
  }

  return (
    <div className="w-auto">
      {conflict && <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs text-amber-700"><span>值已在其他位置更新。</span><Button type="button" variant="ghost" size="sm" onClick={syncDraft}>重新载入</Button></div>}
      <div className="flex items-stretch max-sm:flex-col">
        <CalendarYearView selected={pendingDate ?? undefined} onSelect={handleSelectDate} month={month ?? today} onMonthChange={setMonth} />
        <div className="relative min-h-[320px] w-full max-sm:h-52 sm:w-44"><div className="absolute inset-0 flex flex-col py-2 max-sm:border-t"><ScrollArea className="h-full flex-1 sm:border-s"><div className="space-y-3 px-5">
          <p className="flex h-8 items-center text-sm font-medium">{pendingDate ? format(pendingDate, "M月d日 EEEE", { locale: dateFnsZhCN }) : "选择时间"}</p>
          <Input value={timeInput} onChange={(event) => handleTimeInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} placeholder="HH:mm" inputMode="numeric" aria-label="时间（24 小时制）" aria-invalid={Boolean(error) || undefined} disabled={disabled || !pendingDate} />
          {slots.length > 0 && <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">{slots.map((slot) => <Button key={slot} type="button" className="w-full" size="sm" variant={pendingDate && pendingMinutes === slot ? "default" : "outline"} onClick={() => handleTimeInput(formatSlotLabel(slot))} disabled={disabled || !pendingDate}>{formatSlotLabel(slot)}</Button>)}</div>}
          {candidates.length > 1 && <div className="space-y-1.5" role="radiogroup" aria-label="选择重复时间的 UTC 偏移">{candidates.map((candidate) => <Button key={candidate.instant} type="button" variant="outline" className="w-full justify-start text-xs" onClick={() => selectCandidate(candidate)}>{candidate.offsetLabel}</Button>)}</div>}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div></ScrollArea></div></div>
      </div>
      {showFooter && (showApply ? (clearable || pendingDate || value) : (clearable && (pendingDate || value))) && <div className="flex items-center justify-end gap-2 border-t p-2">
        {clearable && (value || pendingDate) && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled} onClick={() => { setPendingDate(null); setPendingMinutes(null); setTimeInput(""); setDirty(true); setError(""); setCandidates([]); setSelectedCandidate(null); pushDraft("") }}><IconPlaceholder lucide="XIcon" tabler="IconX" hugeicons="Cancel01Icon" phosphor="XIcon" remixicon="RiCloseLine" aria-hidden="true" />清除时间</Button>}
        {showApply && <Button type="button" size="sm" onClick={commit} disabled={disabled || Boolean(error) || (!pendingDate && !value && !dirty) || (pendingDate && pendingMinutes == null)}>确认</Button>}
      </div>}
    </div>
  )
}

export function DateTimePicker({ value, onChange, timezone = DEFAULT_TIMEZONE, disabled = false, placeholder = "未设置", clearable = true, className, align = "start", iconOnly = false, step = 15 }) {
  const [open, setOpen] = useState(false)
  const display = formatDateTimeValue(value, timezone)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="outline" disabled={disabled} size={iconOnly ? "icon" : "default"} className={cn(iconOnly ? "size-8" : "group/date-time w-full justify-between font-normal", className)} aria-label={iconOnly ? (display || "选择日期与时间") : undefined} title={iconOnly ? (display || "选择日期与时间") : undefined}>{!iconOnly && <span className={cn("truncate", !display && "text-muted-foreground")}>{display || placeholder}</span>}<IconPlaceholder lucide="CalendarIcon" tabler="IconCalendarEvent" hugeicons="Calendar04Icon" phosphor="CalendarBlankIcon" remixicon="RiCalendarLine" aria-hidden="true" className="shrink-0 text-muted-foreground/80 transition-colors group-hover/date-time:text-foreground" /></Button>} />
    <PopoverContent align={align} flush className="w-auto p-2"><DateTimePickerPanel value={value} timezone={timezone} active={open} disabled={disabled} clearable={clearable} step={step} onChange={(next) => { onChange?.(next); setOpen(false) }} /></PopoverContent>
  </Popover>
}
