export function shouldShowFloatingPrimary({ enabled = false, pageHeaderVisible = true, hasHost = false } = {}) {
  return Boolean(enabled && !pageHeaderVisible && hasHost);
}
