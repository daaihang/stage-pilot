import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Maximize2, PanelRightOpen, X } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getDetailActionLabels } from "@/lib/detail-action-labels";

const defaultPageChromeContext = {
  detailAction: null,
  setDetailAction: () => {},
  pageHeaderVisible: true,
  registerPageHeader: () => () => {},
  reportPageHeaderVisibility: () => {},
};
const PageChromeContext = createContext(defaultPageChromeContext);

export function PageDetailTitlebarAction() {
  const { detailAction } = usePageChrome();
  if (!detailAction) return null;
  const labels = getDetailActionLabels({ presentation: detailAction.presentation, detailLabel: detailAction.detailLabel });
  const toggleLabel = labels.toggle;
  const toggleIcon = detailAction.exclusive ? <PanelRightOpen className="size-4" /> : <Maximize2 className="size-4" />;
  const closeIcon = <X className="size-4" />;
  return <>
    <span className="hidden max-w-32 shrink truncate text-xs text-muted-foreground lg:inline" title={detailAction.detailLabel} aria-hidden="true">{detailAction.detailLabel}</span>
    {detailAction.onToggleExclusive && labels.canToggle && <Tooltip>
      <TooltipTrigger render={<Button type="button" data-detail-titlebar-control variant="ghost" size="icon-sm" className="shrink-0" onClick={detailAction.onToggleExclusive} aria-label={toggleLabel} title={toggleLabel}>{toggleIcon}</Button>} />
      <TooltipContent side="bottom" sideOffset={6}>{toggleLabel}</TooltipContent>
    </Tooltip>}
    <Tooltip>
      <TooltipTrigger render={<Button type="button" data-detail-titlebar-control variant="ghost" size="icon-sm" className="shrink-0" onClick={detailAction.onClose} aria-label={labels.close} title={labels.close}>{closeIcon}</Button>} />
      <TooltipContent side="bottom" sideOffset={6}>{labels.close}</TooltipContent>
    </Tooltip>
  </>;
}

export function PageChromeProvider({ children }) {
  const [detailAction, setDetailAction] = useState(null);
  const [pageHeaderVisible, setPageHeaderVisible] = useState(true);
  const activePageHeaderIdRef = useRef(null);
  const registerPageHeader = useCallback((id) => {
    activePageHeaderIdRef.current = id;
    setPageHeaderVisible(true);
    return () => {
      if (activePageHeaderIdRef.current !== id) return;
      activePageHeaderIdRef.current = null;
      setPageHeaderVisible(true);
    };
  }, []);
  const reportPageHeaderVisibility = useCallback((id, visible) => {
    if (activePageHeaderIdRef.current === id) setPageHeaderVisible(Boolean(visible));
  }, []);
  const value = useMemo(() => ({
    detailAction,
    setDetailAction,
    pageHeaderVisible,
    registerPageHeader,
    reportPageHeaderVisibility,
  }), [detailAction, pageHeaderVisible, registerPageHeader, reportPageHeaderVisibility]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

export function usePageChrome() {
  return useContext(PageChromeContext);
}
