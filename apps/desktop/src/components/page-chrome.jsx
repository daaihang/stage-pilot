import { createContext, useContext, useMemo, useState } from "react";
import { Maximize2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

const PageChromeContext = createContext({ detailAction: null, setDetailAction: () => {} });

export function PageDetailTitlebarAction() {
  const { detailAction } = usePageChrome();
  if (!detailAction) return null;
  return <>
    {detailAction.onToggleExclusive && <Button type="button" data-detail-titlebar-control variant="ghost" size="icon-sm" className="shrink-0" onClick={detailAction.onToggleExclusive} aria-label={detailAction.exclusive ? "恢复详情侧栏" : "让详情独占工作区"} title={detailAction.exclusive ? "恢复详情侧栏" : "让详情独占工作区"}>
      {detailAction.exclusive ? <PanelRightOpen className="size-4" /> : <Maximize2 className="size-4" />}
    </Button>}
    <Button type="button" data-detail-titlebar-control variant="ghost" size="icon-sm" className="shrink-0" onClick={detailAction.onClose} aria-label="关闭详情面板" title="关闭详情面板"><PanelRightClose className="size-4" /></Button>
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
