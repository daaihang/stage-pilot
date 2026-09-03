"use client";
import * as React from "react"
import { useCascaderState } from "@/components/reui/cascader/cascader-context"
import { CASCADER_ROOT_KEY, isCascaderMoreNode } from "@/components/reui/cascader/cascader-lib";

/* -------------------------------------------------------------------------- */
/*                                  Constants                                 */
/* -------------------------------------------------------------------------- */

/**
 * Highlight dwell before `prefetch` fetches: long enough that holding ArrowDown
 * does not fire a request per row, short enough to beat the ArrowRight press.
 */
const PREFETCH_DELAY = 150

/** Request keys for the two non-level requests. Never collide with a value. */
const SEARCH_KEY = "\u0000search"
const RESOLVE_PREFIX = "\u0000resolve:"

const NO_STATE = {
  loading: false,
  error: false,
  hasMore: false,
}

/** Stable empty result, so an idle search never churns the state context. */
const NO_RESULTS = []

function createStore() {
  return { pages: new Map(), states: new Map(), detached: new Map() }
}

function sameLoadState(a, b) {
  return (
    a.loading === b.loading &&
    a.error === b.error &&
    a.hasMore === b.hasMore &&
    a.cursor === b.cursor
  )
}

/* -------------------------------------------------------------------------- */
/*                              Store transitions                             */
/* -------------------------------------------------------------------------- */

/**
 * Copy-on-write, and a NO-OP when nothing changed: the merged index is memoised
 * on store identity, so a fresh object for an unchanged state would rebuild it.
 */
function withLoadState(store, key, update) {
  const current = store.states.get(key) ?? NO_STATE
  const next = update(current)
  if (store.states.has(key) && sameLoadState(current, next)) return store
  const states = new Map(store.states)
  states.set(key, next)
  return { pages: store.pages, states, detached: store.detached }
}

function withPage(store, key, items, options) {
  // A fresh level REPLACES its page so a `resolveValue` stub can be superseded.
  const previous = options.append ? (store.pages.get(key) ?? []) : []
  const seen = new Set(previous.map((node) => node.value))
  const merged = previous.slice()
  for (const item of items) {
    if (seen.has(item.value)) continue
    seen.add(item.value)
    merged.push(item)
  }

  const pages = new Map(store.pages)
  pages.set(key, merged)
  const states = new Map(store.states)
  states.set(key, {
    loading: false,
    error: false,
    hasMore: options.hasMore,
    cursor: options.cursor,
  })
  return { pages, states, detached: store.detached }
}

function withDetached(store, items) {
  let detached = null
  for (const item of items) {
    if (store.detached.get(item.value) === item) continue
    detached = detached ?? new Map(store.detached)
    detached.set(item.value, item)
  }
  if (!detached) return store
  return { pages: store.pages, states: store.states, detached }
}

/**
 * Places a resolved ancestor chain into `pages`, root first. Writes no
 * `states`, so those levels still read as unloaded and a drill-in still fetches
 * for real. Mirrored into `detached` so the trigger keeps its label.
 */
function withChain(store, chain) {
  if (chain.length === 0) return store
  const pages = new Map(store.pages)
  const detached = new Map(store.detached)
  let parentKey = CASCADER_ROOT_KEY

  for (const node of chain) {
    const bucket = pages.get(parentKey)
    if (!bucket) {
      pages.set(parentKey, [node])
    } else if (!bucket.some((entry) => entry.value === node.value)) {
      pages.set(parentKey, [...bucket, node])
    }
    detached.set(node.value, node)
    parentKey = node.value
  }

  return { pages, states: store.states, detached }
}

/**
 * The loader. A SIBLING of the `buildCascaderIndex` memo, never inside it: the
 * build stays pure in `items`, the merge pure in that build plus this store.
 */
export function useCascaderLoader(
  {
    base,
    getChildren,
    onSearch,
    resolveValue,
    searchDebounce = 250,
    loadKey,
    prefetch = false,
    onLoadError,
    enabled,
    query,
    levels,
    path,
    values
  }
) {
  const [store, setStore] = React.useState(createStore)
  const [search, setSearch] = React.useState(null)

  /**
   * Latest callbacks, WRITTEN IN AN EFFECT: `getChildren` is inline in most
   * consumers, so closing over it would refire every in-flight request per
   * re-render. The ref is what keeps the request machinery `[]`-dep. Declared
   * FIRST, since effects run in declaration order, so the level effect below
   * already sees the current commit.
   */
  const latest = React.useRef({
    base,
    store,
    getChildren,
    onSearch,
    resolveValue,
    onLoadError,
    prefetch,
    path,
  })

  React.useEffect(() => {
    latest.current = {
      base,
      store,
      getChildren,
      onSearch,
      resolveValue,
      onLoadError,
      prefetch,
      path,
    }
  })

  /** One AbortController PER KEY: columns mode runs several levels at once. */
  const controllers = React.useRef(new Map())
  /** Monotonic per key. The stale guard for out-of-order responses. */
  const requestIds = React.useRef(new Map())
  /** In-flight `(level, cursor)` signatures, so a duplicate ask is free. */
  const inflight = React.useRef(new Map())
  /**
   * The `(child count, cursor)` signature at the last paging fire, per level.
   * Guards what `hasMore` cannot: a page of zero new items while the server
   * still says `hasMore`. Cursor is IN the signature because an all-duplicates
   * page advances it while the count stands still - real progress, which a
   * count-only latch would brick forever.
   */
  const moreLatch = React.useRef(new Map())
  /** Values `resolveValue` has already been asked about, so it asks once. */
  const attempted = React.useRef(new Set())
  /** Every node the loader has seen, so a level key can name its own node. */
  const known = React.useRef(new Map())
  const timers = React.useRef({ prefetch: null })
  /** Bumped by a `loadKey` change, so responses from before it are dropped. */
  const epoch = React.useRef(0)

  const remember = React.useCallback((nodes) => {
    const map = known.current
    const walk = (list) => {
      for (const node of list) {
        map.set(node.value, node)
        if (node.children?.length) walk(node.children)
      }
    }
    walk(nodes)
  }, [])

  const abortKey = React.useCallback((key) => {
    const controller = controllers.current.get(key)
    if (!controller) return
    controllers.current.delete(key)
    inflight.current.delete(key)
    controller.abort()
  }, [])

  /* ------------------------------- level load ------------------------------ */

  const runLoad = React.useCallback(
    (
      key,
      reason,
      cursor,
      append
    ) => {
      const { getChildren: loader, base: currentBase } = latest.current
      if (!loader) return

      const signature = `${append ? "1" : "0"}:${cursor ?? ""}`
      if (inflight.current.get(key) === signature) return

      abortKey(key)
      const controller = new AbortController()
      controllers.current.set(key, controller)
      inflight.current.set(key, signature)

      const requestId = (requestIds.current.get(key) ?? 0) + 1
      requestIds.current.set(key, requestId)
      const startEpoch = epoch.current

      const node =
        key === CASCADER_ROOT_KEY
          ? null
          : (currentBase.byValue.get(key) ?? known.current.get(key) ?? null)

      setStore((prev) =>
        withLoadState(prev, key, (state) => ({
          ...state,
          loading: true,
          error: false,
        }))
      )

      const settle = () => {
        if (inflight.current.get(key) === signature)
          inflight.current.delete(key)
        if (controllers.current.get(key) === controller) {
          controllers.current.delete(key)
        }
      }

      const stale = () =>
        controller.signal.aborted ||
        startEpoch !== epoch.current ||
        requestId !== requestIds.current.get(key)

      // `Promise.resolve().then(...)`, not a direct call: it normalises a
      // SYNCHRONOUS throw into a rejection instead of taking the render down.
      Promise.resolve()
        .then(() => loader(node, { signal: controller.signal, cursor, reason }))
        .then((result) => {
          settle()
          if (stale()) return
          const items = Array.isArray(result) ? result : result.items
          const nextCursor = Array.isArray(result)
            ? undefined
            : result.nextCursor
          const hasMore = Array.isArray(result)
            ? false
            : (result.hasMore ?? nextCursor != null)

          if (!append) moreLatch.current.delete(key)
          remember(items)
          setStore((prev) =>
            withPage(prev, key, items, { append, hasMore, cursor: nextCursor })
          )
        })
        .catch((error) => {
          settle()
          if (stale()) return
          setStore((prev) =>
            withLoadState(prev, key, (state) => ({
              ...state,
              loading: false,
              error: true,
            }))
          )
          // Behind the stale guard: an abort is navigation, not a failure.
          latest.current.onLoadError?.(error, {
            parent: key === CASCADER_ROOT_KEY ? null : key,
            reason,
          })
        })
    },
    [abortKey, remember]
  )

  const ensureLevel = React.useCallback(
    (key, reason) => {
      const {
        getChildren: loader,
        store: current,
        base: index,
      } = latest.current
      if (!loader) return
      if (current.states.has(key)) return
      // A level `items` already fills is not the loader's business: that is how
      // a static root plus `getChildren` for the branches works with no flag.
      if (index.childrenOf.has(key)) return
      runLoad(key, reason, undefined, false)
    },
    [runLoad]
  )

  const loadMore = React.useCallback(
    (key) => {
      const { getChildren: loader, store: current } = latest.current
      if (!loader) return
      const state = current.states.get(key)
      if (!state || state.loading || !state.hasMore) return

      const loaded = current.pages.get(key)?.length ?? 0
      const signature = `${loaded}:${state.cursor ?? ""}`
      if (moreLatch.current.get(key) === signature) return
      moreLatch.current.set(key, signature)

      runLoad(key, "more", state.cursor, true)
    },
    [runLoad]
  )

  const retryLevel = React.useCallback(
    (key) => {
      const { getChildren: loader, store: current } = latest.current
      if (!loader) return
      const state = current.states.get(key)
      if (!state?.error) return

      const loaded = current.pages.get(key)?.length ?? 0
      // A retry must be able to re-fire the page the latch just blocked.
      moreLatch.current.delete(key)
      runLoad(key, "retry", loaded > 0 ? state.cursor : undefined, loaded > 0)
    },
    [runLoad]
  )

  /**
   * `detached` is deliberately untouched: chains and search hits belong to no
   * level, and the trigger needs their labels while the new page is in flight.
   */
  const invalidateLevel = React.useCallback(
    (value) => {
      const key = value ?? CASCADER_ROOT_KEY
      abortKey(key)
      // Bump the id too: a response past its signal check must still be stale.
      requestIds.current.set(key, (requestIds.current.get(key) ?? 0) + 1)
      moreLatch.current.delete(key)
      setStore((prev) => {
        if (!prev.states.has(key) && !prev.pages.has(key)) return prev
        const states = new Map(prev.states)
        states.delete(key)
        const pages = new Map(prev.pages)
        pages.delete(key)
        return { pages, states, detached: prev.detached }
      })
    },
    [abortKey]
  )

  const prefetchNode = React.useCallback(
    (node) => {
      const {
        prefetch: on,
        getChildren: loader,
        store: current,
      } = latest.current
      if (!on || !loader || !node) return
      if (isCascaderMoreNode(node)) return
      if (!node.hasChildren) return
      if (current.states.has(node.value)) return

      const holder = timers.current
      if (holder.prefetch) clearTimeout(holder.prefetch)
      // A TIMEOUT, not a direct call: `onItemHighlighted` fires from a layout
      // effect, where a synchronous setState is a render-phase cascade.
      holder.prefetch = setTimeout(() => {
        holder.prefetch = null
        ensureLevel(node.value, "prefetch")
      }, PREFETCH_DELAY)
    },
    [ensureLevel]
  )

  /* --------------------------------- search -------------------------------- */

  const runSearch = React.useCallback(
    (text) => {
      const { onSearch: searcher, path: currentPath } = latest.current
      if (!searcher) return

      abortKey(SEARCH_KEY)
      const controller = new AbortController()
      controllers.current.set(SEARCH_KEY, controller)
      const requestId = (requestIds.current.get(SEARCH_KEY) ?? 0) + 1
      requestIds.current.set(SEARCH_KEY, requestId)
      const startEpoch = epoch.current

      setSearch((prev) => ({
        query: text,
        results: prev?.results ?? [],
        loading: true,
        error: false,
      }))

      const settle = () => {
        if (controllers.current.get(SEARCH_KEY) === controller) {
          controllers.current.delete(SEARCH_KEY)
        }
      }
      const stale = () =>
        controller.signal.aborted ||
        startEpoch !== epoch.current ||
        requestId !== requestIds.current.get(SEARCH_KEY)

      Promise.resolve()
        .then(() =>
          searcher(text, { signal: controller.signal, path: currentPath })
        )
        .then((result) => {
          settle()
          if (stale()) return
          const items = Array.isArray(result) ? result : result.items
          remember(items)
          // Search hits go to `detached`, never a level: a hit lives anywhere in
          // the tree, and filing it under the open level would misplace it.
          setStore((prev) => withDetached(prev, items))
          setSearch({
            query: text,
            results: items,
            loading: false,
            error: false,
          })
        })
        .catch((error) => {
          settle()
          if (stale()) return
          setSearch((prev) => ({
            query: text,
            results: prev?.results ?? [],
            loading: false,
            error: true,
          }))
          latest.current.onLoadError?.(error, {
            parent: null,
            reason: "search",
          })
        })
    },
    [abortKey, remember]
  )

  /* --------------------------------- resolve ------------------------------- */

  const runResolve = React.useCallback(
    (value) => {
      const { resolveValue: resolver } = latest.current
      if (!resolver) return

      const key = `${RESOLVE_PREFIX}${value}`
      abortKey(key)
      const controller = new AbortController()
      controllers.current.set(key, controller)
      const startEpoch = epoch.current

      const settle = () => {
        if (controllers.current.get(key) === controller) {
          controllers.current.delete(key)
        }
      }

      Promise.resolve()
        .then(() =>
          resolver(value, { signal: controller.signal, reason: "resolve" })
        )
        .then((chain) => {
          settle()
          if (controller.signal.aborted || startEpoch !== epoch.current) return
          if (!chain?.length) return
          remember(chain)
          setStore((prev) => withChain(prev, chain))
        })
        .catch((error) => {
          settle()
          // Un-attempt on failure: `attempted` is written BEFORE the call, so
          // without this a resolver that failed once could never be retried.
          attempted.current.delete(value)
          if (controller.signal.aborted || startEpoch !== epoch.current) return
          latest.current.onLoadError?.(error, {
            parent: null,
            reason: "resolve",
          })
        })
    },
    [abortKey, remember]
  )

  /* --------------------------------- resets -------------------------------- */

  const cancelAll = React.useCallback(() => {
    const keys = Array.from(controllers.current.keys())
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    inflight.current.clear()

    const holder = timers.current
    if (holder.prefetch) {
      clearTimeout(holder.prefetch)
      holder.prefetch = null
    }
    if (keys.length === 0) return

    setStore((prev) => {
      let states = null
      for (const key of keys) {
        const state = prev.states.get(key)
        if (!state?.loading) continue
        states = states ?? new Map(prev.states)
        if ((prev.pages.get(key)?.length ?? 0) > 0) {
          states.set(key, { ...state, loading: false })
        } else {
          // No entry AT ALL: membership is what says "loaded", so a stranded
          // `loading: true` would read as loaded-and-empty forever.
          states.delete(key)
        }
      }
      return states ? { ...prev, states } : prev
    })
    setSearch((prev) => (prev?.loading ? { ...prev, loading: false } : prev))
  }, [])

  // A `loadKey` change drops everything. Declared BEFORE the level effect, so
  // a reset always lands before the levels are asked for again.
  const loadKeyRef = React.useRef(null)
  React.useEffect(() => {
    const previous = loadKeyRef.current
    loadKeyRef.current = { key: loadKey }
    if (!previous || Object.is(previous.key, loadKey)) return

    epoch.current += 1
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    inflight.current.clear()
    // `requestIds` is deliberately NOT cleared: the ids are stale-response
    // guards, not cache. Reusing an aborted predecessor's id would leave only
    // the epoch bump and the abort to reject the old response; monotonic per
    // key keeps all three guards independent. The unmount cleanup clears them.
    moreLatch.current.clear()
    attempted.current.clear()
    known.current.clear()

    const holder = timers.current
    if (holder.prefetch) {
      clearTimeout(holder.prefetch)
      holder.prefetch = null
    }

    setStore(createStore)
    setSearch(null)
  }, [loadKey])

  // Closing the popup aborts every request but does NOT drop the cache:
  // reopening onto an already-loaded level is the point of keeping it.
  React.useEffect(() => {
    if (enabled) return
    if (controllers.current.size === 0) return
    cancelAll()
  }, [enabled, cancelAll])

  React.useEffect(() => {
    const active = controllers.current
    const holder = timers.current
    const pending = inflight.current
    const ids = requestIds.current
    return () => {
      for (const controller of active.values()) controller.abort()
      active.clear()
      // Cleared WITH the controllers, for StrictMode's dev remount: a stale
      // inflight signature would make `runLoad` skip the refetch forever. The
      // aborted promises are stale-guarded, so emptying the ids is safe.
      pending.clear()
      ids.clear()
      if (holder.prefetch) clearTimeout(holder.prefetch)
    }
  }, [])

  /* ------------------------------- the effects ----------------------------- */

  const hasLoader = typeof getChildren === "function"
  const hasSearch = typeof onSearch === "function"
  const hasResolve = typeof resolveValue === "function"
  const trimmed = query.trim()

  // Serialised so the effects key on CONTENT, not on the array identity.
  const levelsKey = JSON.stringify(levels)
  const valuesKey = JSON.stringify(values)

  // THE load trigger: one declarative effect on the levels on screen, not a
  // call from `pushLevel`/`navigate`, which a controlled `path` never touches.
  React.useEffect(() => {
    if (!enabled || !hasLoader) return
    for (const key of levels) ensureLevel(key, "level")
    // `levels` enters through `levelsKey`; `store` re-runs after a load lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasLoader, levelsKey, store, ensureLevel])

  React.useEffect(() => {
    if (!hasSearch) return undefined
    if (!enabled || !trimmed) {
      abortKey(SEARCH_KEY)
      setSearch((prev) => (prev === null ? prev : null))
      return undefined
    }
    const timer = setTimeout(() => runSearch(trimmed), searchDebounce)
    return () => {
      clearTimeout(timer)
      abortKey(SEARCH_KEY)
    }
  }, [hasSearch, enabled, trimmed, searchDebounce, abortKey, runSearch])

  React.useEffect(() => {
    if (!enabled || !hasResolve) return
    for (const value of values) {
      if (!value) continue
      if (attempted.current.has(value)) continue
      if (base.byValue.has(value) || known.current.has(value)) continue
      attempted.current.add(value)
      runResolve(value)
    }
    // `values` is depended on through `valuesKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasResolve, valuesKey, base, runResolve])

  /* -------------------------------- the value ------------------------------ */

  const searchResults = React.useMemo(() => {
    if (!hasSearch || !trimmed) return null
    if (!search || search.query !== trimmed) {
      return NO_RESULTS;
    }
    return search.results
  }, [hasSearch, trimmed, search])

  const searchState = React.useMemo(() => {
    if (!hasSearch || !trimmed) return null
    const settled = search?.query === trimmed
    return {
      loading: !settled || !!search?.loading,
      error: settled && !!search?.error,
      hasMore: false,
    }
  }, [hasSearch, trimmed, search])

  return React.useMemo(
    () => ({
      active: hasLoader,
      store,
      states: store.states,
      searchResults,
      searchState,
      ensureLevel,
      loadMore,
      retryLevel,
      invalidateLevel,
      prefetchNode,
    }),
    [
      hasLoader,
      store,
      searchResults,
      searchState,
      ensureLevel,
      loadMore,
      retryLevel,
      invalidateLevel,
      prefetchNode,
    ]
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Consumers                                 */
/* -------------------------------------------------------------------------- */

/** One level's load state, `null` when never fetched. Omit for the root. */
export function useCascaderLoadState(parent) {
  const { loadStates } = useCascaderState()
  return loadStates.get(parent ?? CASCADER_ROOT_KEY) ?? null
}