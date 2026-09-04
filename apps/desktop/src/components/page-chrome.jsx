import { createContext, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const PageChromeContext = createContext({ detailAction: null, setDetailAction: () => {} });

export function PageDetailTitlebarAction() {
  const { detailAction } = usePageChrome();
  if (!detailAction) return null;
  return <Button variant="ghost" size="icon-sm" className="h-full w-[38px]" onClick={detailAction.onClose} aria-label={detailAction.label} title={detailAction.label}><X className="size-4" /></Button>;
}

export function PageChromeProvider({ children }) {
  const [detailAction, setDetailAction] = useState(null);
  const value = useMemo(() => ({ detailAction, setDetailAction }), [detailAction]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

export function usePageChrome() {
  return useContext(PageChromeContext);
}
