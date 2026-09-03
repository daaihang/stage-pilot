/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react"
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  defaultAnimateLayoutChanges,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

// Sortable Item Context
const SortableItemContext = createContext({
  listeners: undefined,
  isDragging: false,
  disabled: false,
})

const IsOverlayContext = createContext(false)

const SortableInternalContext = createContext({
  activeId: null,
  modifiers: undefined,
})

const animateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true })

const dropAnimationConfig = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.4",
      },
    },
  }),
}

/**
 * Client-mount gate for the `createPortal` calls below, which need
 * `document.body` and so must not run on the server or during hydration.
 *
 * A never-notifying subscription makes `useSyncExternalStore` return the server
 * snapshot (`false`) while rendering on the server and while hydrating, then the
 * client snapshot (`true`) once mounted - the same gate the previous
 * `useLayoutEffect(() => setMounted(true), [])` provided, minus the extra render
 * pass that `react-hooks/set-state-in-effect` flags. All three functions are
 * module-scoped so their identities stay stable; an inline `getSnapshot` is the
 * classic cause of an infinite re-subscribe loop.
 */
const subscribeToNothing = () => () => {}
const getIsMounted = () => true
const getIsMountedOnServer = () => false

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 10 } }
const TOUCH_SENSOR_OPTIONS = {
  activationConstraint: { delay: 250, tolerance: 5 },
}
const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
}
const MEASURING_CONFIG = {
  droppable: { strategy: MeasuringStrategy.Always },
}
const STRATEGY_MAP = {
  horizontal: rectSortingStrategy,
  grid: rectSortingStrategy,
  vertical: verticalListSortingStrategy
}

function Sortable(
  {
    value,
    onValueChange,
    getItemValue,
    className,
    render,
    onMove,
    onValueCommit,
    strategy = "vertical",
    onDragStart,
    onDragEnd,
    onDragCancel,
    accessibility,
    modifiers,
    children,
    ...props
  }
) {
  const [activeId, setActiveId] = useState(null)
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getIsMounted,
    getIsMountedOnServer
  )

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)
  )

  const handleDragStart = useCallback(
    (event) => {
      setActiveId(event.active.id)
      onDragStart?.(event)
    },
    [onDragStart]
  )

  const handleDragEnd = useCallback(
    (event) => {
      const { active, over } = event
      setActiveId(null)
      onDragEnd?.(event)

      if (!over) return

      // Handle item reordering
      const activeIndex = value.findIndex(
        (item) => getItemValue(item) === active.id
      )
      const overIndex = value.findIndex(
        (item) => getItemValue(item) === over.id
      )

      if (activeIndex === -1 || overIndex === -1) return

      if (activeIndex !== overIndex) {
        if (onMove) {
          onMove({ event, activeIndex, overIndex })
        } else {
          const newValue = arrayMove(value, activeIndex, overIndex)
          onValueChange(newValue)
          onValueCommit?.(newValue, {
            event,
            activeIndex,
            overIndex,
            previousValue: value,
          })
        }
      }
    },
    [value, getItemValue, onValueChange, onMove, onDragEnd, onValueCommit]
  )

  const handleDragCancel = useCallback(
    (event) => {
      setActiveId(null)
      onDragCancel?.(event)
    },
    [onDragCancel]
  )

  const itemIds = useMemo(() => {
    const ids = value.map(getItemValue)
    if (process.env.NODE_ENV !== "production") {
      const seen = new Set()
      for (const id of ids) {
        if (seen.has(id)) {
          console.warn(
            `[Sortable] Duplicate item id "${id}". Item ids must be unique, or drag and drop will misbehave.`
          )
          break
        }
        seen.add(id)
      }
    }
    return ids
  }, [value, getItemValue])

  const contextValue = useMemo(
    () => ({ activeId, modifiers }),
    [activeId, modifiers]
  )

  const defaultProps = {
    "data-slot": "sortable",
    "data-dragging": activeId !== null,
    className: cn(activeId !== null && "cursor-grabbing!", className),
    children,
  }

  // Find the active child for the overlay
  const overlayContent = useMemo(() => {
    if (!activeId) return null
    let result = null
    Children.forEach(children, (child) => {
      if (isValidElement(child) && (child.props).value === activeId) {
        result = cloneElement(child, {
          ...(child.props),
          className: cn((child.props).className, "z-50"),
        })
      }
    })
    return result
  }, [activeId, children])

  return (
    <SortableInternalContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        modifiers={modifiers}
        accessibility={accessibility}
        measuring={MEASURING_CONFIG}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext
          items={itemIds}
          strategy={STRATEGY_MAP[strategy] ?? verticalListSortingStrategy}
        >
          {useRender({
            defaultTagName: "div",
            render,
            props: mergeProps(defaultProps, props),
          })}
        </SortableContext>
        {mounted &&
          createPortal(
            <DragOverlay
              dropAnimation={dropAnimationConfig}
              modifiers={modifiers}
              className={cn("z-50", activeId && "cursor-grabbing")}
            >
              <IsOverlayContext.Provider value={true}>
                {overlayContent}
              </IsOverlayContext.Provider>
            </DragOverlay>,
            document.body
          )}
      </DndContext>
    </SortableInternalContext.Provider>
  );
}

function SortableItem({
  value,
  className,
  render,
  disabled,
  ...props
}) {
  const isOverlay = useContext(IsOverlayContext)

  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging: isSortableDragging,
  } = useSortable({
    id: value,
    disabled: disabled || isOverlay,
    animateLayoutChanges,
  })

  const style = {
    transition,
    transform: CSS.Transform.toString(transform)
  }

  const defaultProps = isOverlay
    ? {
        "data-slot": "sortable-item",
        "data-value": value,
        "data-dragging": true,
        className: cn(className),
        children: props.children,
      }
    : {
        "data-slot": "sortable-item",
        "data-value": value,
        "data-dragging": isSortableDragging,
        "data-disabled": disabled,
        ref: setNodeRef,
        style,
        ...attributes,
        className: cn(
          isSortableDragging && "opacity-50 z-50",
          className
        ),
        children: props.children,
      }

  return (
    <SortableItemContext.Provider
      value={
        isOverlay
          ? { listeners: undefined, isDragging: true, disabled: false }
          : { listeners, isDragging: isSortableDragging, disabled }
      }
    >
      {useRender({
        defaultTagName: "div",
        render,
        props: mergeProps(defaultProps, props),
      })}
    </SortableItemContext.Provider>
  );
}

function SortableItemHandle({
  className,
  render,
  cursor = true,
  ...props
}) {
  const { listeners, isDragging, disabled } = useContext(SortableItemContext)

  const defaultProps = {
    "data-slot": "sortable-item-handle",
    "data-dragging": isDragging,
    "data-disabled": disabled,
    ...listeners,
    className: cn(
      cursor && (isDragging ? "cursor-grabbing!" : "cursor-grab!"),
      className
    ),
    children: props.children,
  }

  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps(defaultProps, props),
  });
}

function SortableOverlay({
  children,
  className,
  ...props
}) {
  const { activeId, modifiers } = useContext(SortableInternalContext)
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getIsMounted,
    getIsMountedOnServer
  )

  const content =
    activeId && children
      ? typeof children === "function"
        ? children({ value: activeId })
        : children
      : null

  if (!mounted) return null

  return createPortal(
    <DragOverlay
      dropAnimation={dropAnimationConfig}
      modifiers={modifiers}
      className={cn("z-50", activeId && "cursor-grabbing", className)}
      {...props}
    >
      <IsOverlayContext.Provider value={true}>
        {content}
      </IsOverlayContext.Provider>
    </DragOverlay>,
    document.body
  )
}

export { Sortable, SortableItem, SortableItemHandle, SortableOverlay }
