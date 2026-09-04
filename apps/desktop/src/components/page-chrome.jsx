import { createContext, useContext, useMemo, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const PageChromeContext = createContext({ detailAction: null, setDetailAction: () => {} });

export function PageDetailTitlebarAction() {
  const { detailAction } = usePageChrome();
  if (!detailAction) return null;
  return <>
    {detailAction.onToggleExclusive && <Button variant="ghost" size="icon-sm" className="h-full w-[38px]" onClick={detailAction.onToggleExclusive} aria-label={detailAction.exclusive ? "退出独占详情" : "独占详情"} title={detailAction.exclusive ? "退出独占详情" : "独占详情（详情接管工作区）"}>
      {detailAction.exclusive ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
    </Button>}
    <Button variant="ghost" size="icon-sm" className="h-full w-[38px]" onClick={detailAction.onClose} aria-label={detailAction.label} title={detailAction.label}><X className="size-4" /></Button>
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
