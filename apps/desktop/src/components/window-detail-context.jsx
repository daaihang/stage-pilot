import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { DetailSplitPane } from "@/components/detail-split-pane";

const WindowDetailContext = createContext(null);

export function WindowDetailProvider({ children, contentWidth = "standard", onModalActiveChange }) {
  const [registration, setRegistration] = useState(null);
  const [detailOpen, setDetailOpenState] = useState(false);
  const detailOpenRef = useRef(false);
  const [detailPresentation, setDetailPresentation] = useState("overlay");
  const [detailWidth, setDetailWidth] = useState(420);
  const [detailModalActive, setDetailModalActive] = useState(false);

  const registerDetail = useCallback((request) => {
    setRegistration(request);
    return () => {
      setRegistration((current) => current?.key === request.key ? null : current);
      detailOpenRef.current = false;
      setDetailOpenState(false);
      setDetailPresentation("overlay");
      setDetailModalActive(false);
      onModalActiveChange?.(false);
    };
  }, [onModalActiveChange]);

  const setDetailOpen = useCallback((nextOpen, { announce = true } = {}) => {
    const next = typeof nextOpen === "function" ? nextOpen(detailOpenRef.current) : Boolean(nextOpen);
    if (next === detailOpenRef.current) return;
    detailOpenRef.current = next;
    setDetailOpenState(next);
    if (!next) {
      setDetailPresentation("overlay");
      setDetailModalActive(false);
      onModalActiveChange?.(false);
    }
    if (announce) notify.info(next ? "已打开布局详情" : "已关闭布局详情");
  }, [onModalActiveChange]);

  const handlePresentationChange = useCallback((nextPresentation) => {
    setDetailPresentation(nextPresentation);
    const modalActive = nextPresentation === "exclusive";
    setDetailModalActive(modalActive);
    onModalActiveChange?.(modalActive);
  }, [onModalActiveChange]);

  const value = useMemo(() => ({
    contentWidth,
    registration,
    detailOpen,
    detailPresentation,
    detailWidth,
    detailModalActive,
    registerDetail,
    setDetailOpen,
    handlePresentationChange,
    setDetailPresentation,
    setDetailWidth,
  }), [contentWidth, detailModalActive, detailOpen, detailPresentation, detailWidth, handlePresentationChange, registerDetail, setDetailOpen, registration]);

  return <WindowDetailContext.Provider value={value}>{children}</WindowDetailContext.Provider>;
}

export function useWindowDetail() {
  const context = useContext(WindowDetailContext);
  if (!context) throw new Error("useWindowDetail must be used inside WindowDetailProvider");
  return context;
}

export function WindowDetailHost({ children }) {
  const { registration, contentWidth, detailOpen, setDetailOpen, handlePresentationChange, setDetailWidth } = useWindowDetail();
  return <DetailSplitPane
    open={detailOpen}
    onOpenChange={setDetailOpen}
    detail={registration?.getDetail?.()}
    storageKey={registration?.storageKey}
    triggerRef={registration?.triggerRef}
    onDetailWidthChange={setDetailWidth}
    onPresentationChange={handlePresentationChange}
    detailLabel={registration?.detailLabel || "详情"}
    contentWidth={contentWidth}
  >{children}</DetailSplitPane>;
}
