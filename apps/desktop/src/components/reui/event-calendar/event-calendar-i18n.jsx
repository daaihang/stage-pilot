import { format, isSameMonth, isSameYear, subMilliseconds } from "date-fns";

const DEFAULT_LABELS = {
  today: "Today",
  previous: "Previous",
  next: "Next",
  addEvent: "Add event",
  allDay: "All day",
  more: (count) => `+${count} more`,
  noEvents: "No events",
  loading: "Loading events",
  event: "event",
  events: (count) => (count === 1 ? "1 event" : `${count} events`),
  selectView: "Select view",
  week: (weekNumber) => `W${weekNumber}`,
  resources: "Resources",
  goToDate: "Go to date",
  dropNotAllowed: "Can't place here",
  continues: "continues",
  timeFrom: (time) => `From ${time}`,
  timeUntil: (time) => `Until ${time}`,
  viewShortcuts: {
    month: "M",
    week: "W",
    day: "D",
    days: "5",
    agenda: "A",
    resource: "G",
  },
  toggleDayEvents: (count) => (count === 1 ? "1 event" : `${count} events`),
  eventDetails: (title) => title,
  moreCompact: (count) => `+${count}`,
  timeRange: (from, to) => `${from} - ${to}`,
}

const DEFAULT_VIEW_NAMES = {
  month: "Month",
  week: "Week",
  day: "Day",
  days: (count) => (count === 1 ? "1 day" : `${count} days`),
  agenda: "Agenda",
  resource: "Time Grid",
}

const DEFAULT_FORMATS = {
  monthTitle: "MMMM yyyy",
  weekTitle: undefined,
  dayTitle: "EEEE, MMMM d, yyyy",
  agendaTitle: undefined,
  monthDayHeader: "EEE",
  monthDayHeaderNarrow: "EEEEE",
  timeGridDayHeader: "EEE d",
  agendaDayHeader: "EEEE, MMMM d",
  agendaDayNumber: "d",
  agendaWeekday: "EEE",
  moreDayHeader: "EEEE, MMMM d",
  monthCellAriaLabel: "PPPP",
  dayAria: "PPPP",
  resourceTitle: undefined,
  timeGutter: "h a",
  timeGutterMinute: "h:mm a",
  eventTime: "h:mm a",
  monthCellDay: "d",
}

/**
 * Default formatting functions BOUND to a config's labels/formats, so that
 * `formats` overrides flow into the default renderers (a consumer overriding
 * formats.monthTitle without replacing formatTitle still sees it applied).
 */
function makeDefaultFunctions(cfg) {
  return {
    formatTitle: (view, { date, activeRange, locale }) => {
      const opts = { locale }
      if (view === "month") {
        return format(date, cfg.formats.monthTitle, opts)
      }
      if (view === "resource") {
        return format(
          date,
          cfg.formats.resourceTitle ?? cfg.formats.dayTitle,
          opts
        )
      }
      if (view === "day") {
        return format(date, cfg.formats.dayTitle, opts)
      }
      if (view === "week" && cfg.formats.weekTitle) {
        return format(date, cfg.formats.weekTitle, opts)
      }
      if (view === "agenda" && cfg.formats.agendaTitle) {
        return format(date, cfg.formats.agendaTitle, opts)
      }
      // week / days / agenda: smart range label, last day is activeRange.end - 1ms.
      // subMilliseconds keeps the zoned date type (a plain new Date(ms)
      // would flip the label to the machine zone near midnight)
      const rangeEnd = subMilliseconds(activeRange.end, 1)
      const start = activeRange.start
      if (isSameMonth(start, rangeEnd)) {
        return `${format(start, "MMMM d", opts)} - ${format(rangeEnd, "d, yyyy", opts)}`
      }
      if (isSameYear(start, rangeEnd)) {
        return `${format(start, "MMM d", opts)} - ${format(rangeEnd, "MMM d, yyyy", opts)}`
      }
      return `${format(start, "MMM d, yyyy", opts)} - ${format(rangeEnd, "MMM d, yyyy", opts)}`
    },
    formatEventTime: (start, end, allDay, opts) => {
      if (allDay) return cfg.labels.allDay
      const fmt = cfg.formats.eventTime
      // Multi-day timed events carry the date on both sides. Compare calendar
      // days off the last rendered instant (end is exclusive, so a 14:00 to
      // midnight event still ends on the start day). Elapsed ms would miss an
      // exactly-24h event and a DST day that only runs 23 hours.
      const lastInstant =
        end.getTime() - 1 >= start.getTime() ? subMilliseconds(end, 1) : start
      if (format(start, "yyyy-MM-dd") !== format(lastInstant, "yyyy-MM-dd")) {
        return `${format(start, `MMM d, ${fmt}`, opts)} - ${format(end, `MMM d, ${fmt}`, opts)}`
      }
      return `${format(start, fmt, opts)} - ${format(end, fmt, opts)}`
    },
    formatDayRange: (range, opts) => {
      // subMilliseconds keeps the zoned date type, same reason as formatTitle
      const rangeEnd = subMilliseconds(range.end, 1)
      return `${format(range.start, "MMM d", opts)} - ${format(rangeEnd, "MMM d", opts)}`
    },
  }
}

const DEFAULT_EVENT_CALENDAR_I18N = {
  labels: DEFAULT_LABELS,
  viewNames: DEFAULT_VIEW_NAMES,
  formats: DEFAULT_FORMATS,
  functions: makeDefaultFunctions({
    labels: DEFAULT_LABELS,
    formats: DEFAULT_FORMATS,
  }),
}

/**
 * Shallow merge per nested object, matching the filters.tsx i18n contract:
 * a partial override replaces individual keys, never whole sections. Default
 * functions are re-bound to the MERGED labels/formats; explicit `functions`
 * overrides still win.
 */
function mergeEventCalendarI18n(overrides) {
  if (!overrides) return DEFAULT_EVENT_CALENDAR_I18N
  const labels = { ...DEFAULT_LABELS, ...overrides.labels }
  const viewNames = { ...DEFAULT_VIEW_NAMES, ...overrides.viewNames }
  const formats = { ...DEFAULT_FORMATS, ...overrides.formats }
  return {
    labels,
    viewNames,
    formats,
    functions: {
      ...makeDefaultFunctions({ labels, formats }),
      ...overrides.functions,
    },
  }
}

export { DEFAULT_EVENT_CALENDAR_I18N, mergeEventCalendarI18n }