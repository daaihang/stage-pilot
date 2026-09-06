export const DETAIL_OPEN_MODES = Object.freeze(["inline", "overlay"]);

export function normalizeDetailOpenMode(value) {
  return value === "overlay" ? "overlay" : "inline";
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
  if (exclusive && containerWidth >= inlineMinWidth) return "exclusive";
  if (containerWidth >= inlineMinWidth && normalizeDetailOpenMode(preferredMode) === "inline") return "inline";
  return "overlay";
}
