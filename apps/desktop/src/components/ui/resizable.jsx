import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";

export function StageResizableGroup({ className, ...props }) {
  return <ResizablePrimitive.PanelGroup data-slot="stage-resizable-group" className={cn("flex h-full w-full aria-[data-panel-group-direction=vertical]:flex-col", className)} {...props} />;
}

export function StageResizablePanel({ className, ...props }) {
  return <ResizablePrimitive.Panel data-slot="stage-resizable-panel" className={cn("min-h-0 min-w-0", className)} {...props} />;
}

export function StageResizableHandle({ withHandle = false, className, children, ...props }) {
  return <ResizablePrimitive.PanelResizeHandle data-slot="stage-resizable-handle" className={cn("group/stage-resize relative z-10 flex w-px shrink-0 touch-none items-center justify-center bg-border outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none data-[resize-handle-active]:bg-primary aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-3 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2", className)} {...props}>{withHandle ? <div className="z-10 h-6 w-1 shrink-0 rounded-full bg-border" /> : children}</ResizablePrimitive.PanelResizeHandle>;
}
