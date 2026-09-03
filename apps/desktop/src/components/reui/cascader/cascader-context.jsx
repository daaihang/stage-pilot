import * as React from "react";

const CascaderStateContext = React.createContext(undefined)

/**
 * One provider serves every `T`, so the context holds an erased `unknown` value
 * and this cast restores it. The primitive never inspects the payload.
 */
export function useCascaderState() {
  const context = React.useContext(CascaderStateContext)
  if (!context) {
    throw new Error("useCascaderState must be used within a Cascader")
  }
  return context;
}

const CascaderActionsContext = React.createContext(undefined)

export function useCascaderActions() {
  const context = React.useContext(CascaderActionsContext)
  if (!context) {
    throw new Error("useCascaderActions must be used within a Cascader")
  }
  return context;
}

const CascaderRenderContext = React.createContext({})

export function useCascaderRender() {
  return React.useContext(CascaderRenderContext);
}

const NO_HIGHLIGHT = { index: -1, value: null }

export function createCascaderHighlightStore() {
  let snapshot = NO_HIGHLIGHT
  const listeners = new Set()

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange)
      return () => {
        listeners.delete(onStoreChange)
      }
    },
    // The SAME object until something changes; `useSyncExternalStore` needs it.
    getSnapshot() {
      return snapshot
    },
    set(next) {
      if (next.index === snapshot.index && next.value === snapshot.value) return
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

/** Shared and permanently empty, so the hook degrades outside a `Cascader`. */
const FALLBACK_HIGHLIGHT_STORE = createCascaderHighlightStore()

const CascaderHighlightContext = React.createContext(FALLBACK_HIGHLIGHT_STORE)

/** Subscribes to the highlight. Re-renders ONLY the calling component. */
export function useCascaderHighlight() {
  const store = React.useContext(CascaderHighlightContext)
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
}

export {
  CascaderActionsContext,
  CascaderHighlightContext,
  CascaderRenderContext,
  CascaderStateContext,
}