export const DIALOG_SIZE_WIDTHS = Object.freeze({
  sm: "24rem",
  md: "32rem",
  lg: "42rem",
  xl: "52rem",
});

export const DIALOG_FORM_GRID_MIN_COLUMN_REM = 14;
export const DIALOG_FORM_GRID_GAP_REM = 0.75;
export const DIALOG_FORM_GRID_MIN_WIDTH_REM =
  DIALOG_FORM_GRID_MIN_COLUMN_REM * 2 + DIALOG_FORM_GRID_GAP_REM;

export function resolveDialogSize(size, fallback = "md") {
  return Object.hasOwn(DIALOG_SIZE_WIDTHS, size) ? size : fallback;
}

export function calculateModalViewport({
  viewportHeight,
  titlebarVisible = true,
  titlebarHeight = 36,
  safeAreaTop = 0,
  safeAreaBottom = 0,
  gutter = 16,
  viewportGutterRatio = 0.04,
} = {}) {
  const height = Math.max(0, Number(viewportHeight) || 0);
  const topInset = titlebarVisible
    ? Math.max(0, Number(titlebarHeight) || 0)
    : Math.max(0, Number(safeAreaTop) || 0);
  const bottomInset = Math.max(0, Number(safeAreaBottom) || 0);
  const hostHeight = Math.max(0, height - topInset - bottomInset);
  const responsiveGutter = Math.min(
    Math.max(0, Number(gutter) || 0),
    height * Math.max(0, Number(viewportGutterRatio) || 0),
  );

  return {
    topInset,
    bottomInset,
    hostHeight,
    gutter: responsiveGutter,
    maxContentHeight: Math.max(0, hostHeight - responsiveGutter * 2),
  };
}

export function resolveDialogFormGridColumns(
  containerWidth,
  { minColumnWidth = 224, gap = 12 } = {},
) {
  return Number(containerWidth) >= minColumnWidth * 2 + gap ? 2 : 1;
}

export function pushModalDialog(stack, id) {
  return [...stack.filter((currentId) => currentId !== id), id];
}

export function removeModalDialog(stack, id) {
  return stack.filter((currentId) => currentId !== id);
}
