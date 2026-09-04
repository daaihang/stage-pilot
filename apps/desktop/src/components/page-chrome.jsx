import { createContext, useContext, useMemo, useState } from "react";
import { RiSideBarLine } from "@remixicon/react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const PageChromeContext = createContext({ detailAction: null, setDetailAction: () => {} });

export function PageDetailTitlebarAction() {
  const { detailAction } = usePageChrome();
  if (!detailAction) return null;
  return <>
    {detailAction.onToggleExclusive && <Button variant="ghost" size="icon-sm" className="h-full w-[38px]" onClick={detailAction.onToggleExclusive} aria-label={detailAction.exclusive ? "退出详情独占工作区" : "让详情独占工作区"} title={detailAction.exclusive ? "退出详情独占工作区" : "让详情独占工作区"}>
      {detailAction.exclusive ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
    </Button>}
    <Button variant="ghost" size="icon-sm" className="h-full w-[38px]" onClick={detailAction.onClose} aria-label={detailAction.label} title={detailAction.label}><RiSideBarLine className="size-4 rotate-180" /></Button>
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
