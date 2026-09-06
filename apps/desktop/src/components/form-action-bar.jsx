import { Button } from "@/components/ui/button";
import { RiLoader4Line } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

/**
 * Shared submit/cancel actions for forms. The DOM order intentionally keeps
 * the primary action first on narrow screens, while the responsive footer
 * retains the conventional cancel-then-submit order on wider screens.
 */
export function FormActionBar({
  cancelLabel = "取消",
  submitLabel = "保存",
  busyLabel = "保存中…",
  busy = false,
  disabled = false,
  onCancel,
  submitType = "submit",
  variant = "default",
  error,
  children,
  className,
}) {
  const message = errorText(error);
  return <div
    className={cn(
      "form-action-bar flex shrink-0 flex-col-reverse gap-2 border-t bg-background/95 p-4 supports-[backdrop-filter]:backdrop-blur-sm sm:flex-row sm:justify-end",
      className,
    )}
    aria-busy={busy || undefined}
  >
    {message && <p className="mr-auto text-xs text-destructive sm:self-center" role="alert" aria-live="polite">{message}</p>}
    {children || <>
      {onCancel && <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>}
      <Button type={submitType} variant={variant} disabled={disabled || busy}>
        {busy && <RiLoader4Line className="motion-safe:animate-spin" />}
        {busy ? busyLabel : submitLabel}
      </Button>
    </>}
  </div>;
}
