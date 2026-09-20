export function normalizeTitlebarItems(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

export function areTitlebarItemsEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;

  return left.every((item, index) => {
    const other = right[index];
    return item?.label === other?.label && item?.to === other?.to && item?.current === other?.current;
  });
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
    return { kind: "breadcrumb", label: "" };
  }

  if (pageHeaderVisible && normalizedItems.length) {
    return showTitle
      ? { kind: "breadcrumb", label: "" }
      : { kind: "empty", label: "" };
  }

  if (!showTitle) return { kind: "empty", label: "" };
  if (titlebarTitleMode === "app") return { kind: "title", label: appTitle };
  return pageTitle ? { kind: "title", label: pageTitle } : { kind: "empty", label: "" };
}
