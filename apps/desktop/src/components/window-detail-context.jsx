import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { DetailSplitPane } from "@/components/detail-split-pane";
import { normalizeDetailOpenMode } from "@/lib/detail-open-mode";

const WindowDetailContext = createContext(null);

export function WindowDetailProvider({ children, contentWidth = "standard", detailOpenMode = "inline" }) {
  const normalizedDetailOpenMode = normalizeDetailOpenMode(detailOpenMode);
  const [registration, setRegistration] = useState(null);
  const registrationRef = useRef(null);
  const [detailOpen, setDetailOpenState] = useState(false);
  const detailOpenRef = useRef(false);
  const [detailPresentation, setDetailPresentation] = useState("overlay");
  const [detailWidth, setDetailWidth] = useState(420);
  const [detailRevision, setDetailRevision] = useState(0);

  const registerDetail = useCallback((request) => {
    registrationRef.current = request;
    setRegistration(request);
    return () => {
      if (registrationRef.current !== request) return;
      registrationRef.current = null;
      setRegistration(null);
      detailOpenRef.current = false;
      setDetailOpenState(false);
      setDetailPresentation("overlay");
    };
  }, []);

  const setDetailOpen = useCallback((nextOpen, { announce = true } = {}) => {
    const next = typeof nextOpen === "function" ? nextOpen(detailOpenRef.current) : Boolean(nextOpen);
    if (next === detailOpenRef.current) return;
    detailOpenRef.current = next;
    setDetailOpenState(next);
    if (!next) {
      registrationRef.current?.onClose?.();
      setDetailPresentation("overlay");
    }
    if (announce) notify.info(next ? "已打开布局详情" : "已关闭布局详情");
  }, []);

  const handlePresentationChange = useCallback((nextPresentation) => {
    setDetailPresentation(nextPresentation);
  }, []);

  const refreshDetail = useCallback((key) => {
    if (key && registrationRef.current?.key !== key) return;
    setDetailRevision((current) => current + 1);
  }, []);

  const value = useMemo(() => ({
    contentWidth,
    detailOpenMode: normalizedDetailOpenMode,
    registration,
    detailOpen,
    detailPresentation,
    detailWidth,
    detailRevision,
    registerDetail,
    refreshDetail,
    setDetailOpen,
    handlePresentationChange,
    setDetailPresentation,
    setDetailWidth,
  }), [contentWidth, detailOpen, detailOpenMode, detailPresentation, detailRevision, detailWidth, handlePresentationChange, normalizedDetailOpenMode, refreshDetail, registerDetail, setDetailOpen, registration]);

  return <WindowDetailContext.Provider value={value}>{children}</WindowDetailContext.Provider>;
}

/**
 * Registers one stable detail surface while allowing its rendered content to
 * change without tearing down the window-level open state. The callback is
 * kept in a ref so callers can safely depend on their selected item and local
 * data without causing registerDetail cleanup/re-registration churn.
 */
export function useWindowDetailRegistration({ key, storageKey, detailLabel, triggerRef, getDetail, onClose }) {
  const { registerDetail, refreshDetail, detailRevision } = useWindowDetail();
  const requestRef = useRef({ getDetail, onClose });
  const lastGetDetailRef = useRef(getDetail);
  const lastRevisionRef = useRef(detailRevision);
  requestRef.current = { getDetail, onClose };

  useEffect(() => registerDetail({
    key,
    storageKey,
    detailLabel,
    triggerRef,
    getDetail: (...args) => requestRef.current.getDetail?.(...args),
    onClose: (...args) => requestRef.current.onClose?.(...args),
  }), [detailLabel, key, registerDetail, storageKey, triggerRef]);

  useEffect(() => {
    const callbackChanged = lastGetDetailRef.current !== getDetail;
    const revisionChanged = lastRevisionRef.current !== detailRevision;
    lastGetDetailRef.current = getDetail;
    lastRevisionRef.current = detailRevision;
    // A provider revision already caused the host to render the latest
    // callback. Do not schedule another revision just because a caller uses
    // an inline callback and therefore receives a fresh function identity.
    if (!callbackChanged || revisionChanged) return;
    refreshDetail(key);
  }, [detailRevision, getDetail, key, refreshDetail]);
}

export function useWindowDetail() {
  const context = useContext(WindowDetailContext);
  if (!context) throw new Error("useWindowDetail must be used inside WindowDetailProvider");
  return context;
}

/**
 * Optional counterpart for small presentational adapters that can also be
 * rendered in an isolated preview or fallback tree. Detail registrations
 * should still use useWindowDetailRegistration (and therefore require the
 * provider), but callers can use this hook to avoid crashing when the
 * surrounding shell is not mounted yet (for example during HMR or a
 * standalone preview).
 */
export function useOptionalWindowDetail() {
  return useContext(WindowDetailContext);
}

export function WindowDetailHost({ children }) {
  const { registration, detailRevision, contentWidth, detailOpen, detailOpenMode, setDetailOpen, handlePresentationChange, setDetailWidth } = useWindowDetail();
  void detailRevision;
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
    detailOpenMode={detailOpenMode}
  >{children}</DetailSplitPane>;
}
