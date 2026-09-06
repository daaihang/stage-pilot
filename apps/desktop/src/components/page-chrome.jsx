import { createContext, useContext, useMemo, useState } from "react";
import { Maximize2, PanelRightOpen, X } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getDetailActionLabels } from "@/lib/detail-action-labels";

const PageChromeContext = createContext({ detailAction: null, setDetailAction: () => {} });

export function PageDetailTitlebarAction() {
  const { detailAction } = usePageChrome();
  if (!detailAction) return null;
  const labels = getDetailActionLabels({ presentation: detailAction.presentation, detailLabel: detailAction.detailLabel });
  const toggleLabel = labels.toggle;
  const toggleIcon = detailAction.exclusive ? <PanelRightOpen className="size-4" /> : <Maximize2 className="size-4" />;
  const closeIcon = <X className="size-4" />;
  return <>
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
  const value = useMemo(() => ({ detailAction, setDetailAction }), [detailAction]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

export function usePageChrome() {
  return useContext(PageChromeContext);
}
