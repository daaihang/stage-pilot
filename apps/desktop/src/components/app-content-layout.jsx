import { cn } from "@/lib/utils";

/**
 * Owns the scroll boundary below the application titlebar.
 *
 * Document and workspace pages share the same centred content canvas. Workspace
 * pages additionally provide a full-height main-area scroll boundary so the
 * window detail host can keep the detail surface independently scrollable.
 */
const contentWidthClassName = {
  standard: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};

export function AppContentLayout({ mode = "document", contentWidth = "standard", children, className }) {
  if (mode === "workspace") {
    return <div className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", className)}>
      <div className="app-content-scroll h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 md:p-6">
        <div className={cn("mx-auto min-h-full min-w-0 w-full", contentWidthClassName[contentWidth] ?? contentWidthClassName.standard)}>{children}</div>
      </div>
    </div>;
  }

  return <div className={cn("app-content-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6", className)}>
    <div className={cn("mx-auto min-h-full min-w-0 w-full", contentWidthClassName[contentWidth] ?? contentWidthClassName.standard)}>{children}</div>
  </div>;
}
