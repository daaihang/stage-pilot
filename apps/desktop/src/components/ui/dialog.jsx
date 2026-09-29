import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RiCloseLine } from "@/components/ui/icons"
import { ModalDialogScopeContext, useAppModalLayer, useTrackedDialogState } from "@/components/modal-layer-context"
import { useModalBodyClearance } from "@/components/modal-body-clearance"

const dialogSizes = { sm: "24rem", md: "32rem", lg: "42rem", xl: "52rem" }

function Dialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  modal: _modal,
  disablePointerDismissal: _disablePointerDismissal,
  ...props
}) {
  const { open, handleOpenChange, isTop } = useTrackedDialogState({ open: openProp, defaultOpen, onOpenChange })
  const requestClose = React.useCallback(() => handleOpenChange(false), [handleOpenChange])
  return (
    <ModalDialogScopeContext.Provider value={{ requestClose, isTop }}>
      <DialogPrimitive.Root
        data-slot="dialog"
        open={open}
        onOpenChange={handleOpenChange}
        modal={false}
        disablePointerDismissal
        {...props}
      />
    </ModalDialogScopeContext.Provider>
  )
}

function DialogTrigger({
  ...props
}) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  container,
  ...props
}) {
  const { hostRef } = useAppModalLayer()
  return <DialogPrimitive.Portal data-slot="dialog-portal" container={container ?? hostRef ?? undefined} {...props} />
}

function DialogClose({
  ...props
}) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  onPointerDown,
  ...props
}) {
  const { requestClose, isTop } = React.useContext(ModalDialogScopeContext)
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      data-modal-top={isTop ? "true" : "false"}
      hidden={!isTop}
      className={cn(
        "absolute inset-0 isolate bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (!event.defaultPrevented && event.target === event.currentTarget) requestClose?.()
      }}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "md",
  style,
  ...props
}) {
  const normalizedSize = dialogSizes[size] ? size : "md"
  const { isTop } = React.useContext(ModalDialogScopeContext)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-modal-top={isTop ? "true" : "false"}
        inert={!isTop ? "" : undefined}
        aria-hidden={!isTop || undefined}
        className={cn(
          "app-dialog-content absolute top-1/2 left-1/2 z-10 flex min-h-0 -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-none bg-popover p-4 text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:zoom-out-95",
          className
        )}
        style={{ ...style, "--app-dialog-max-width": dialogSizes[normalizedSize] }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <RiCloseLine
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-1 text-left", className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }) {
  const bodyRef = useModalBodyClearance()
  return <div ref={bodyRef} data-slot="dialog-body" className={cn("app-dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto", className)} {...props} />
}

function DialogFormGrid({ className, ...props }) {
  return <div data-slot="dialog-form-grid" className={cn("app-dialog-form-grid grid min-w-0 gap-3", className)} {...props} />
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-sm font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFormGrid,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
