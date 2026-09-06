import { formatInstantInTimeZone, normalizeTimeZone, timeZoneOffsetLabel } from "@/lib/timezone"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
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
  return <Popover><PopoverTrigger render={<Button type="button" variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent">{children || <TimeText instant={instant} timezone={zone} />}</Button>} /><PopoverContent align="start" className="w-80 space-y-3 text-sm"><p className="font-medium">时间详情</p><div className="space-y-2 text-muted-foreground"><p><span className="font-medium text-foreground">活动时区</span><br />{formatInstantInTimeZone(instant, zone)} · {zone} ({timeZoneOffsetLabel(instant, zone)})</p>{viewerRows.map(([label, viewerZone]) => <p key={label}><span className="font-medium text-foreground">{label}</span><br />{formatInstantInTimeZone(instant, viewerZone)} · {viewerZone} ({timeZoneOffsetLabel(instant, viewerZone)})</p>)}<p><span className="font-medium text-foreground">UTC</span><br />{formatInstantInTimeZone(instant, "UTC")} · UTC</p></div></PopoverContent></Popover>
}

export function ActivityTimeText({ instant, timezone, children, ...options }) {
  const { timezone: userTimezone } = useUserPreferences()
  return <TimeDetailsPopover instant={instant} timezone={timezone} userTimezone={userTimezone} children={children || <TimeText instant={instant} timezone={timezone} {...options} />} />
}
