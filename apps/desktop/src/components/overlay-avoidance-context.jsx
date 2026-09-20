import { createContext, useCallback, useContext, useMemo, useState } from "react";

const defaultOverlayAvoidance = { toastHeight: 0, setToastHeight: () => {} };
const OverlayAvoidanceContext = createContext(defaultOverlayAvoidance);

function normalizeHeight(height) {
  return Number.isFinite(height) ? Math.max(0, Math.ceil(height)) : 0;
}

export function OverlayAvoidanceProvider({ children }) {
  const [toastHeight, setToastHeightState] = useState(0);
  const setToastHeight = useCallback((height) => {
    const nextHeight = normalizeHeight(height);
    setToastHeightState((current) => current === nextHeight ? current : nextHeight);
  }, []);
  const value = useMemo(() => ({ toastHeight, setToastHeight }), [toastHeight, setToastHeight]);
  return <OverlayAvoidanceContext.Provider value={value}>{children}</OverlayAvoidanceContext.Provider>;
}

export function useOverlayAvoidance() {
  return useContext(OverlayAvoidanceContext);
}
