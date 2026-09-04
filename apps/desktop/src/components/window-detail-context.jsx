import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { DetailSplitPane } from "@/components/detail-split-pane";

const WindowDetailContext = createContext(null);

export function WindowDetailProvider({ children, contentWidth = "standard" }) {
  const [registration, setRegistration] = useState(null);
  const [detailOpen, setDetailOpenState] = useState(false);
  const detailOpenRef = useRef(false);
  const [detailPresentation, setDetailPresentation] = useState("overlay");
  const [detailWidth, setDetailWidth] = useState(420);

  const registerDetail = useCallback((request) => {
    setRegistration(request);
    return () => {
      setRegistration((current) => current?.key === request.key ? null : current);
      detailOpenRef.current = false;
      setDetailOpenState(false);
    };
  }, []);

  const setDetailOpen = useCallback((nextOpen, { announce = true } = {}) => {
    const next = typeof nextOpen === "function" ? nextOpen(detailOpenRef.current) : Boolean(nextOpen);
    if (next === detailOpenRef.current) return;
    detailOpenRef.current = next;
    setDetailOpenState(next);
    if (announce) notify.info(next ? "已打开布局详情" : "已关闭布局详情");
  }, []);

  const value = useMemo(() => ({
    contentWidth,
    registration,
    detailOpen,
    detailPresentation,
    detailWidth,
    registerDetail,
    setDetailOpen,
    setDetailPresentation,
    setDetailWidth,
  }), [contentWidth, detailOpen, detailPresentation, detailWidth, registerDetail, setDetailOpen, registration]);

  return <WindowDetailContext.Provider value={value}>{children}</WindowDetailContext.Provider>;
}

export function useWindowDetail() {
  const context = useContext(WindowDetailContext);
  if (!context) throw new Error("useWindowDetail must be used inside WindowDetailProvider");
  return context;
}

export function WindowDetailHost({ children }) {
  const { registration, contentWidth, detailOpen, setDetailOpen, setDetailPresentation, setDetailWidth } = useWindowDetail();
  return <DetailSplitPane
    open={detailOpen}
    onOpenChange={setDetailOpen}
    detail={registration?.getDetail?.()}
    storageKey={registration?.storageKey}
    triggerRef={registration?.triggerRef}
    onDetailWidthChange={setDetailWidth}
    onPresentationChange={setDetailPresentation}
    contentWidth={contentWidth}
  >{children}</DetailSplitPane>;
}
