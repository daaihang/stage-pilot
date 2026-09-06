export const DETAIL_OPEN_MODES = Object.freeze(["inline", "exclusive"]);
export const DETAIL_LAYOUT_MODES = Object.freeze(["wide", "narrow"]);
export const DETAIL_LAYOUT_BREAKPOINTS = Object.freeze({
  wideEnter: 992,
  narrowEnter: 928,
  initialWide: 960,
});

export function normalizeDetailOpenMode(value) {
  // `overlay` was the original persisted value for the wide-screen modal
  // preference. Keep reading it as `exclusive` so existing accounts migrate
  // safely while the runtime-only narrow presentation remains `overlay`.
  return value === "exclusive" || value === "overlay" ? "exclusive" : "inline";
}

export function resolveDetailLayoutMode(width, previousMode = null) {
  const numericWidth = Number(width);
  if (!Number.isFinite(numericWidth) || numericWidth <= 0) return null;
  if (previousMode === "wide") return numericWidth <= DETAIL_LAYOUT_BREAKPOINTS.narrowEnter ? "narrow" : "wide";
  if (previousMode === "narrow") return numericWidth >= DETAIL_LAYOUT_BREAKPOINTS.wideEnter ? "wide" : "narrow";
  return numericWidth >= DETAIL_LAYOUT_BREAKPOINTS.initialWide ? "wide" : "narrow";
}

export function resolveRestoredDetailMode({ savedMode, activeMode, preferredMode } = {}) {
  return normalizeDetailOpenMode(savedMode || activeMode || preferredMode);
}

export function resolveDetailPresentation({
  open,
  measured,
  containerWidth,
  layoutMode = null,
  preferredMode = "inline",
  exclusive = false,
  inlineMinWidth = 960,
}) {
  if (!open || !measured || containerWidth <= 0) return null;
  const resolvedLayoutMode = DETAIL_LAYOUT_MODES.includes(layoutMode)
    ? layoutMode
    : containerWidth >= inlineMinWidth ? "wide" : "narrow";
  if (resolvedLayoutMode === "wide") {
    if (exclusive || normalizeDetailOpenMode(preferredMode) === "exclusive") return "exclusive";
    return "inline";
  }
  return "overlay";
}
