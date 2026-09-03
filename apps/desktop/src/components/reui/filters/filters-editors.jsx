import * as React from "react"
import {
  Cascader,
  CascaderEmpty,
  CascaderList,
  CascaderPanel,
  CascaderStatus,
} from "@/components/reui/cascader/cascader"
import {
  useCascaderActions,
  useCascaderHighlight,
} from "@/components/reui/cascader/cascader-context"
import { CascaderFooter } from "@/components/reui/cascader/cascader-footer"
import { CascaderItems } from "@/components/reui/cascader/cascader-item"
import {
  CascaderInput,
  CascaderNav,
} from "@/components/reui/cascader/cascader-nav"
import { FilterActionsContext, filterControlSizes } from "@/components/reui/filters/filters-context";
import {
  applyFilterExclusiveSelection,
  filterFilterOptions,
  joinFilterPath,
  normalizeFilterQuery,
  warnFilterOnce,
} from "@/components/reui/filters/filters-lib"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Input } from "@/components/ui/input"
import { RiCheckLine, RiCloseLine } from "@remixicon/react"

const IDLE = {
  items: [],
  loading: false,
  error: false,
  hasMore: false,
}

/** Stable no-op subscription, for a hook running outside a `Filters` root. */
const emptySubscribe = () => () => {}
const zeroVersion = () => 0

/**
 * The joined path of a field, from the schema index. Keyed by PATH, not field
 * identity, so labels survive a schema rebuild; an unknown field uses its id.
 */
function filterFieldKey(field, index) {
  if (!field) return null
  if (index) {
    for (const entry of index.all) {
      if ((entry.field) === (field)) {
        return joinFilterPath(entry.path)
      }
    }
  }
  return `#${field.id}`
}

/**
 * The shared option service every option-backed editor receives: debouncing,
 * aborting, cursor paging and value-to-label resolution. A deliberate fork of
 * the cascader's async machinery. Resolution is two-tier: a ref cache written
 * in an EFFECT, plus the root's `FilterResolutionStore`, without which a
 * `loadOptions`-only field showed its raw id once the menu closed.
 */
export function useFilterOptions(field, enabled, debounceMs = 250) {
  const [query, setQueryState] = React.useState("")
  const [state, setState] = React.useState(IDLE)

  const cache = React.useRef(new Map())
  const requestId = React.useRef(0)
  const abortRef = React.useRef(null)

  // Read directly, so this degrades outside a `Filters` root instead of throwing.
  const actionsContext = React.useContext(FilterActionsContext)
  const shared =
    actionsContext?.resolution ?? null
  const sharedKey = filterFieldKey(field, actionsContext?.index)

  // Re-render when a label lands ANYWHERE under this root, not just here.
  React.useSyncExternalStore(
    shared ? shared.subscribe : emptySubscribe,
    shared ? shared.getVersion : zeroVersion,
    shared ? shared.getVersion : zeroVersion
  )

  const staticOptions = field?.options
  const loadOptions = field?.loadOptions
  const isAsync = Boolean(loadOptions)

  // Seeded in an effect, not during render, so the render stays pure.
  React.useEffect(() => {
    if (!staticOptions) return
    for (const option of staticOptions) cache.current.set(option.value, option)
    if (shared && sharedKey) shared.set(sharedKey, staticOptions)
  }, [staticOptions, shared, sharedKey])

  React.useEffect(() => {
    for (const option of state.items) cache.current.set(option.value, option)
    if (shared && sharedKey && state.items.length) {
      shared.set(sharedKey, state.items)
    }
  }, [state.items, shared, sharedKey])

  const run = React.useCallback(
    async (nextQuery, cursor, append) => {
      if (!loadOptions) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const id = ++requestId.current

      setState((previous) => ({
        ...previous,
        loading: true,
        error: false,
        items: append ? previous.items : [],
      }))

      try {
        const result = await loadOptions(nextQuery, {
          signal: controller.signal,
          cursor,
        })
        // A superseded request must not write; the id, not the abort, decides.
        if (id !== requestId.current) return

        const normalized = Array.isArray(result)
          ? { items: result }
          : result

        setState((previous) => ({
          items: append
            ? [...previous.items, ...normalized.items]
            : normalized.items,
          loading: false,
          error: false,
          hasMore: normalized.hasMore ?? Boolean(normalized.nextCursor),
          cursor: normalized.nextCursor,
        }))
      } catch (error) {
        if (id !== requestId.current) return
        if ((error)?.name === "AbortError") return
        setState((previous) => ({
          ...previous,
          loading: false,
          error: true,
          hasMore: false,
        }))
      }
    },
    [loadOptions]
  )

  React.useEffect(() => {
    if (!enabled || !isAsync) return
    const timer = setTimeout(
      () => void run(query, undefined, false),
      debounceMs
    )
    return () => clearTimeout(timer)
  }, [enabled, isAsync, query, debounceMs, run])

  React.useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const normalizedQuery = normalizeFilterQuery(query)

  // Async results are server-filtered; re-filtering hides what the label omits.
  const items = React.useMemo(() => {
    if (isAsync) return state.items
    return filterFilterOptions(staticOptions ?? [], normalizedQuery)
  }, [isAsync, state.items, staticOptions, normalizedQuery])

  const setQuery = React.useCallback((next) => setQueryState(next), [])

  const loadMore = React.useCallback(() => {
    if (!state.hasMore || state.loading) return
    void run(query, state.cursor, true)
  }, [state.hasMore, state.loading, state.cursor, query, run])

  const retry = React.useCallback(() => {
    void run(query, undefined, false)
  }, [query, run])

  const resolve = React.useCallback(
    (value) => {
      // The ref cache cannot be the only tier: a ref write triggers no render,
      // so the chip would paint the raw value and never repaint. The shared
      // store holds other instances' pages and re-renders this one on a gain.
      const declared = staticOptions?.find((option) => option.value === value)
      if (declared) return declared
      const fromShared =
        shared && sharedKey ? shared.get(sharedKey, value) : undefined
      if (fromShared) return fromShared;
      return cache.current.get(value)
    },
    [staticOptions, shared, sharedKey]
  )

  return {
    items,
    loading: state.loading,
    error: state.error,
    hasMore: state.hasMore,
    query,
    setQuery,
    loadMore,
    retry,
    resolve,
  }
}

/**
 * Resolves committed values no loaded page covered, through `resolveValues`: a
 * restored saved view holds ids the loader never returned. The claim set marks
 * an omitted id asked, so only a REJECTED resolve lets a later mount retry.
 */
export function useFilterValueResolution(field, values) {
  const actionsContext = React.useContext(FilterActionsContext)
  const shared =
    actionsContext?.resolution ?? null
  const sharedKey = filterFieldKey(field, actionsContext?.index)
  const resolveValues = field?.resolveValues
  const staticOptions = field?.options
  // Keyed by CONTENT; NUL cannot occur inside a real stored value.
  const valuesKey = values.map((entry) => String(entry)).join("\u0000")

  React.useEffect(() => {
    if (!resolveValues || !shared || !sharedKey || valuesKey === "") return
    const missing = valuesKey.split("\u0000").filter((value) => {
      if (staticOptions?.some((option) => option.value === value)) return false
      return shared.get(sharedKey, value) === undefined
    })
    const wanted = shared.claim(sharedKey, missing)
    if (wanted.length === 0) return

    // No unmount guard: the store outlives the component.
    void Promise.resolve(resolveValues(wanted)).then(
      (options) => shared.set(sharedKey, options),
      () => shared.release(sharedKey, wanted)
    )
  }, [resolveValues, shared, sharedKey, valuesKey, staticOptions])
}

/* -------------------------------------------------------------------------- */
/*                               Shared chrome                                */
/* -------------------------------------------------------------------------- */

/**
 * The panel every editor renders into. A plain flex column, NOT a combobox: an
 * editor inside a Base UI composite would inherit its `aria-activedescendant`
 * and arrow keys, which is hostile to a colour picker or a slider.
 */
function EditorPanel({
  children,
  className
}) {
  return (
    <div
      data-slot="filter-editor"
      className={cn(
        "flex w-full flex-col gap-2 p-2",
        /* The list height cap as a VARIABLE, not the `maxHeight` prop, which
           becomes an inline style no consumer class can beat. 16rem is the
           256px the menu has always used. */
        "[--cascader-max-height:16rem]",
        className
      )}
    >
      {children}
    </div>
  )
}

function EditorFooter({
  onCancel,
  onCommit,
  labels,
  host
}) {
  // The ONE ladder, not a hardcoded rung: `size="sm"` here measured 4px short
  // of the bar's own controls at `size="default"` in all eight styles.
  const actions = React.useContext(FilterActionsContext)
  const sizes = filterControlSizes({ size: actions?.size ?? "default" })

  // The create host advances on commit and has Back; amend must offer discard.
  if (host === "create") return null
  return (
    <div className="flex items-center justify-end gap-1.5 pt-1">
      <Button variant="ghost" size={sizes.button} onClick={onCancel}>
        {labels.discard}
      </Button>
      <Button size={sizes.button} onClick={onCommit}>
        {labels.apply}
      </Button>
    </div>
  )
}

/**
 * `w-full` because `ButtonGroup` is `w-fit`, which collapses inside this
 * fixed-width panel. Sera is an underline style, so its direct children flatten
 * to one bottom-only edge - `border-b-input`, not transparent, since the
 * buttons are the trailing edge and the rule would stop mid-panel.
 */
const EDITOR_FIELD_GROUP =
  "w-full"

/**
 * Confirm and cancel, an OUTLINE pair FUSED onto the field's trailing edge.
 * Returns a FRAGMENT: `ButtonGroup` fuses with selectors matching DIRECT
 * children only, so a wrapper div renders three separate boxes. `size="icon"`
 * because every style's icon button at that size is exactly its input's height.
 */
function EditorCommitButtons({
  onCancel,
  onCommit,
  labels
}) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={labels.apply}
        onClick={onCommit}
      >
        <RiCheckLine aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={labels.discard}
        onClick={onCancel}
      >
        <RiCloseLine aria-hidden="true" />
      </Button>
    </>
  )
}

function useCommitKeys(commit, cancel) {
  return React.useCallback(
    (event) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault()
        commit()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        // Stop here so a surrounding dialog does not also close.
        event.stopPropagation()
        cancel()
      }
    },
    [commit, cancel]
  );
}

/* -------------------------------------------------------------------------- */
/*                                Text / number                               */
/* -------------------------------------------------------------------------- */

export function FilterTextEditor(
  {
    value,
    onValueChange,
    commit,
    cancel,
    autoFocusProps,
    labels,
    host,
    field
  }
) {
  const onKeyDown = useCommitKeys(() => commit(), cancel)
  return (
    // A width, not shrink-to-fit: the popover is `w-auto`, so an unsized box
    // changes width between the hosts. `w-72` is measured - it holds about 23
    // characters in sera and 27 in nova; `w-64` held about eighteen, too short
    // for an email, and `w-80` was the widest control in a bar of compact
    // chips. Capped at the viewport because `w-80` is 320px and a 360px phone
    // has 40px to spare. A `w-*` on the field wins.
    <EditorPanel
      className={cn("w-72 max-w-[calc(100vw-2rem)] min-w-0", field.className)}
    >
      <ButtonGroup className={EDITOR_FIELD_GROUP}>
        <Input
          {...autoFocusProps}
          value={(value) ?? ""}
          placeholder={field.placeholder ?? labels.valuePlaceholder}
          aria-label={field.label}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {/*
          A lone input still belongs in the group: the per-style sheets re-round
          the LAST child, so a group with nothing fused draws the bare field.
        */}
        {host === "create" ? null : (
          <EditorCommitButtons
            labels={labels}
            onCancel={cancel}
            onCommit={() => commit()}
          />
        )}
      </ButtonGroup>
    </EditorPanel>
  );
}

export function FilterNumberEditor(
  {
    value,
    onValueChange,
    commit,
    cancel,
    autoFocusProps,
    labels,
    host,
    field
  }
) {
  const onKeyDown = useCommitKeys(() => commit(), cancel)
  return (
    // Deliberately not the text editor's `w-72`: number values are short by
    // construction, and a wide box around "42" is the opposite defect.
    <EditorPanel className={cn("w-56 min-w-0", field.className)}>
      <ButtonGroup className={EDITOR_FIELD_GROUP}>
        <Input
          {...autoFocusProps}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          placeholder={field.placeholder}
          aria-label={field.label}
          onChange={(event) => {
            const raw = event.target.value
            onValueChange((raw === "" ? undefined : Number(raw)))
          }}
          onKeyDown={onKeyDown}
        />
        {host === "create" ? null : (
          <EditorCommitButtons
            labels={labels}
            onCancel={cancel}
            onCommit={() => commit()}
          />
        )}
      </ButtonGroup>
    </EditorPanel>
  );
}

export function FilterRangeEditor(
  {
    value,
    onValueChange,
    commit,
    cancel,
    autoFocusProps,
    labels,
    host,
    field
  }
) {
  const tuple = (Array.isArray(value) ? value : [])
  const onKeyDown = useCommitKeys(() => commit(), cancel)

  const update = (index, raw) => {
    const next = [tuple[0], tuple[1]]
    next[index] = raw === "" ? undefined : Number(raw)
    onValueChange(next)
  }

  return (
    <EditorPanel>
      <div className="flex items-center gap-1.5">
        <Input
          {...autoFocusProps}
          type="number"
          value={tuple[0] === undefined ? "" : String(tuple[0])}
          aria-label={labels.rangeFrom(field.label)}
          onChange={(event) => update(0, event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="text-muted-foreground text-xs">
          {labels.rangeSeparator}
        </span>
        <Input
          type="number"
          value={tuple[1] === undefined ? "" : String(tuple[1])}
          aria-label={labels.rangeTo(field.label)}
          onChange={(event) => update(1, event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <EditorFooter
        host={host}
        labels={labels}
        onCancel={cancel}
        onCommit={() => commit()}
      />
    </EditorPanel>
  )
}

/** Joins a selection into one comparable key; NUL cannot occur in a value. */
const PIN_SEPARATOR = "\u0000"

/** A bound on a race: each attempt costs one task and stops on success. */
const MAX_PIN_RESTORE_ATTEMPTS = 4

/**
 * Carries the HIGHLIGHT across a live re-pin. Base UI holds it as an INDEX and
 * a keyed reorder MOVES the DOM node rather than remounting it, so the index
 * map only rebuilds when the `MutationObserver` fires: until then, ticking a
 * row moves the highlight down one. So this ARMS in the layout effect, where
 * the map still reads the OLD order, and fires on the signature (SAME index,
 * DIFFERENT row) from a TASK, re-trying because the store event and the re-sort
 * are unordered. A synthetic `mousemove`, since Base UI exposes no setter.
 */
function FilterMenuPinKeeper({
  order,
  items
}) {
  const { baseId } = useCascaderActions()
  const highlight = useCascaderHighlight()
  const previousRef = React.useRef(null)
  const pendingRef = React.useRef(null)
  const timerRef = React.useRef(null)

  // From the render: on the reordering commit a ref still holds the OLD row.
  const highlightedValue = highlight.value
  const highlightedIndex = highlight.index

  const stop = React.useCallback(() => {
    pendingRef.current = null
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const startRestore = React.useCallback(() => {
    const attempt = () => {
      timerRef.current = null
      const pending = pendingRef.current
      if (!pending) return

      const target = pending.order.indexOf(pending.value)
      const rows = document
        .getElementById(`${baseId}-column-0`)
        ?.querySelectorAll('[data-slot="cascader-item"]')
      // A WINDOWED list renders a subset, so row N is not order[N]. Leave it.
      if (target < 0 || !rows || rows.length !== pending.order.length) {
        stop()
        return
      }

      rows[target]?.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true })
      )

      pending.attempts += 1
      if (pending.attempts >= MAX_PIN_RESTORE_ATTEMPTS) {
        stop()
        return
      }
      timerRef.current = setTimeout(attempt, 0)
    }

    timerRef.current = setTimeout(attempt, 0)
  }, [baseId, stop])

  // No dependency list: the arm must run on the commit that reorders the rows.
  React.useLayoutEffect(() => {
    const previous = previousRef.current
    previousRef.current = { order, items }

    if (!previous || previous.order === order) return
    // New DATA (a page, a query) is Base UI's to highlight; only a re-pin is ours.
    if (previous.items !== items) return
    if (!highlightedValue) return
    // Content, not identity: a re-pin can leave the rows in the same order.
    if (isSameOrder(previous.order, order)) return

    pendingRef.current = {
      value: highlightedValue,
      index: highlightedIndex,
      order,
      attempts: 0,
    }
  })

  React.useEffect(() => {
    const pending = pendingRef.current
    if (!pending) return

    // Back where it belongs, or moved by the user: either way the arm is spent.
    if (
      highlightedValue === pending.value ||
      highlightedIndex !== pending.index
    ) {
      stop()
      return
    }
    // Already chasing this one; a second chain would double every dispatch.
    if (pending.attempts > 0 || timerRef.current !== null) return
    startRestore()
  }, [highlightedValue, highlightedIndex, startRestore, stop])

  React.useEffect(() => stop, [stop])

  return null
}

/** Element-wise, because the arrays are rebuilt on every selection change. */
function isSameOrder(a, b) {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

/**
 * One accessible list, shared by the operator menu and every option editor. It
 * is the CASCADER configured flat, not a list this file implements, which
 * brings the typeahead, RTL handling and live region with it. Only the pinning
 * and the paging affordance stay out here.
 */
export function FilterMenu({
  items,
  selected,
  multiple = false,
  onSelectionChange,
  labels,
  ariaLabel,
  searchPlaceholder,
  searchable = true,
  maxHeight,
  pinSelected = false,
  sortSelected = "none",
  preFiltered = false,
  autoFocusProps,
  query,
  onQueryChange,
  state
}) {
  /**
   * The pin set as a KEY, not an array: `selected` is a fresh array on most
   * renders, so a memo depending on it re-partitions every render.
   */
  const liveKey = pinSelected ? selected.join(PIN_SEPARATOR) : ""

  /**
   * The same set, frozen at OPEN, for `sortSelected: "snapshot"`. LIVE is the
   * default: "your picks, then the rest" is about the CURRENT selection, and
   * `FilterMenuPinKeeper` pays for rows moving under the pointer.
   */
  const [snapshotKey] = React.useState(() => liveKey)
  // `pinSelected` re-checked here, not just through `liveKey`: `snapshotKey` is
  // frozen at MOUNT, so a menu that lost the prop would keep partitioning.
  const pinnedKey = !pinSelected
    ? ""
    : sortSelected === "snapshot"
      ? snapshotKey
      : liveKey

  // Uncontrolled unless the caller owns the query, as an option service does.
  const [ownQuery, setOwnQuery] = React.useState("")
  const currentQuery = query ?? ownQuery
  const setQuery = onQueryChange ?? setOwnQuery

  /**
   * Memoized on the SELECTION, not the query: folding the query in re-sorted
   * 4,000 rows on every keystroke, for a one pixel rule.
   */
  const partitioned = React.useMemo(() => {
    const pinned = new Set(pinnedKey ? pinnedKey.split(PIN_SEPARATOR) : [])

    /*
      Exclusive rows come out BEFORE the pin partition; their position is fixed.
      Pinning is by SELECTION, so a ticked None row would lift itself above the
      very rule drawn to set it apart and drop back on untick. Grouping by ROLE
      means the pinned group counts ordinary picks only, which is also why
      picking None draws no pin rule: it clears every other pick.
    */
    const exclusive = items.filter((item) => item.exclusive)
    const values = exclusive.length
      ? items.filter((item) => !item.exclusive)
      : items

    const chosen = pinned.size
      ? values.filter((item) => pinned.has(item.value))
      : []
    const rest = pinned.size
      ? values.filter((item) => !pinned.has(item.value))
      : values

    // The SCHEMA's order inside each group unless the field asks otherwise:
    // option order is usually semantic.
    const ordered =
      sortSelected === "label"
        ? [
            [...chosen].sort((a, b) => a.label.localeCompare(b.label)),
            [...rest].sort((a, b) => a.label.localeCompare(b.label)),
            [...exclusive].sort((a, b) => a.label.localeCompare(b.label)),
          ]
        : [chosen, rest, exclusive]

    const rows = [...ordered[0], ...ordered[1], ...ordered[2]]

    return {
      chosenCount: chosen.length,
      /** Index of the first exclusive row, or -1 when the list has none. */
      exclusiveAt: exclusive.length ? rows.length - exclusive.length : -1,
      // The render order alone, so a REORDER is an identity compare.
      order: rows.map((item) => item.value),
      nodes: rows.map((item) => ({
        value: item.value,
        label: item.label,
        icon: item.icon,
        description: item.description,
        keywords: item.keywords,
        disabled: item.disabled,
        // Only exclusive rows carry `data`, so the ordinary 4,000 keep theirs.
        data: item.exclusive ? { exclusive: true } : undefined,
      })),
    };
  }, [items, pinnedKey, sortSelected])

  // No rule under a query: "your picks, then the rest" is about the WHOLE list.
  const dividerAt =
    partitioned.chosenCount && !currentQuery.trim()
      ? partitioned.chosenCount
      : -1

  // Survives a search, unlike the pin rule: it is a fact about the row.
  const exclusiveDividerAt = partitioned.exclusiveAt

  const nodes = React.useMemo(() => {
    const total = partitioned.nodes.length
    // Only a boundary with rows on BOTH sides is one: a rule on row 0 would
    // be a line above the top of the list.
    const marks = [dividerAt, exclusiveDividerAt].filter(
      (index) => index > 0 && index < total
    )
    if (marks.length === 0) return partitioned.nodes
    // Rows rewritten, not rebuilt: copying 4,000 objects would undo the split.
    const next = partitioned.nodes.slice()
    for (const index of marks) {
      // MERGED, never replaced: the two boundaries usually fall on one row, and
      // overwriting `data` dropped the flag the accessible name is built from.
      next[index] = {
        ...next[index],
        data: { ...next[index].data, divider: true },
      }
    }
    return next
  }, [partitioned, dividerAt, exclusiveDividerAt])

  const renderItem = React.useCallback(
    (
      node,
      itemState
    ) => (
      <>
        {node.data?.divider ? (
          <span
            data-slot="filter-menu-divider"
            aria-hidden="true"
            /* Full bleed, over the per-style `--cascader-list-pad` the shell
               publishes: a rule stopping at the row's inset box reads as a gap.
               Centred in the 8px the row gives back above itself, not `top-0`. */
            className="bg-border absolute inset-x-[calc(var(--cascader-list-pad,4px)*-1)] -top-1 h-px"
          />
        ) : null}

        {node.icon ? (
          <span
            data-slot="filter-menu-icon"
            className="text-muted-foreground flex shrink-0 items-center justify-center"
          >
            {node.icon}
          </span>
        ) : null}

        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="w-full truncate text-start">{node.label}</span>
          {node.description ? (
            <span className="text-muted-foreground w-full truncate text-start text-xs">
              {node.description}
            </span>
          ) : null}
        </span>

        {/*
          What the aria-hidden rule says, for the people it does not reach.
          Inside the option element so it joins the row's accessible NAME, not
          an `aria-describedby`: a description is announced late or not at all,
          and this has to arrive before the press. The cascader's `srDetails`
          cannot either: `renderItem` replaces the row body. Empty copy renders
          nothing, so `labels.exclusiveHint` of "" silences it.
        */}
        {node.data?.exclusive && labels.exclusiveHint ? (
          <span data-slot="filter-menu-exclusive-hint" className="sr-only">
            {`, ${labels.exclusiveHint}`}
          </span>
        ) : null}

        {/* A check mark in both modes, never the cascader's default box. */}
        {itemState.selected ? (
          <span
            data-slot="filter-menu-check"
            /* The gutter every style already reserves, on the cascader's own
               logical inset. `end-*` rather than `right-2`, so RTL mirrors. */
            className="size-4 pointer-events-none absolute end-[var(--cascader-row-inset,8px)]! flex items-center justify-center rtl:right-auto!"
          >
            <RiCheckLine className="text-foreground! **:text-foreground!" />
          </span>
        ) : null}
      </>
    ),
    [labels.exclusiveHint]
  )

  const cascaderLabels = React.useMemo(
    () => ({
      search: searchPlaceholder ?? labels.searchOptions,
      empty: labels.empty,
      loading: labels.loading,
      loadingMore: labels.loadingMore,
      loadMore: labels.loadMore,
      error: labels.error,
      retry: labels.retry,
      // Named after the field, not the cascader's own "Top level" wording.
      rootLevel: ariaLabel,
      panelLabel: ariaLabel,
      // Run FLAT, so the default hint would teach branch keys that do not exist.
      keyboardHint: () => "",
      // From `FilterLabels`, so the menu ships no English of its own.
      resultsAnnouncement: labels.resultsAnnouncement,
      actionsLabel: labels.actionsLabel,
    }),
    [labels, ariaLabel, searchPlaceholder]
  )

  /**
   * Paging and retry in the pinned footer, never a row: a row would join the
   * option ring, where arrows land on it and a query filters it away mid-page.
   */
  const actions = React.useMemo(() => {
    if (state?.error) {
      return [{ value: "retry", label: labels.retry, onSelect: state.retry }]
    }
    if (state?.hasMore) {
      return [
        {
          value: "load-more",
          label: state.loading ? labels.loadingMore : labels.loadMore,
          disabled: state.loading,
          onSelect: state.loadMore,
        },
      ]
    }
    return []
  }, [state, labels])

  const shared = {
    // Inline and pinned open with a no-op handler, so the unconditional
    // `setOpen(false)` of a single-select commit cannot dismiss the popover.
    inline: true,
    open: true,
    onOpenChange: () => {},
    items: nodes,
    inputValue: currentQuery,
    onInputValueChange: setQuery,
    maxHeight,
    renderItem,
    labels: cascaderLabels,
    actions,
    // The option service is the ONE filter when it owns the query.
    ...(preFiltered ? { filter: () => true } : null),
  }

  const cascaderProps = multiple
    ? {
        ...shared,
        multiple: true,
        value: selected,
        onValueChange: (values) => onSelectionChange(values),
      }
    : {
        ...shared,
        value: selected[0] ?? "",
        onValueChange: (value) =>
          onSelectionChange(value ? [value] : []),
      }

  return (
    <Cascader {...cascaderProps}>
      <CascaderPanel>
        {/*
          `searchable: false` hides the FIELD, never removes it: the input owns
          focus and `aria-activedescendant`, so a menu without one has no
          keyboard. The class goes on the nav so the strip's border goes too.
        */}
        <CascaderNav
          className={cn(
            /* The nav's divider is `border-border/60` and the group separator
               is a full-opacity `bg-border`; two strengths read as a mistake. */
            "border-border",
            !searchable && "sr-only"
          )}
        >
          <CascaderInput
            {...(autoFocusProps ?? {})}
            placeholder={searchPlaceholder ?? labels.searchOptions}
            aria-label={ariaLabel}
          />
        </CascaderNav>
        <CascaderEmpty>
          {state?.error
            ? labels.error
            : state?.loading
              ? labels.loading
              : labels.empty}
        </CascaderEmpty>
        {/*
          Plain rows, DELIBERATELY not `CascaderVirtualItems`: windowing stands
          `FilterMenuPinKeeper` down. The long lists are async and PAGE 25.
        */}
        <CascaderList
          /**
           * Real layout space around the group rule, which is absolutely
           * positioned and adds no height. `renderItem` cannot reach the row's
           * own box, and a spacer NODE would join the option ring.
           *
           * `:has()` is affordable here: scoped to this one list, a compound
           * whose descendant exists on at most ONE row, and these menus render
           * tens of rows rather than thousands.
           */
          className="[&>[data-slot=cascader-item]:has([data-slot=filter-menu-divider])]:mt-2"
        >
          <CascaderItems />
        </CascaderList>
        <CascaderFooter />
        <CascaderStatus />
        {/*
          Last, so its layout effect reads the reordered DOM after every row has
          registered. Not mounted at all for a menu that cannot reorder.
        */}
        {pinSelected && sortSelected !== "snapshot" ? (
          <FilterMenuPinKeeper order={partitioned.order} items={items} />
        ) : null}
      </CascaderPanel>
    </Cascader>
  )
}

/* -------------------------------------------------------------------------- */
/*                              Option based editors                          */
/* -------------------------------------------------------------------------- */

function OptionEditor(props) {
  const {
    multiple,
    options,
    labels,
    autoFocusProps,
    commit,
    cancel,
    onValueChange,
    value,
    field,
  } = props

  const selected = React.useMemo(() => {
    if (value === undefined || value === null) return []
    return (Array.isArray(value) ? value : [value]);
  }, [value])

  const announce = React.useContext(FilterActionsContext)?.announce

  return (
    /*
      A DELIBERATELY narrow default: 12rem holds around 22 characters at every
      style's row size. `field.className` lands LAST, so a consumer's `w-*` wins.
    */
    <EditorPanel className={cn("w-48 min-w-0 gap-0 p-0", field.className)}>
      <FilterMenu
        items={options.items}
        selected={selected}
        multiple={multiple}
        onSelectionChange={(raw) => {
          /*
            The ONE place the None rule is applied: every route into a selection
            arrives here, so click and keyboard cannot disagree, and only the
            editor can ANSWER it - `options.resolve` sees the schema and every
            loaded page, where the menu holds only the rows on screen.
          */
          const values = applyFilterExclusiveSelection(raw, selected, (value) =>
            Boolean(options.resolve(value)?.exclusive)
          )

          /*
            Identity is the test: the rule hands back `raw` itself unless it
            intervened. Announced because nothing else reports it: focus never
            moved, and nobody is on the rows that lost their check marks.
          */
          if (values !== raw && announce) {
            const arrived = values.find((entry) => !selected.includes(entry))
            const cleared = raw.length - values.length
            if (arrived !== undefined && cleared > 0) {
              announce(
                labels.exclusiveAnnouncement(
                  options.resolve(arrived)?.label ?? arrived,
                  cleared
                )
              )
            }
          } else if (values === raw && raw.length > 1) {
            /*
              The hole in the rule, made LOUD. An unresolvable value is treated
              as ordinary and cannot be told from an id whose label has not
              arrived, so this warns rather than acts. Needs a SEEN None row.
            */
            const hasNoneRow =
              options.items.some((item) => item.exclusive) ||
              Boolean(field.options?.some((option) => option.exclusive))
            const unresolved = hasNoneRow
              ? raw.find((entry) => options.resolve(entry) === undefined)
              : undefined
            if (unresolved !== undefined) {
              warnFilterOnce(
                `exclusive-unresolved:${field.id}`,
                `field "${field.id}" has an exclusive option, but the value ` +
                  `"${unresolved}" resolves to no option, so the None rule ` +
                  `cannot tell whether it is the exclusive one and has left ` +
                  `it in place. Declare the exclusive option in the field's ` +
                  `\`options\` even when the rest of the list is async, or ` +
                  `cover stored values with \`resolveValues\`.`
              )
            }
          }

          if (!multiple) {
            const next = values[0]
            // Base UI deselects the committed row; an empty filter is no gain.
            if (next === undefined) {
              cancel()
              return
            }
            onValueChange(next)
            commit(next)
            return
          }
          onValueChange(values)
          // Every toggle commits with the popover open: several picks, one gesture.
          commit(values, { close: false })
        }}
        labels={labels}
        ariaLabel={field.label}
        searchable={field.searchable ?? true}
        // Not a composed `Search ${label}...`: hardcoded English no `labels`
        // override could reach, and lowercasing a label is locale-hostile.
        searchPlaceholder={field.placeholder}
        pinSelected={field.pinSelected ?? false}
        sortSelected={field.sortSelected}
        // `useFilterOptions` already applied the query, locally or server side.
        preFiltered
        query={options.query}
        onQueryChange={options.setQuery}
        state={options}
        autoFocusProps={autoFocusProps}
      />
    </EditorPanel>
  );
}

export function FilterSelectEditor(props) {
  return <OptionEditor {...props} multiple={false} />
}

export function FilterMultiSelectEditor(props) {
  return <OptionEditor {...props} multiple />
}

/* -------------------------------------------------------------------------- */
/*                                   Boolean                                  */
/* -------------------------------------------------------------------------- */

/**
 * Module level, so the menu's index is not rebuilt on every render. Not in
 * `FilterLabels`: the chip's own display spells the same two words out.
 */
const BOOLEAN_ITEMS = [
  { value: "true", label: "True" },
  { value: "false", label: "False" },
]

export function FilterBooleanEditor(
  {
    value,
    onValueChange,
    commit,
    labels,
    autoFocusProps,
    field
  }
) {
  return (
    // Two words, and `field.className` lands last so a consumer's `w-*` wins.
    <EditorPanel className={cn("w-40 min-w-0 gap-0 p-0", field.className)}>
      <FilterMenu
        items={BOOLEAN_ITEMS}
        selected={value === true ? ["true"] : value === false ? ["false"] : []}
        onSelectionChange={(values) => {
          /* Deselecting the committed row leaves nothing to filter on, so it is
             a no-op rather than a commit of `false`. */
          if (values.length === 0) return
          const next = (values[0] === "true")
          onValueChange(next)
          commit(next)
        }}
        labels={labels}
        ariaLabel={field.label}
        /* Two rows: a search over them is more chrome than list, but the
           field is still rendered, hidden, because it owns the keyboard. */
        searchable={false}
        autoFocusProps={autoFocusProps}
      />
    </EditorPanel>
  );
}

export const DEFAULT_FILTER_EDITORS = {
  text: FilterTextEditor,
  number: FilterNumberEditor,
  range: FilterRangeEditor,
  select: FilterSelectEditor,
  multiselect: FilterMultiSelectEditor,
  boolean: FilterBooleanEditor,
}

/**
 * Picks the editor for a (field, operator) pair: the field's own `editor`, then
 * the operator's ARITY, then the field's `type`. Arity outranks type because
 * "between" wants two boxes whatever the field said.
 */
export function resolveFilterEditor(field, operator, editors) {
  if (typeof field.editor === "function") {
    // The one place a consumer's typed editor meets the erased registry.
    return field.editor;
  }
  if (typeof field.editor === "string") {
    const named = editors[field.editor]
    if (named) return named
  }

  const arity = operator?.arity ?? "one"
  if (arity === "none") return undefined
  if (arity === "range") return editors.range
  if (arity === "many") {
    // An option-backed field gets checkboxes; anything else receives an array.
    if (field.options || field.loadOptions) return editors.multiselect
  }

  return editors[field.type ?? "text"] ?? editors.text
}