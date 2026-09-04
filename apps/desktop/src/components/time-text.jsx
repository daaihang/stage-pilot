import { formatInstantInTimeZone, normalizeTimeZone, timeZoneOffsetLabel } from "@/lib/timezone"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

export function TimeText({ instant, timezone, className, withTimezone = false, ...options }) {
  if (!instant) return null
  const zone = normalizeTimeZone(timezone)
  return <span className={className}>{formatInstantInTimeZone(instant, zone, options)}{withTimezone ? ` · ${zone}` : ""}</span>
}

export function TimeDetailsPopover({ instant, timezone, userTimezone, children }) {
  if (!instant) return null
  const zone = normalizeTimeZone(timezone)
  const viewerZone = normalizeTimeZone(userTimezone || zone)
  return <Popover><PopoverTrigger render={<Button type="button" variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent">{children || <TimeText instant={instant} timezone={zone} />}</Button>} /><PopoverContent align="start" className="w-72 space-y-2 text-sm"><p className="font-medium">时间详情</p><div className="space-y-1 text-muted-foreground"><p>业务时区：{formatInstantInTimeZone(instant, zone)} · {zone} ({timeZoneOffsetLabel(instant, zone)})</p><p>当前时区：{formatInstantInTimeZone(instant, viewerZone)} · {viewerZone} ({timeZoneOffsetLabel(instant, viewerZone)})</p><p>UTC：{formatInstantInTimeZone(instant, "UTC")} · UTC</p></div></PopoverContent></Popover>
}
