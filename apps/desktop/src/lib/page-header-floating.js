export function shouldShowFloatingPrimary({ enabled = false, pageHeaderVisible = true, hasHost = false } = {}) {
  return Boolean(enabled && !pageHeaderVisible && hasHost);
}

export function resolveFloatingPrimaryState({ enabled = false, pageHeaderVisible = true, hasHost = false } = {}) {
  const mounted = Boolean(enabled && hasHost);
  return {
    mounted,
    open: mounted && !pageHeaderVisible,
    inert: !mounted || pageHeaderVisible,
  };
}
