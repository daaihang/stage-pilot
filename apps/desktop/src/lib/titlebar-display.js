export function normalizeTitlebarItems(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

export function resolveTitlebarDisplay({
  pageHeaderVisible = true,
  showTitle = true,
  titlebarTitleMode = "page",
  pageTitle = "",
  appTitle = "StagePilot",
  items = [],
  expanded = false,
} = {}) {
  const normalizedItems = normalizeTitlebarItems(items);
  if (expanded && normalizedItems.length) {
    return { kind: "breadcrumb", items: normalizedItems, label: "" };
  }

  if (pageHeaderVisible && normalizedItems.length) {
    return showTitle
      ? { kind: "breadcrumb", items: normalizedItems, label: "" }
      : { kind: "empty", items: [], label: "" };
  }

  if (!showTitle) return { kind: "empty", items: [], label: "" };
  if (titlebarTitleMode === "app") return { kind: "title", items: [], label: appTitle };
  return pageTitle ? { kind: "title", items: [], label: pageTitle } : { kind: "empty", items: [], label: "" };
}
