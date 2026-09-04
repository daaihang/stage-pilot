// Title: Event Calendar
// Description: Headless-first event calendar with month, week, day, N-day and agenda views, external CRUD contract, and a subscribable store.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { mergeEventCalendarI18n } from "@/components/reui/event-calendar/event-calendar-i18n";
import {
  buildEventIndex,
  defaultEventOrder,
  eventsOverlap,
  getDayKey,
  getRangeKey,
  getViewDateRange,
  stepDate,
  toZoned,
  zonedStartOfDay,
} from "@/components/reui/event-calendar/event-calendar-lib";
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { addDays } from "date-fns";

import { cn } from "@/lib/utils"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

const BASE_VIEWS = ["month", "week", "day", "days", "agenda"]
const ALL_VIEWS = [...BASE_VIEWS, "resource"]

const DEFAULT_INTERACTIONS = {
  drag: true,
  resize: true,
  selectSlot: true,
}

const EMPTY_SELECTION = { eventKeys: [], slot: null }

// resolveSettings runs on every render, so a freshly allocated default would
// bust the view memos keyed on it (the month grid rebuilds its 42 zoned day
// starts whenever weekendDays changes identity). Shared, never mutated.
const DEFAULT_WEEKEND_DAYS = [0, 6]
const EMPTY_RESOURCES = []
const DEFAULT_EVENT_PRIORITY = (event) =>
  event.priority ?? 0

// Priority-aware default order, cached on the resolver identity: eventOrder is
// part of the index cache key, so a fresh closure per render would rebuild the
// whole index on every render.
const priorityOrderCache = new WeakMap()
function priorityEventOrder(getEventPriority) {
  const cached = priorityOrderCache.get(getEventPriority)
  if (cached) return cached;
  // higher priority packs and orders first; ties fall through to the
  // start/duration/key default
  const order = (a, b) =>
    getEventPriority(b.event) - getEventPriority(a.event) ||
    defaultEventOrder(a, b)
  priorityOrderCache.set(getEventPriority, order)
  return order
}

function resolveSettings(options) {
  const {
    // strip state pairs; the rest flows into settings
    events: _e,
    defaultEvents: _de,
    view: _v,
    defaultView: _dv,
    date: _d,
    defaultDate: _dd,
    dayCount: _dc,
    defaultDayCount: _ddc,
    selection: _s,
    defaultSelection: _ds,
    interactions: _i,
    defaultInteractions: _di,
    viewSettings: _vs,
    defaultViewSettings: _dvs,
    loading: _l,
    ...rest
  } = options
  const getEventPriority =
    options.getEventPriority ??
    (DEFAULT_EVENT_PRIORITY)
  return {
    ...rest,
    timeZone:
      options.timeZone ?? DEFAULT_TIMEZONE,
    locale: options.locale,
    // locale-first default: a de/fr locale gets Monday weeks without also
    // having to set weekStartsOn; an explicit weekStartsOn always wins
    weekStartsOn:
      options.weekStartsOn ?? options.locale?.options?.weekStartsOn ?? 0,
    // the resource view only makes sense with resources configured
    views:
      options.views ?? (options.resources?.length ? ALL_VIEWS : BASE_VIEWS),
    dayStartHour: options.dayStartHour ?? 0,
    dayEndHour: options.dayEndHour ?? 24,
    slotDuration: options.slotDuration ?? 30,
    snapDuration: options.snapDuration ?? 15,
    agendaDayCount: options.agendaDayCount ?? 30,
    fixedWeeks: options.fixedWeeks ?? true,
    showOutsideDays: options.showOutsideDays ?? true,
    i18n: mergeEventCalendarI18n(options.i18n),
    resources: options.resources ?? EMPTY_RESOURCES,
    getEventPriority,
    eventOrder: options.eventOrder ?? priorityEventOrder(getEventPriority),
    getOccurrences: options.getOccurrences,
    weekendDays: options.weekendDays ?? DEFAULT_WEEKEND_DAYS,
    activation: options.activation,
  }
}

const warned = new Set()
function warnOnce(key, message) {
  if (process.env.NODE_ENV !== "production" && !warned.has(key)) {
    warned.add(key)
    console.warn(`[event-calendar] ${message}`)
  }
}

function createEventCalendarStore(initial) {
  let options = initial
  let settings = resolveSettings(initial)
  let settingsVersion = 0

  const listeners = new Set()

  const resolveView = view => {
    if (settings.views.includes(view)) return view
    const fallback = settings.views[0] ?? "month"
    warnOnce(
      `view-${view}`,
      `view "${view}" is not in views [${settings.views.join(", ")}]; falling back to "${fallback}".`
    )
    return fallback
  }

  const internal = {
    view: resolveView(initial.defaultView ?? "month"),
    date: initial.defaultDate ?? new Date(),
    dayCount: initial.defaultDayCount ?? 3,
    events: initial.defaultEvents ?? [],
    selection: initial.defaultSelection ?? EMPTY_SELECTION,
    interactions: { ...DEFAULT_INTERACTIONS, ...initial.defaultInteractions },
    viewSettings: initial.defaultViewSettings ?? {},
    drag: null,
    slotDraft: null,
  }

  let snapshot = null
  let indexCache = null
  // Second single-entry cache, for api.getOccurrences(range) outside the
  // visible range: that branch builds a throwaway index, so without it every
  // call hands back brand new occurrence OBJECTS and the identity-based
  // isEqual in useEventCalendarOccurrences can never settle - an unstable
  // getSnapshot is a hard render loop under useSyncExternalStore, not a slow
  // render.
  let rangeCache = null
  let scrollHandler = null
  // The rendered calendar root element, registered by the <EventCalendar> host.
  // The drag engine falls back to it to find day cells when a gesture starts
  // from a portaled surface (e.g. a chip inside the "+N more" popover), whose
  // DOM ancestors do not include the calendar.
  let rootEl = null
  let lastEmittedRangeKey = null

  // Controlled interactions merge, cached on input identity: rebuilding the
  // merged object per snapshot would break Object.is for selector hooks.
  let interactionsCache = null
  const mergedInteractions = input => {
    if (interactionsCache?.input !== input) {
      interactionsCache = {
        input,
        merged: { ...DEFAULT_INTERACTIONS, ...input },
      }
    }
    return interactionsCache.merged
  }

  const invalidate = () => {
    snapshot = null
  }

  const notify = () => {
    listeners.forEach((listener) => listener())
    emitRangeIfChanged()
  }

  const getState = () => {
    if (snapshot) return snapshot
    const view = resolveView(options.view ?? internal.view)
    const date = options.date ?? internal.date
    const dayCount = Math.max(1, options.dayCount ?? internal.dayCount)
    const { visibleRange, activeRange } = getViewDateRange(view, date, {
      timeZone: settings.timeZone,
      weekStartsOn: settings.weekStartsOn,
      dayCount,
      agendaDayCount: settings.agendaDayCount,
      fixedWeeks: settings.fixedWeeks,
    })
    snapshot = {
      view,
      date,
      dayCount,
      visibleRange,
      activeRange,
      events: options.events ?? internal.events,
      selection: options.selection ?? internal.selection,
      interactions: options.interactions
        ? mergedInteractions(options.interactions)
        : internal.interactions,
      loading: options.loading ?? false,
      drag: internal.drag,
      slotDraft: internal.slotDraft,
      viewSettings: options.viewSettings ?? internal.viewSettings,
    }
    return snapshot
  }

  const emitRangeIfChanged = () => {
    if (!settings.onRangeChange) return
    const state = getState()
    const key = `${state.view}:${getRangeKey(state.visibleRange)}:${settings.timeZone}`
    if (key === lastEmittedRangeKey) return
    lastEmittedRangeKey = key
    settings.onRangeChange({
      range: state.visibleRange,
      activeRange: state.activeRange,
      view: state.view,
      date: state.date,
      timeZone: settings.timeZone,
    })
  }

  const setField = (key, value) => {
    const controlled = options[key] !== undefined
    if (!controlled) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(internal)[key] = value
      invalidate()
    }
    const callbacks = {
      view: settings.onViewChange,
      date: settings.onDateChange,
      dayCount: settings.onDayCountChange,
      events: settings.onEventsChange,
      selection: settings.onSelectionChange,
      interactions: settings.onInteractionsChange,
      viewSettings: settings.onViewSettingsChange,
    }
    callbacks[key]?.(value)
    if (!controlled) notify()
  }

  // An occurrence key encodes the start instant (id::startISO), so committing a
  // move re-keys the occurrence and a selection holding the old key would point
  // at nothing. Remapped in the same commit and emitted BEFORE the events write
  // so a controlled consumer applies the two in a consistent order.
  const remapSelectionKey = (
    id,
    oldKey,
    nextStart
  ) => {
    const newKey = `${id}::${nextStart.toISOString()}`
    if (newKey === oldKey) return
    const selection = getState().selection
    if (!selection.eventKeys.includes(oldKey)) return
    setField("selection", {
      ...selection,
      eventKeys: selection.eventKeys.map((key) =>
        key === oldKey ? newKey : key
      ),
    })
  }

  // extraPatch: non-timing fields committed in the SAME write. Two sequential
  // setField("events") calls break controlled mode - the second one re-reads
  // the still-stale controlled array and its onEventsChange payload silently
  // reverts the timing change the first one emitted.
  const applyProposedUpdate = (update, extraPatch) => {
    const result = settings.onEventUpdate?.(update)
    if (result === false) return false
    const adjusted =
      result && typeof result === "object"
        ? {
            start: result.start ?? update.start,
            end: result.end ?? update.end,
            allDay: result.allDay ?? update.allDay,
          }
        : { start: update.start, end: update.end, allDay: update.allDay }
    if (update.resourceId !== undefined) adjusted.resourceId = update.resourceId
    // the STORED event holds the pre-commit start, which is what the live
    // occurrence key was built from (update.event already carries the proposal
    // when the call comes from api.updateEvent)
    const stored = getState().events.find(
      (event) => event.id === update.event.id
    )
    const oldKey =
      update.occurrence?.key ??
      (stored ? `${stored.id}::${stored.start.toISOString()}` : null)
    if (oldKey) {
      remapSelectionKey(update.event.id, oldKey, adjusted.start ?? update.start)
    }
    const events = getState().events
    const next = events.map((event) =>
      event.id === update.event.id
        ? { ...event, ...extraPatch, ...adjusted }
        : event
    )
    setField("events", next)
    return true
  }

  const getIndex = () => {
    const state = getState()
    const rangeKey = getRangeKey(state.visibleRange)
    if (
      indexCache &&
      indexCache.events === state.events &&
      indexCache.rangeKey === rangeKey &&
      indexCache.timeZone === settings.timeZone &&
      indexCache.weekStartsOn === settings.weekStartsOn &&
      indexCache.eventOrder === settings.eventOrder &&
      indexCache.getOccurrences === settings.getOccurrences
    ) {
      return indexCache.index
    }
    const index = buildEventIndex(state.events, state.visibleRange, {
      timeZone: settings.timeZone,
      weekStartsOn: settings.weekStartsOn,
      eventOrder: settings.eventOrder,
      getOccurrences: settings.getOccurrences,
    })
    indexCache = {
      events: state.events,
      rangeKey,
      timeZone: settings.timeZone,
      weekStartsOn: settings.weekStartsOn,
      eventOrder: settings.eventOrder,
      getOccurrences: settings.getOccurrences,
      index,
    }
    return index
  }

  const api = {
    next() {
      const state = getState()
      setField(
        "date",
        stepDate(state.view, state.date, 1, {
          timeZone: settings.timeZone,
          dayCount: state.dayCount,
          agendaDayCount: settings.agendaDayCount,
        })
      )
    },
    prev() {
      const state = getState()
      setField(
        "date",
        stepDate(state.view, state.date, -1, {
          timeZone: settings.timeZone,
          dayCount: state.dayCount,
          agendaDayCount: settings.agendaDayCount,
        })
      )
    },
    today() {
      setField("date", new Date())
    },
    goTo(date) {
      setField("date", date)
    },
    setView(view, opts) {
      if (opts?.dayCount !== undefined) {
        setField("dayCount", Math.max(1, opts.dayCount))
      }
      setField("view", resolveView(view))
    },
    setDayCount(count) {
      setField("dayCount", Math.max(1, count))
    },
    getEvents() {
      return getState().events
    },
    getEvent(id) {
      return getState().events.find((event) => event.id === id)
    },
    setEvents(events) {
      setField("events", events)
    },
    addEvent(event) {
      setField("events", [...getState().events, event])
    },
    updateEvent(id, patch) {
      const event = api.getEvent(id)
      if (!event) return
      const merged = { ...event, ...patch }
      const timingChanged =
        patch.start !== undefined ||
        patch.end !== undefined ||
        patch.allDay !== undefined
      if (timingChanged && settings.onEventUpdate) {
        // single write: the non-timing rest rides along as extraPatch so
        // controlled mode sees one consistent onEventsChange payload
        const rest = { ...patch }
        delete rest.start
        delete rest.end
        delete rest.allDay
        applyProposedUpdate(
          {
            event: merged,
            occurrence: null,
            start: merged.start,
            end: merged.end,
            allDay: merged.allDay ?? false,
            source: "api",
          },
          rest
        )
        return
      }
      if (timingChanged) {
        remapSelectionKey(
          id,
          `${id}::${event.start.toISOString()}`,
          merged.start
        )
      }
      setField(
        "events",
        getState().events.map((e) => (e.id === id ? merged : e))
      )
    },
    removeEvent(id) {
      setField(
        "events",
        getState().events.filter((event) => event.id !== id)
      )
    },
    getOccurrences(range) {
      if (!range) return getIndex().occurrences
      const state = getState()
      const within =
        range.start >= state.visibleRange.start &&
        range.end <= state.visibleRange.end
      if (within) {
        return getIndex().occurrences.filter((occ) => eventsOverlap(occ, range))
      }
      const rangeKey = getRangeKey(range)
      if (
        rangeCache &&
        rangeCache.events === state.events &&
        rangeCache.rangeKey === rangeKey &&
        rangeCache.timeZone === settings.timeZone &&
        rangeCache.weekStartsOn === settings.weekStartsOn &&
        rangeCache.eventOrder === settings.eventOrder &&
        rangeCache.getOccurrences === settings.getOccurrences
      ) {
        return rangeCache.occurrences
      }
      const { occurrences } = buildEventIndex(state.events, range, {
        timeZone: settings.timeZone,
        weekStartsOn: settings.weekStartsOn,
        eventOrder: settings.eventOrder,
        getOccurrences: settings.getOccurrences,
      })
      rangeCache = {
        events: state.events,
        rangeKey,
        timeZone: settings.timeZone,
        weekStartsOn: settings.weekStartsOn,
        eventOrder: settings.eventOrder,
        getOccurrences: settings.getOccurrences,
        occurrences,
      }
      return occurrences
    },
    getOccurrencesForDay(day) {
      const bucket = getIndex().byDay.get(getDayKey(day, settings.timeZone))
      if (!bucket) return []
      const seen = new Set()
      const result = []
      for (const seg of [...bucket.allDay, ...bucket.timed]) {
        if (seen.has(seg.occurrence.key)) continue
        seen.add(seg.occurrence.key)
        result.push(seg.occurrence)
      }
      return result
    },
    findOverlapping({ start, end, excludeEventId }) {
      return api
        .getOccurrences({ start, end })
        .filter((occ) => occ.eventId !== excludeEventId)
    },
    select(partial) {
      const current = getState().selection
      setField("selection", {
        eventKeys: partial.eventKeys ?? current.eventKeys,
        slot: partial.slot !== undefined ? partial.slot : current.slot,
      })
    },
    selectEvent(key, opts) {
      const current = getState().selection
      const eventKeys = opts?.additive
        ? current.eventKeys.includes(key)
          ? current.eventKeys.filter((k) => k !== key)
          : [...current.eventKeys, key]
        : [key]
      setField("selection", { ...current, eventKeys })
    },
    clearSelection() {
      setField("selection", EMPTY_SELECTION)
    },
    setInteractions(patch) {
      setField("interactions", { ...getState().interactions, ...patch })
    },
    setViewSettings(patch) {
      setField("viewSettings", { ...getState().viewSettings, ...patch })
    },
    getVisibleRange() {
      return getState().visibleRange
    },
    getActiveRange() {
      return getState().activeRange
    },
    toZoned(date) {
      return toZoned(date, settings.timeZone)
    },
    scrollToTime(time) {
      scrollHandler?.(time)
    },
  }

  const internals = {
    getIndex,
    setDrag(drag) {
      internal.drag = drag
      invalidate()
      notify()
    },
    setSlotDraft(draft) {
      internal.slotDraft = draft
      invalidate()
      notify()
    },
    registerScrollHandler(handler) {
      scrollHandler = handler
    },
    applyProposedUpdate,
    getSettingsVersion() {
      return settingsVersion
    },
    getRootEl() {
      return rootEl
    },
    setRootEl(el) {
      rootEl = el
    },
  }

  const instance = {
    getState,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    api,
    get settings() {
      return settings
    },
    internals,
  }

  const STATE_KEYS = [
    "events",
    "view",
    "date",
    "dayCount",
    "selection",
    "interactions",
    "viewSettings",
    "loading"
  ]
  const SETTINGS_KEYS = [
    "timeZone",
    "locale",
    "weekStartsOn",
    "views",
    "dayStartHour",
    "dayEndHour",
    "slotDuration",
    "snapDuration",
    "agendaDayCount",
    "fixedWeeks",
    "showOutsideDays",
    "i18n",
    "resources",
    "getEventPriority",
    "eventOrder",
    "getOccurrences",
    "weekendDays",
    "activation"
  ]

  return {
    instance,
    setOptions(next) {
      const prev = options
      options = next
      let changed = false
      for (const key of STATE_KEYS) {
        if (prev[key] !== next[key]) {
          changed = true
          break
        }
      }
      let settingsChanged = false
      for (const key of SETTINGS_KEYS) {
        if (prev[key] !== next[key]) {
          settingsChanged = true
          break
        }
      }
      settings = resolveSettings(next)
      if (settingsChanged) {
        settingsVersion++
        changed = true
      }
      if (changed) invalidate()
      return changed
    },
    notify,
    emitRangeIfChanged,
  }
}

/**
 * Headless root hook - the full calendar engine without any markup.
 * Pass the returned instance to <EventCalendar calendar={instance}> or drive
 * fully custom UI from instance.getState()/subscribe/api.
 */
function useEventCalendarState(options = {}) {
  const [store] = useState(() => createEventCalendarStore(options))
  const changed = store.setOptions(options)
  const changedRef = useRef(false)
  if (changed) changedRef.current = true
  useLayoutEffect(() => {
    if (changedRef.current) {
      changedRef.current = false
      store.notify()
    }
  })
  useEffect(() => {
    store.emitRangeIfChanged()
    // mount-only: onRangeChange fires once for the initial range
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return store.instance
}

const EventCalendarContext =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createContext(null)

/** The stable calendar instance; throws outside <EventCalendar>. */
function useEventCalendar() {
  const instance = useContext(EventCalendarContext)
  if (!instance) {
    throw new Error("useEventCalendar must be used within <EventCalendar>")
  }
  return instance;
}

/** Fine-grained subscription with equality memoization (Object.is default). */
function useEventCalendarSelector(selector, options) {
  const contextInstance = useContext(EventCalendarContext)
  const instance = options?.calendar ?? contextInstance
  if (!instance) {
    throw new Error(
      "useEventCalendarSelector needs an <EventCalendar> ancestor or an explicit `calendar` option"
    )
  }
  const isEqual = options?.isEqual ?? Object.is
  const lastRef = useRef(null)
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const getSnapshot = () => {
    const next = selectorRef.current(
      instance.getState()
    )
    if (lastRef.current && isEqual(lastRef.current.value, next)) {
      return lastRef.current.value
    }
    lastRef.current = { value: next }
    return next
  }

  return useSyncExternalStore(instance.subscribe, getSnapshot, getSnapshot)
}

function useEventCalendarView() {
  const instance = useEventCalendar()
  const view = useEventCalendarSelector((state) => state.view)
  const dayCount = useEventCalendarSelector((state) => state.dayCount)
  useEventCalendarSettingsVersion(instance)
  return {
    view,
    dayCount,
    availableViews: instance.settings.views,
    setView: instance.api.setView,
  }
}

/**
 * isToday is a wall-clock read, so no store write ever invalidates it and a
 * calendar left open overnight keeps highlighting yesterday. One timer per
 * display zone, armed for the next zoned midnight and re-armed on fire, wakes
 * every day-scoped hook exactly when the answer changes; an interval would
 * tick thousands of times a day to catch one transition.
 */
const midnightTicker = (() => {
  const zones = new Map()
  let version = 0

  const arm = (timeZone) => {
    const entry = zones.get(timeZone)
    if (!entry) return
    const now = new Date()
    const next = zonedStartOfDay(
      addDays(toZoned(now, timeZone), 1),
      timeZone
    ).getTime()
    entry.timer = setTimeout(
      () => {
        version++
        entry.listeners.forEach((listener) => listener())
        arm(timeZone)
      },
      Math.max(1000, next - now.getTime())
    )
  }

  return {
    subscribe(timeZone, listener) {
      let entry = zones.get(timeZone)
      if (!entry) {
        entry = { listeners: new Set(), timer: null }
        zones.set(timeZone, entry)
        entry.listeners.add(listener)
        arm(timeZone)
      } else {
        entry.listeners.add(listener)
      }
      const current = entry
      return () => {
        current.listeners.delete(listener)
        if (current.listeners.size > 0) return
        if (current.timer) clearTimeout(current.timer)
        zones.delete(timeZone)
      }
    },
    getVersion: () => version,
  };
})()

/** Re-renders the caller on the next midnight in `timeZone`. */
function useMidnightTick(timeZone) {
  const subscribe = useCallback(
    (listener) => midnightTicker.subscribe(timeZone, listener),
    [timeZone]
  )
  return useSyncExternalStore(
    subscribe,
    midnightTicker.getVersion,
    midnightTicker.getVersion
  )
}

function useEventCalendarNavigation() {
  const instance = useEventCalendar()
  const { settings } = instance
  const slice = useEventCalendarSelector(
    (state) => ({
      date: state.date,
      view: state.view,
      visibleRange: state.visibleRange,
      activeRange: state.activeRange,
    }),
    {
      isEqual: (a, b) =>
        a.date.getTime() === b.date.getTime() &&
        a.view === b.view &&
        getRangeKey(a.visibleRange) === getRangeKey(b.visibleRange),
    }
  )
  useEventCalendarSettingsVersion(instance)
  useMidnightTick(settings.timeZone)
  const now = new Date()
  return {
    date: slice.date,
    title: settings.i18n.functions.formatTitle(slice.view, {
      date: toZoned(slice.date, settings.timeZone),
      activeRange: slice.activeRange,
      visibleRange: slice.visibleRange,
      locale: settings.locale,
    }),
    visibleRange: slice.visibleRange,
    activeRange: slice.activeRange,
    next: instance.api.next,
    prev: instance.api.prev,
    today: instance.api.today,
    goTo: instance.api.goTo,
    isToday: now >= slice.activeRange.start && now < slice.activeRange.end,
  }
}

function useEventCalendarSelection() {
  const instance = useEventCalendar()
  const selection = useEventCalendarSelector((state) => state.selection)
  return {
    selection,
    select: instance.api.select,
    selectEvent: instance.api.selectEvent,
    clearSelection: instance.api.clearSelection,
  }
}

function useEventCalendarInteractions() {
  const instance = useEventCalendar()
  const interactions = useEventCalendarSelector((state) => state.interactions)
  return { interactions, setInteractions: instance.api.setInteractions }
}

/** Expanded, sorted occurrences; defaults to the visible range. */
function useEventCalendarOccurrences(range) {
  const instance = useEventCalendar()
  return useEventCalendarSelector(() => instance.api.getOccurrences(range), {
    calendar: instance,
    // element identity, not keys: keys encode id+start only, so an end-only
    // resize or a title/color/data edit would never invalidate a key-based
    // memo. The index rebuilds occurrence objects precisely when events
    // change, so identity is the correct (and cheapest) change signal.
    isEqual: (a, b) =>
      a === b || (a.length === b.length && a.every((occ, i) => occ === b[i])),
  });
}

const EMPTY_BUCKET = { allDay: [], timed: [] }

/** Per-cell subscription: only cells whose segments changed re-render. */
function useEventCalendarDay(day) {
  const instance = useEventCalendar()
  const { timeZone } = instance.settings
  const dayKey = getDayKey(day, timeZone)

  const bucket = useEventCalendarSelector(() =>
    instance.internals.getIndex().byDay.get(dayKey) ??
    (EMPTY_BUCKET), {
    calendar: instance,
    // Element identity, not a content key: an occurrence key encodes
    // id+start only, so a title/color/data edit produced an identical key
    // and this cell kept serving its STALE segments. Buckets come straight
    // out of the memoized index, which rebuilds precisely when events
    // change, so identity is both correct and the cheapest signal.
    isEqual: (a, b) =>
      a === b ||
      (a.allDay.length === b.allDay.length &&
        a.timed.length === b.timed.length &&
        a.allDay.every((segment, i) => segment === b.allDay[i]) &&
        a.timed.every((segment, i) => segment === b.timed[i])),
  })
  const activeRange = useEventCalendarSelector((state) => state.activeRange, {
    calendar: instance,
    isEqual: (a, b) => getRangeKey(a) === getRangeKey(b),
  })
  useMidnightTick(timeZone)
  const dayStart = zonedStartOfDay(day, timeZone)
  return {
    segments: bucket,
    isToday: getDayKey(new Date(), timeZone) === dayKey,
    isOutside: dayStart < activeRange.start || dayStart >= activeRange.end,
  }
}

const EMPTY_BARS = []

/**
 * Per-week-row subscription for the month view: the laned multi-day/all-day
 * bar segments (one per occurrence per row, colStart/colSpan/lane set) that
 * render as continuous cross-day bars. `laneCount` is the row's bar height.
 * Matched by CONTAINMENT - any day inside the row resolves it - so a
 * weekends-hidden month (first visible day Monday) still finds its row;
 * `rowStart` returns the row's TRUE start for colStart/colSpan day math.
 */
function useEventCalendarWeek(day) {
  const instance = useEventCalendar()
  const { timeZone } = instance.settings
  const dayStartMs = zonedStartOfDay(day, timeZone).getTime()

  const row = useEventCalendarSelector(() => {
    const index = instance.internals.getIndex()
    const match = index.weekRows.find((r) => {
      const startMs = zonedStartOfDay(r.rowStart, timeZone).getTime()
      // calendar-aware row end: a fixed 168h window would let the first
      // day AFTER a spring-forward week (167h long) match the wrong row
      const endMs = zonedStartOfDay(
        addDays(toZoned(r.rowStart, timeZone), 7),
        timeZone
      ).getTime()
      return dayStartMs >= startMs && dayStartMs < endMs
    })
    return {
      bars: match?.bars ?? (EMPTY_BARS),
      rowStart: match?.rowStart ?? null,
    };
  }, {
    calendar: instance,
    // Same reasoning as the day bucket above: `bars` is the array held by
    // the memoized index, so element identity catches content edits that a
    // key built from id+start could never see.
    isEqual: (a, b) =>
      (a.rowStart?.getTime() ?? 0) === (b.rowStart?.getTime() ?? 0) &&
      (a.bars === b.bars ||
        (a.bars.length === b.bars.length &&
          a.bars.every((segment, i) => segment === b.bars[i]))),
  })
  const laneCount = row.bars.reduce((m, s) => Math.max(m, (s.lane ?? 0) + 1), 0)
  return { bars: row.bars, laneCount, rowStart: row.rowStart }
}

/**
 * User view settings (weekends, week numbers, now line, off days, schedule
 * hint) + the effective values after falling back to the root view-config
 * props. Drives the nav submenu; fully controllable from outside via
 * `viewSettings`/`onViewSettingsChange` or api.setViewSettings.
 */
function useEventCalendarViewSettings() {
  const instance = useEventCalendar()
  const viewConfig = useEventCalendarViewConfig()
  const viewSettings = useEventCalendarSelector((state) => state.viewSettings)
  return {
    viewSettings,
    setViewSettings: instance.api.setViewSettings,
    effective: {
      weekends: viewSettings.weekends ?? true,
      weekNumbers: viewSettings.weekNumbers ?? viewConfig.showWeekNumbers,
      nowIndicator: viewSettings.nowIndicator ?? viewConfig.nowIndicator,
      offDays:
        viewSettings.offDays ??
        (viewConfig.offDays !== undefined && viewConfig.offDays !== false),
    },
  }
}

/** Subscribes to settings changes only (version counter, not state). */
function useEventCalendarSettingsVersion(instance) {
  return useSyncExternalStore(
    instance.subscribe,
    instance.internals.getSettingsVersion,
    instance.internals.getSettingsVersion
  )
}

/** Resolved settings incl. merged i18n; re-renders only when settings change. */
function useEventCalendarSettings() {
  const instance = useEventCalendar()
  useEventCalendarSettingsVersion(instance)
  return instance.settings
}

const EventCalendarViewContext = createContext(null);

const DEFAULT_VIEW_CONFIG = {
  scrollToHour: 7,
  nowIndicator: true,
  interval: 60,
  maxEventsPerCell: "auto",
  showWeekNumbers: false,
  enableShortcuts: true,
  shortcutsScope: "focus-within",
  scrollMode: "contained",
  stickyNav: false,
  showDayAddButton: false,
  scrollbars: "custom",
  navButtonVariant: "ghost",
  navButtonSize: "sm",
  dayCountPresets: [5],
  eventTooltip: false,
  compactEventMinutes: 45,
  morePopoverAlign: "start",
  nowIndicatorInterval: 30_000,
  agendaSummaryMaxDots: 6,
}

const EventCalendarViewConfigContext = createContext(DEFAULT_VIEW_CONFIG)

/** Root-level display props + render overrides, for view components. */
function useEventCalendarViewConfig() {
  return useContext(EventCalendarViewConfigContext)
}

const VIEW_CONFIG_KEYS = [
  "scrollToHour",
  "nowIndicator",
  "interval",
  "maxEventsPerCell",
  "showWeekNumbers",
  "enableShortcuts",
  "shortcutsScope",
  "scrollMode",
  "stickyNav",
  "dayClassName",
  "todayClassName",
  "showDayAddButton",
  "scrollbars",
  "navButtonVariant",
  "navButtonSize",
  "offDays",
  "classNames",
  "components",
  "renderEvent",
  "renderAgendaEvent",
  "renderEventTooltip",
  "renderDragPreview",
  "renderMonthCell",
  "renderDayColumnBackground",
  "renderDayHeader",
  "renderTimeGutterSlot",
  "renderAllDaySection",
  "renderMoreIndicator",
  "renderMoreContent",
  "renderNowIndicator",
  "renderNoEvents",
  "renderAgendaEventDetails",
  "renderResourceHeader",
  "renderAgendaDayHeader",
  "renderAgendaDaySummary",
  "dayCountPresets",
  "navTooltips",
  "eventTooltip",
  "compactEventMinutes",
  "morePopoverAlign",
  "nowIndicatorInterval",
  "agendaSummaryMaxDots",
]

/** The rendering view of the nearest view component ("month", "week", ...). */
function useEventCalendarViewContext() {
  const ctx = useContext(EventCalendarViewContext)
  if (!ctx) {
    throw new Error(
      "useEventCalendarViewContext must be used inside a calendar view"
    )
  }
  return ctx
}

const OPTION_KEYS = [
  "events",
  "defaultEvents",
  "view",
  "defaultView",
  "date",
  "defaultDate",
  "dayCount",
  "defaultDayCount",
  "selection",
  "defaultSelection",
  "interactions",
  "defaultInteractions",
  "viewSettings",
  "defaultViewSettings",
  "loading",
  "views",
  "timeZone",
  "locale",
  "weekStartsOn",
  "dayStartHour",
  "dayEndHour",
  "slotDuration",
  "snapDuration",
  "agendaDayCount",
  "fixedWeeks",
  "showOutsideDays",
  "i18n",
  "resources",
  "getEventPriority",
  "eventOrder",
  "getOccurrences",
  "weekendDays",
  "activation",
  "onEventClick",
  "onEventDoubleClick",
  "onEventUpdate",
  "canDropEvent",
  "onDragBlocked",
  "onSlotClick",
  "onSelectSlot",
  "canSelectSlot",
  "onRangeChange",
  "onViewChange",
  "onDateChange",
  "onDayCountChange",
  "onSelectionChange",
  "onInteractionsChange",
  "onViewSettingsChange",
  "onEventsChange",
  "onMoreClick",
]

function splitOptions(props) {
  const options = {}
  const viewConfig = { ...DEFAULT_VIEW_CONFIG }
  const rest = {}
  for (const [key, value] of Object.entries(props)) {
    if ((OPTION_KEYS).includes(key)) options[key] = value
    else if ((VIEW_CONFIG_KEYS).includes(key)) {
      if (value !== undefined) viewConfig[key] = value
    } else rest[key] = value
  }
  return {
    options: options,
    viewConfig: viewConfig,
    rest,
  };
}

/**
 * Root provider + container. Composition contract:
 * <EventCalendar><EventCalendarNav/><EventCalendarToolbar/><EventCalendarContent/></EventCalendar>
 */
function EventCalendar(
  {
    calendar,
    apiRef,
    className,
    render,
    children,
    ...props
  }
) {
  const { options, viewConfig, rest } = splitOptions(props)

  if (calendar && Object.keys(options).length > 0) {
    warnOnce(
      "calendar-and-options",
      "both `calendar` and option props were passed; option props are ignored when adopting an instance."
    )
  }

  const own = useEventCalendarState(calendar ? {} : options)
  const instance = calendar ?? own

  useEffect(() => {
    if (apiRef) apiRef.current = instance.api
  }, [apiRef, instance])

  // Register the root element so the drag engine can find day cells even when a
  // gesture starts from a portaled surface (the "+N more" popover).
  const registerRoot = useCallback(
    (el) => instance.internals.setRootEl(el),
    [instance]
  )

  const defaultProps = {
    "data-slot": "event-calendar",
    ref: registerRoot,
    // text-xs is the calendar-wide default type size; because it sits before
    // `className`, a consumer can override the whole scale with e.g.
    // <EventCalendar className="text-sm"> and every inheriting element follows.
    // Inner elements omit their own text-size so they cascade from here (the
    // few portaled surfaces - "+N more" popover, drag carry clone - pin the
    // size explicitly since DOM inheritance does not cross a portal).
    className: cn("flex min-h-0 min-w-0 flex-col text-xs", className),
    children: (
      <>
        {children}
        <div
          data-slot="event-calendar-announcer"
          aria-live="polite"
          className="sr-only"
        />
      </>
    ),
  }

  return (
    <EventCalendarContext.Provider value={instance}>
      <EventCalendarViewConfigContext.Provider value={viewConfig}>
        {useRender({
          defaultTagName: "div",
          render,
          props: mergeProps(defaultProps, rest),
        })}
      </EventCalendarViewConfigContext.Provider>
    </EventCalendarContext.Provider>
  );
}

export {
  ALL_VIEWS,
  BASE_VIEWS,
  DEFAULT_VIEW_CONFIG,
  EventCalendar,
  EventCalendarContext,
  EventCalendarViewConfigContext,
  EventCalendarViewContext,
  useEventCalendar,
  useEventCalendarDay,
  useEventCalendarWeek,
  useEventCalendarInteractions,
  useEventCalendarNavigation,
  useEventCalendarOccurrences,
  useEventCalendarSelection,
  useEventCalendarSelector,
  useEventCalendarSettings,
  useEventCalendarSettingsVersion,
  useEventCalendarState,
  useEventCalendarView,
  useEventCalendarViewConfig,
  useEventCalendarViewContext,
  useEventCalendarViewSettings,
}
