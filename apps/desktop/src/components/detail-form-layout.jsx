import { cn } from "@/lib/utils";

function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

/**
 * Form shell with an explicit scroll boundary and a stable action area.
 * Use `parent` inside WindowDetailHost to avoid nested scrolling.
 */
export function DetailFormLayout({
  children,
  actions,
  error,
  busy = false,
  scrollBoundary = "self",
  className,
  contentClassName,
  onSubmit,
  ...props
}) {
  const message = errorText(error);
  const contentClass = cn(
    "min-h-0 min-w-0 flex-1",
    scrollBoundary === "self" && "overflow-y-auto",
    contentClassName,
  );
  return <form
    className={cn("flex min-h-full min-h-0 min-w-0 flex-col", className)}
    onSubmit={onSubmit}
    aria-busy={busy || undefined}
    {...props}
  >
    <div className={contentClass}>
      {message && <div className="mb-4 border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" aria-live="polite">{message}</div>}
      {children}
    </div>
    {actions && <div className={cn(scrollBoundary === "parent" && "sticky bottom-0 z-10")}>{actions}</div>}
  </form>;
}
