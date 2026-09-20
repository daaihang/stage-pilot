export const TITLEBAR_CENTER_MIN_INLINE_SIZE = 96;
export const TITLEBAR_MENU_COMPACT_THRESHOLD = 14 * 16;
export const TITLEBAR_MENU_EXPAND_THRESHOLD = 16 * 16;

function finite(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Reserves equally-sized collision zones on both sides of the physical window
 * centre. This keeps title content centred in the window, never merely in the
 * remaining flex space beside the left controls.
 */
export function resolveTitlebarCenterBounds({ width = 0, leftEnd = 0, rightStart = width } = {}) {
  const headerWidth = finite(width);
  const left = Math.min(headerWidth, finite(leftEnd));
  const right = Math.min(headerWidth, Math.max(left, finite(rightStart)));
  const sideReservation = Math.max(left, headerWidth - right);
  const inlineStart = Math.min(headerWidth, sideReservation);
  const inlineEnd = Math.max(inlineStart, headerWidth - sideReservation);
  const inlineSize = inlineEnd - inlineStart;

  return {
    inlineStart,
    inlineSize,
    visible: inlineSize >= TITLEBAR_CENTER_MIN_INLINE_SIZE,
  };
}

/**
 * Keeps a deliberate hysteresis band while the user resizes the window, so a
 * full menu does not flicker in and out around a single width boundary.
 */
export function resolveTitlebarMenuMode({ mode = "full", fullMenuCenterWidth = 0 } = {}) {
  const available = finite(fullMenuCenterWidth);
  if (mode === "compact") {
    return available >= TITLEBAR_MENU_EXPAND_THRESHOLD ? "full" : "compact";
  }
  return available < TITLEBAR_MENU_COMPACT_THRESHOLD ? "compact" : "full";
}
