import * as React from "react"

import { cn } from "@/lib/utils"
import { resolveDialogFooterMode } from "@/lib/modal-layout"

function cloneForMeasurement(node) {
  if (!React.isValidElement(node)) return node
  const props = { id: undefined, ref: undefined, tabIndex: -1, disabled: true }
  for (const key of Object.keys(node.props)) {
    if (/^on[A-Z]/.test(key)) props[key] = undefined
  }
  return React.cloneElement(node, props)
}

function asItems(value) {
  return React.Children.toArray(value).filter(Boolean)
}

export function DialogFooterLayout({
  slot = "dialog-footer",
  layout = "standard",
  cancel,
  secondary,
  primary,
  className,
  ...props
}) {
  const footerRef = React.useRef(null)
  const measureRef = React.useRef(null)
  const [compact, setCompact] = React.useState(true)
  const secondaryItems = asItems(secondary)
  const primaryItems = asItems(primary)
  const actions = [...secondaryItems, ...primaryItems]
  const allActions = [...asItems(cancel), ...secondaryItems, ...primaryItems]

  if (secondaryItems.length > 2) throw new Error("DialogFooter accepts at most two secondary actions")
  if (primaryItems.length > 1) throw new Error("DialogFooter accepts exactly one primary action")
  if (!["standard", "wizard", "auth"].includes(layout)) {
    throw new Error(`Unsupported dialog footer layout: ${layout}`)
  }

  React.useLayoutEffect(() => {
    const footer = footerRef.current
    const naturalGroup = measureRef.current
    if (!footer || !naturalGroup) return undefined

    const syncLayout = () => {
      const content = footer.closest('[data-slot="dialog-content"], [data-slot="alert-dialog-content"]')
      const availableWidth = footer.getBoundingClientRect().width
      const requiredWidth = naturalGroup.getBoundingClientRect().width
      const mode = resolveDialogFooterMode({
        availableWidth,
        naturalActionsWidth: requiredWidth,
        layout,
      })
      setCompact(mode === "compact")
    }

    syncLayout()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncLayout)
      return () => window.removeEventListener("resize", syncLayout)
    }
    const observer = new ResizeObserver(syncLayout)
    observer.observe(footer)
    const content = footer.closest('[data-slot="dialog-content"], [data-slot="alert-dialog-content"]')
    if (content) observer.observe(content)
    observer.observe(naturalGroup)
    return () => observer.disconnect()
  }, [allActions.length, layout])

  const compactMode = layout !== "auth" && compact

  return (
    <div
      ref={footerRef}
      data-slot={slot}
      data-layout={layout}
      data-compact={compactMode ? "true" : "false"}
      className={cn("app-dialog-footer shrink-0", className)}
      {...props}
    >
      <div
        ref={measureRef}
        data-slot="dialog-footer-measure"
        aria-hidden="true"
        inert=""
        className="pointer-events-none invisible absolute flex w-max flex-nowrap items-center gap-2 whitespace-nowrap"
      >
        {allActions.map((action, index) => (
          <span key={index} className="inline-flex w-max">{cloneForMeasurement(action)}</span>
        ))}
      </div>
      {layout === "wizard" && !compactMode ? (
        <>
          {cancel ? <div data-footer-cancel="true">{cancel}</div> : <span />}
          <div data-footer-actions="true" className="flex items-center justify-end gap-2">
            {actions}
          </div>
        </>
      ) : (
        <>
          {cancel ? <div data-footer-cancel="true">{cancel}</div> : null}
          {actions.length ? <div data-footer-actions="true" className="flex items-center gap-2">{actions}</div> : null}
        </>
      )}
    </div>
  )
}
