import * as React from "react";

/* -------------------------------------------------------------------------- */
/*                             The mutation lock                              */
/* -------------------------------------------------------------------------- */

/** `disabled` and `readOnly` are NOT two words for one state. `disabled` is
 *  the native attribute: not operable, out of the tab order. `readOnly` blocks
 *  MUTATION and preserves NAVIGATION, because a read-only bar exists so a
 *  keyboard or screen reader user can walk the chips and find out what the
 *  view is filtered by. Collapsing the two once put the native attribute on
 *  all thirteen advanced-builder cell controls while the roving tab stop sat
 *  on a disabled element, so not one row could be reached from the keyboard.
 *
 *  So a mutating control keeps its tab stop and wears `aria-disabled` plus
 *  `data-readonly` (`filterReadOnlyProps`), this repo's convention for
 *  "present, focusable, not operable". `aria-readonly` is never used, being
 *  disallowed on the button, group and toolbar roles, so the BAR says it in
 *  prose through `labels.readOnly`. The refusal itself is enforced once, where
 *  all fourteen query writes pass through `emit` in `filters.tsx`. */
export function isFilterLocked(state) {
  return state.disabled || state.readOnly
}

/** What a MUTATING control wears while the bar is read only. `null` when the
 *  bar is disabled, because the native attribute already says it. A
 *  conditional spread, not explicit `undefined`s: `aria-disabled="false"` on
 *  an enabled control is noise, and `data-readonly` is a presence hook. */
export function filterReadOnlyProps(state) {
  if (state.disabled || !state.readOnly) return null
  return {
    "aria-disabled": true,
    "data-readonly": ""
  };
}

/** ONE ladder, keyed off `size`, for every control the chrome renders, because
 *  the alternative already happened: five advanced-builder cells took
 *  `actions.size` while seven sites hardcoded `icon-sm` and three `sm`, giving
 *  one row three heights. Nothing here is a pixel - each value is a shadcn
 *  size NAME that `Button` resolves per style, since the control-height ladder
 *  is per style (nova 7/8, sera 9/10, mira 6/7, and so on), and the glyph size
 *  rides the same name, so pinning an icon size in here would fight the style
 *  rather than match it. Two rungs only: `lg` would make the bar taller than
 *  the style's own default control height (want taller, pick a taller STYLE),
 *  and `icon-xs` is a 20-24px square in most styles, too small for a chip's
 *  own label to clear. */
const FILTER_CONTROL_SIZES = {
  sm: { button: "sm", icon: "icon-sm" },
  default: { button: "default", icon: "icon" },
}

/** The pair for a bar's size, off anything with a `size`, so a
 *  consumer-composed chrome uses the same ladder as the shipped one. The
 *  fallback is for JavaScript callers: a `"lg"` TypeScript would have rejected
 *  must still draw buttons rather than throw on `.button`. */
export function filterControlSizes(state) {
  return FILTER_CONTROL_SIZES[state.size] ?? FILTER_CONTROL_SIZES.default
}

const FilterActionsContext =
  React.createContext(null)

export function useFilterActions() {
  const context = React.useContext(FilterActionsContext)
  if (!context) {
    throw new Error("useFilterActions must be used inside <Filters>")
  }
  return context;
}

const FilterStateContext = React.createContext(null)

export function useFilterState() {
  const context = React.useContext(FilterStateContext)
  if (!context) {
    throw new Error("useFilterState must be used inside <Filters>")
  }
  return context;
}

const FilterRenderContext = React.createContext({})

export function useFilterRender() {
  return React.useContext(FilterRenderContext);
}

const NO_FOCUS = { id: null, segment: null, autoOpen: false }

export function createFilterFocusStore() {
  let snapshot = NO_FOCUS
  const listeners = new Set()

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange)
      return () => {
        listeners.delete(onStoreChange)
      }
    },
    // The SAME object until something actually changes, which is what
    // `useSyncExternalStore` requires to avoid an infinite render loop.
    getSnapshot() {
      return snapshot
    },
    set(next) {
      if (
        next.id === snapshot.id &&
        next.segment === snapshot.segment &&
        next.autoOpen === snapshot.autoOpen
      ) {
        return
      }
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

/** A shared, permanently empty store, so the hook degrades to "nothing
 *  focused" outside a `Filters`. Nothing ever writes to it: each root creates
 *  and writes its own. */
const FALLBACK_FOCUS_STORE = createFilterFocusStore()

const FilterFocusContext =
  React.createContext(FALLBACK_FOCUS_STORE)

/* -------------------------------------------------------------------------- */
/*                                 Reordering                                 */
/* -------------------------------------------------------------------------- */

/** Whether rows may be reordered at all, published once for the subtree. Two
 *  files have to agree about it: the builder gates the grip and Alt+Arrow,
 *  while the row and group menus commit the same mutator by a third route, so
 *  gating only the builder left it off for a pointer and on from a menu. */
const FilterReorderContext = React.createContext(false)

export const FilterReorderProvider = FilterReorderContext.Provider

export function useFilterReorderable() {
  return React.useContext(FilterReorderContext)
}

export function createFilterRowStateStore() {
  const touched = new Set()
  const pending = new Set()
  const listeners = new Set()
  let version = 0
  const notify = () => {
    version += 1
    for (const listener of listeners) listener()
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version: () => version,
    has: (id) => touched.has(id),
    mark: (id) => {
      if (touched.has(id)) return
      touched.add(id)
      notify()
    },
    unmark: (id) => {
      if (!touched.delete(id)) return
      notify()
    },
    isPending: (id) => pending.has(id),
    markPending: (id) => {
      if (pending.has(id)) return
      pending.add(id)
      notify()
    },
    resolvePending: (id) => {
      if (!pending.delete(id)) return
      notify()
    },
    reset: () => {
      if (touched.size === 0 && pending.size === 0) return
      touched.clear()
      pending.clear()
      notify()
    },
  }
}

const FALLBACK_ROW_STATE_STORE = createFilterRowStateStore()

const FilterRowStateContext = React.createContext(FALLBACK_ROW_STATE_STORE)

export const FilterRowStateProvider = FilterRowStateContext.Provider

/** The store itself, for handlers that write without subscribing. */
export function useFilterRowStateStore() {
  return React.useContext(FilterRowStateContext)
}

/** Whether THIS rule is still waiting for its attribute. */
export function useFilterRowPending(id) {
  const store = React.useContext(FilterRowStateContext)
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.isPending(id),
    () => false
  )
}

/** Whether THIS rule may show an error yet. */
export function useFilterTouched(id) {
  const store = React.useContext(FilterRowStateContext)
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.has(id),
    () => false
  )
}

/** The whole focus snapshot, so the caller re-renders on EVERY move anywhere
 *  in the row. A chip wants `useFilterChipFocused` or `useFilterSegmentFocus`
 *  below instead. */
export function useFilterFocus() {
  const store = React.useContext(FilterFocusContext)
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
}

/** The store itself, for event handlers that write without subscribing. */
export function useFilterFocusStore() {
  return React.useContext(FilterFocusContext)
}

/** The segment of THIS chip that should open itself, or null. */
export function useFilterChipAutoOpen(id) {
  const store = React.useContext(FilterFocusContext)
  return React.useSyncExternalStore(
    store.subscribe,
    () => {
      const snapshot = store.getSnapshot()
      return snapshot.autoOpen && snapshot.id === id ? snapshot.segment : null
    },
    () => null
  )
}

/** Whether the row holds no focus, so the first chip keeps the tab stop. */
export function useFilterFocusEmpty() {
  const store = React.useContext(FilterFocusContext)
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().id === null,
    () => true
  )
}

/** Whether THIS chip owns the row's tab stop. */
export function useFilterChipFocused(id) {
  const store = React.useContext(FilterFocusContext)
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().id === id,
    () => false
  )
}

/** Which segment of THIS rule owns the tab stop, or null when another rule
 *  does. A chip needs one boolean, but an advanced row is a grid ROW whose tab
 *  stop is a (row, column) pair, and the column has to come from this store
 *  too or the chromes disagree about where focus is after an edit. */
export function useFilterSegmentFocus(id) {
  const store = React.useContext(FilterFocusContext)
  return React.useSyncExternalStore(
    store.subscribe,
    () => {
      const snapshot = store.getSnapshot()
      return snapshot.id === id ? snapshot.segment : null
    },
    () => null
  )
}

export function createFilterResolutionStore() {
  const resolved = new Map()
  const claimed = new Map()
  const listeners = new Set()
  let version = 0

  const bucket = (fieldKey) => {
    let map = resolved.get(fieldKey)
    if (!map) {
      map = new Map()
      resolved.set(fieldKey, map)
    }
    return map
  }

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange)
      return () => {
        listeners.delete(onStoreChange)
      }
    },
    getVersion() {
      return version
    },
    get(fieldKey, value) {
      return resolved.get(fieldKey)?.get(value)
    },
    set(fieldKey, options) {
      const map = bucket(fieldKey)
      let landed = false
      for (const option of options) {
        if (!map.has(option.value)) landed = true
        map.set(option.value, option)
      }
      if (!landed) return
      version += 1
      for (const listener of listeners) listener()
    },
    claim(fieldKey, values) {
      let set = claimed.get(fieldKey)
      if (!set) {
        set = new Set()
        claimed.set(fieldKey, set)
      }
      const map = resolved.get(fieldKey)
      const fresh = []
      for (const value of values) {
        if (set.has(value) || map?.has(value)) continue
        set.add(value)
        fresh.push(value)
      }
      return fresh
    },
    release(fieldKey, values) {
      const set = claimed.get(fieldKey)
      if (!set) return
      for (const value of values) set.delete(value)
    },
  };
}

export {
  FilterActionsContext,
  FilterFocusContext,
  FilterRenderContext,
  FilterStateContext,
}