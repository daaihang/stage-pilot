import { useState } from "react"
import { formatInstantInTimeZone, normalizeTimeZone, resolveTimeZoneDetails, timeZoneOffsetLabel } from "@/lib/timezone"
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
  const deviceTimezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : userTimezone
  const details = resolveTimeZoneDetails({ activityTimezone: zone, userTimezone, deviceTimezone })
  if (!details.showPopover) return children || <TimeText instant={instant} timezone={zone} />
  return <TimeDetailsPopoverInteractive instant={instant} zone={details.activityTimezone} viewerRows={details.rows.map(({ label, timezone: viewerZone }) => [label, viewerZone])} children={children} />
}

function TimeDetailsPopoverInteractive({ instant, zone, viewerRows, children }) {
  const [open, setOpen] = useState(false)

  const triggerContent = children || <TimeText instant={instant} timezone={zone} />
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger openOnHover delay={0} closeDelay={200} render={<button
      type="button"
      aria-label="查看时间详情"
      title="查看活动时区与本地时间"
      data-time-details-trigger="true"
      className="inline appearance-none m-0 cursor-help border-0 bg-transparent p-0 align-baseline font-inherit leading-inherit text-inherit outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >{triggerContent}</button>} />
    <PopoverContent
      data-time-details-content="true"
      align="start"
      collisionPadding={{ top: 40, right: 8, bottom: 8, left: 8 }}
      collisionAvoidance={{ side: "shift", fallbackAxisSide: "none" }}
      className="w-80 space-y-3 text-sm"
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
