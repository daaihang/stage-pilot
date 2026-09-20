export const FLOATING_ACTION_GAP = 16;
export const TOAST_CONTENT_GAP = 8;

function dimension(value) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

export function resolveOverlayLayout({
  toastHeight = 0,
  floatingActionHeight = 0,
  floatingActionOpen = false,
  bottomBarHeight = 0,
} = {}) {
  const toast = dimension(toastHeight);
  const action = dimension(floatingActionHeight);
  const bottomBar = dimension(bottomBarHeight);
  const floatingActionBottom = bottomBar + toast + FLOATING_ACTION_GAP;
  const overlayClearance = floatingActionOpen && action > 0
    ? toast + FLOATING_ACTION_GAP + action
    : toast > 0
      ? toast + TOAST_CONTENT_GAP
      : 0;

  return { floatingActionBottom, overlayClearance };
}
