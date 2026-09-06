export const DETAIL_OPEN_MODES = Object.freeze(["inline", "exclusive"]);

export function normalizeDetailOpenMode(value) {
  // `overlay` was the original persisted value for the wide-screen modal
  // preference. Keep reading it as `exclusive` so existing accounts migrate
  // safely while the runtime-only narrow presentation remains `overlay`.
  return value === "exclusive" || value === "overlay" ? "exclusive" : "inline";
}

export function resolveDetailPresentation({
  open,
  measured,
  containerWidth,
  preferredMode = "inline",
  exclusive = false,
  inlineMinWidth = 960,
}) {
  if (!open || !measured || containerWidth <= 0) return null;
  if (containerWidth >= inlineMinWidth) {
    if (exclusive || normalizeDetailOpenMode(preferredMode) === "exclusive") return "exclusive";
    return "inline";
  }
  return "overlay";
}
