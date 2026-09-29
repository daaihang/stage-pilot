import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ModalDialogScopeContext, useAppModalLayer, useTrackedDialogState } from "@/components/modal-layer-context"
import { useModalBodyClearance } from "@/components/modal-body-clearance"

const alertDialogSizes = { sm: "24rem", md: "32rem", lg: "42rem", xl: "52rem" }

function AlertDialog({ open: openProp, defaultOpen, onOpenChange, modal: _modal, disablePointerDismissal: _disablePointerDismissal, ...props }) {
  const { open, handleOpenChange, isTop } = useTrackedDialogState({ open: openProp, defaultOpen, onOpenChange })
  return (
    <ModalDialogScopeContext.Provider value={{ isTop, requestClose: () => {} }}>
      <DialogPrimitive.Root
        data-slot="alert-dialog"
        open={open}
        onOpenChange={handleOpenChange}
        modal={false}
        disablePointerDismissal
        {...props}
      />
    </ModalDialogScopeContext.Provider>
  )
}

function AlertDialogTrigger({ ...props }) {
  return <DialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal({ container, ...props }) {
  const { hostRef } = useAppModalLayer()
  return <DialogPrimitive.Portal data-slot="alert-dialog-portal" container={container ?? hostRef ?? undefined} {...props} />
}

function AlertDialogOverlay({ className, ...props }) {
  const { isTop } = React.useContext(ModalDialogScopeContext)
  return (
    <DialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      data-modal-top={isTop ? "true" : "false"}
      hidden={!isTop}
      className={cn(
        "absolute inset-0 isolate bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogContent({ className, children, size = "sm", style, ...props }) {
  const normalizedSize = alertDialogSizes[size] ? size : "sm"
  const { isTop } = React.useContext(ModalDialogScopeContext)
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <DialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-modal-top={isTop ? "true" : "false"}
        role="alertdialog"
        inert={!isTop ? "" : undefined}
        aria-hidden={!isTop || undefined}
        className={cn(
          "app-dialog-content absolute top-1/2 left-1/2 z-10 flex min-h-0 -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-none bg-popover p-4 text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:zoom-out-95",
          className,
        )}
        style={{ ...style, "--app-dialog-max-width": alertDialogSizes[normalizedSize] }}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }) {
  return <div data-slot="alert-dialog-header" className={cn("flex shrink-0 flex-col gap-1 text-left", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }) {
  return <div data-slot="alert-dialog-footer" className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function AlertDialogBody({ className, ...props }) {
  const bodyRef = useModalBodyClearance()
  return <div ref={bodyRef} data-slot="alert-dialog-body" className={cn("app-dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto", className)} {...props} />
}

function AlertDialogTitle({ className, ...props }) {
  return <DialogPrimitive.Title data-slot="alert-dialog-title" className={cn("font-heading text-sm font-medium", className)} {...props} />
}

function AlertDialogDescription({ className, ...props }) {
  return <DialogPrimitive.Description data-slot="alert-dialog-description" className={cn("text-xs/relaxed text-muted-foreground", className)} {...props} />
}

function AlertDialogCancel({ className, ...props }) {
  return <DialogPrimitive.Close data-slot="alert-dialog-cancel" render={<Button variant="outline" className={className} />} {...props} />
}

function AlertDialogAction({ className, variant = "default", ...props }) {
  return <DialogPrimitive.Close data-slot="alert-dialog-action" render={<Button variant={variant} className={className} />} {...props} />
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
