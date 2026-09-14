import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

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
  const [busy, setBusy] = useState(false);

  const handleClick = async (event) => {
    // Preserve normal anchor semantics for modified clicks and non-primary
    // buttons (open in a new tab, copy link, etc.).
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!onBeforeNavigate) return;

    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const canNavigate = await onBeforeNavigate();
      if (canNavigate !== false) navigate(to, { replace, preventScrollReset });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={busy}
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
