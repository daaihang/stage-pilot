/**
 * Resolves the visible heading independently from the resource label used by
 * filters and accessible search labels. Nested lists can therefore keep their
 * resource vocabulary without restating the page title.
 */
export function resolveResourcePageHeader({ title, headerTitle, headerMode = "standalone" } = {}) {
  return {
    showHeader: headerMode !== "none",
    title: headerTitle || title,
  };
}
