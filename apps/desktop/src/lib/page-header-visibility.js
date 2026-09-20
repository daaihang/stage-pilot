export const ROOT_PAGE_HEADER_LEVEL = "h1";

export function shouldTrackPageHeader(headingLevel = ROOT_PAGE_HEADER_LEVEL) {
  return headingLevel === ROOT_PAGE_HEADER_LEVEL;
}

export function resolvePageHeaderVisibility(entry) {
  if (!entry) return true;
  return Boolean(entry.isIntersecting && (entry.intersectionRatio ?? 1) > 0);
}
