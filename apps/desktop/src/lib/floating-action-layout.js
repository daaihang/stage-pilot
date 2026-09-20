export function resolveFloatingActionPresentation({ open = false, contentEndVisible = false, compactWidth = 0 } = {}) {
  const canExpand = Number.isFinite(compactWidth) && compactWidth > 0;
  return {
    expanded: Boolean(open && contentEndVisible && canExpand),
    compactWidth: canExpand ? compactWidth : null,
  };
}
