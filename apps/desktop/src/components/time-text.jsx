import { useEffect, useRef, useState } from "react"
import { formatInstantInTimeZone, normalizeTimeZone, timeZoneOffsetLabel } from "@/lib/timezone"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useUserPreferences } from "@/components/user-preferences-provider"

export function TimeText({ instant, timezone, className, withTimezone = false, ...options }) {
  if (!instant) return null
  const zone = normalizeTimeZone(timezone)
  return <span className={className}>{formatInstantInTimeZone(instant, zone, options)}{withTimezone ? ` · ${zone}` : ""}</span>
}

export function TimeDetailsPopover({ instant, timezone, userTimezone, children }) {
  if (!instant) return null
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) return children || <TimeText instant={instant} timezone={timezone} />
  const zone = normalizeTimeZone(timezone)
  const preferenceZone = normalizeTimeZone(userTimezone || zone)
  const deviceZone = normalizeTimeZone(typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : preferenceZone)
  if (preferenceZone === zone) return children || <TimeText instant={instant} timezone={zone} />
  const viewerRows = []
  if (preferenceZone !== zone) viewerRows.push([preferenceZone === deviceZone ? "我的时区" : "我的偏好时区", preferenceZone])
  if (deviceZone !== zone && deviceZone !== preferenceZone) viewerRows.push(["当前设备时区", deviceZone])
  return <TimeDetailsPopoverInteractive instant={instant} zone={zone} viewerRows={viewerRows} children={children} />
}

function TimeDetailsPopoverInteractive({ instant, zone, viewerRows, children }) {
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef(null)

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const openPopover = () => {
    clearCloseTimer()
    setOpen(true)
  }

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, 200)
  }

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) openPopover()
    else {
      clearCloseTimer()
      setOpen(false)
    }
  }

  useEffect(() => () => clearCloseTimer(), [])

  const triggerContent = children || <TimeText instant={instant} timezone={zone} />
  return <Popover open={open} onOpenChange={handleOpenChange}>
    <PopoverTrigger render={<button
      type="button"
      aria-label="查看时间详情"
      title="查看活动时区与本地时间"
      data-time-details-trigger="true"
      className="inline appearance-none m-0 cursor-help border-0 bg-transparent p-0 align-baseline font-inherit leading-inherit text-inherit outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onPointerEnter={openPopover}
      onPointerLeave={scheduleClose}
      onFocus={openPopover}
      onBlur={(event) => {
        if (!event.relatedTarget?.closest?.('[data-time-details-content="true"]')) scheduleClose()
      }}
    >{triggerContent}</button>} />
    <PopoverContent
      data-time-details-content="true"
      align="start"
      className="w-80 space-y-3 text-sm"
      onPointerEnter={openPopover}
      onPointerLeave={scheduleClose}
      onFocus={openPopover}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose()
      }}
    >
      <p className="font-medium">时间详情</p>
      <div className="space-y-2 text-muted-foreground">
        <p><span className="font-medium text-foreground">活动时区</span><br />{formatInstantInTimeZone(instant, zone)} · {zone} ({timeZoneOffsetLabel(instant, zone)})</p>
        {viewerRows.map(([label, viewerZone]) => <p key={label}><span className="font-medium text-foreground">{label}</span><br />{formatInstantInTimeZone(instant, viewerZone)} · {viewerZone} ({timeZoneOffsetLabel(instant, viewerZone)})</p>)}
        <p><span className="font-medium text-foreground">UTC</span><br />{formatInstantInTimeZone(instant, "UTC")} · UTC</p>
      </div>
    </PopoverContent>
  </Popover>
}

export function ActivityTimeText({ instant, timezone, children, ...options }) {
  const { timezone: userTimezone } = useUserPreferences()
  return <TimeDetailsPopover instant={instant} timezone={timezone} userTimezone={userTimezone} children={children || <TimeText instant={instant} timezone={timezone} {...options} />} />
}
