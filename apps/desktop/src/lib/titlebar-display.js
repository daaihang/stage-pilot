export function resolveCompactBreadcrumbItems(items = []) {
  const normalized = Array.isArray(items) ? items.filter(Boolean) : [];
  return normalized.length > 2 ? normalized.slice(-2) : normalized;
}

export function resolveTitlebarDefault({
  pageHeaderVisible = true,
  showTitle = true,
  pageTitle = "",
  items = [],
} = {}) {
  if (!showTitle) return { mode: "empty", label: "", items: [] };
  if (pageHeaderVisible) {
    const compactItems = resolveCompactBreadcrumbItems(items);
    return compactItems.length ? { mode: "compact-breadcrumb", label: "", items: compactItems } : { mode: "empty", label: "", items: [] };
  }
  return pageTitle ? { mode: "title", label: pageTitle, items: [] } : { mode: "empty", label: "", items: [] };
}
