import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";

/**
 * Shared async leave guard. A guard is intentionally imperative: callers can
 * flush a draft, confirm a destructive transition, or wait for an in-flight
 * mutation before the deterministic destination is entered.
 */
export function useBeforePageLeave(guard) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const guardRef = useRef(guard);
  guardRef.current = guard;

  const run = useCallback(async () => {
    if (!guardRef.current) return true;
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      return (await guardRef.current()) !== false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}

/**
 * Shared page-level back control. Keep this separate from the titlebar
 * breadcrumbs (location) and the window-detail close action (surface state).
 *
 * `onBeforeNavigate` is an optional async guard. Returning `false` means the
 * callback handled the transition itself; every other result continues to the
 * deterministic `to` target. This makes async save guards safe by default.
 */
export function AppBackLink({
  to,
  label = "返回",
  onBeforeNavigate,
  replace = false,
  preventScrollReset = false,
  className = "-ml-2",
}) {
  const navigate = useNavigate();
  const { busy, run: runBeforeNavigate } = useBeforePageLeave(onBeforeNavigate);

  const handleClick = async (event) => {
    // Preserve normal anchor semantics for modified clicks and non-primary
    // buttons (open in a new tab, copy link, etc.).
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!onBeforeNavigate) return;

    event.preventDefault();
    try {
      const canNavigate = await runBeforeNavigate();
      if (canNavigate !== false) navigate(to, { replace, preventScrollReset });
    } catch (error) {
      notify.error("无法离开当前页面", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      aria-label={label}
      nativeButton={false}
      render={<Link to={to} replace={replace} onClick={handleClick} />}
    >
      <ArrowLeft aria-hidden="true" />
      {busy ? "处理中…" : label}
    </Button>
  );
}

export const PageBackButton = AppBackLink;
