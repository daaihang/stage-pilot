export const PAGE_HEADER_ACTION_MIN_INLINE_SIZE = "10.5rem";

/**
 * Selects the compact action layout from explicit action priority rather than
 * source order or button styling. `overflow` is a supporting action because
 * it is rendered as one direct menu trigger.
 */
export function resolvePageHeaderActionsLayout({ hasPrimary = false, secondaryCount = 0, hasOverflow = false } = {}) {
  const supportingCount = Math.max(0, Number(secondaryCount) || 0) + (hasOverflow ? 1 : 0);

  if (hasPrimary && supportingCount === 0) return "primary-only";
  if (!hasPrimary && supportingCount === 0) return "empty";
  if (!hasPrimary && supportingCount === 1) return "secondary-only";
  if (hasPrimary && supportingCount === 1) return "action-pair";
  if (hasPrimary) return "primary-with-secondary-grid";
  return "secondary-grid";
}
