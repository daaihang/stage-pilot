export const ROOT_PAGE_HEADER_LEVEL = "h1";

export function shouldTrackPageHeader(headingLevel = ROOT_PAGE_HEADER_LEVEL) {
  return headingLevel === ROOT_PAGE_HEADER_LEVEL;
}

export function resolvePageHeaderVisibility(entry) {
  if (!entry) return true;
  return Boolean(entry.isIntersecting && (entry.intersectionRatio ?? 1) > 0);
}

/**
 * Geometry is the authoritative path for fast scrolling. IntersectionObserver
 * remains useful as a wake-up signal, but can coalesce across a quick jump.
 */
export function resolvePageHeaderVisibilityFromRects(headerRect, scrollRootRect) {
  if (!headerRect || !scrollRootRect) return true;
  return headerRect.bottom > scrollRootRect.top && headerRect.top < scrollRootRect.bottom;
}
