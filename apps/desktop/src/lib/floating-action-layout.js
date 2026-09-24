function dimension(value) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

export function resolveFloatingActionAnchor({ layoutRect, anchorRect } = {}) {
  if (!layoutRect || !anchorRect) return { inlineStart: 0, inlineSize: 0 };
  const layoutWidth = dimension(layoutRect.width);
  const inlineStart = Math.min(layoutWidth, Math.max(0, Math.round(anchorRect.left - layoutRect.left)));
  return {
    inlineStart,
    inlineSize: Math.max(0, Math.round(Math.min(anchorRect.width, layoutWidth - inlineStart))),
  };
}

export function resolveContentEndInSafeZone({ rootRect, sentinelRect, bottomClearance = 0 } = {}) {
  if (!rootRect || !sentinelRect) return false;
  const safeBottom = rootRect.bottom - dimension(bottomClearance);
  return sentinelRect.top <= safeBottom && sentinelRect.bottom > rootRect.top;
}

export function resolveFloatingActionPresentation({
  open = false,
  contentEndInSafeZone = false,
  expandAtContentEnd = true,
  compactWidth = 0,
  anchorWidth = 0,
} = {}) {
  const compactInlineSize = dimension(compactWidth);
  const expandedInlineSize = dimension(anchorWidth);
  const canExpand = compactInlineSize > 0 && expandedInlineSize > 0;
  const expanded = Boolean(open && expandAtContentEnd && contentEndInSafeZone && canExpand);
  return {
    expanded,
    compactInlineSize: compactInlineSize || null,
    inlineSize: expanded ? expandedInlineSize : compactInlineSize || null,
  };
}
