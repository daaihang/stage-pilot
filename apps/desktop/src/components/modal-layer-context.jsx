import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pushModalDialog, removeModalDialog } from "@/lib/modal-layout";

const ModalLayerContext = createContext({
  hostRef: null,
  active: false,
  activeDialogId: null,
  managed: false,
  registerDialog: () => () => {},
});

export const ModalDialogScopeContext = createContext({ isTop: true, requestClose: () => {} });

export function AppModalLayerProvider({ children, titlebarVisible = true }) {
  const hostRef = useRef(null);
  const dialogsRef = useRef([]);
  const [active, setActive] = useState(false);
  const [activeDialogId, setActiveDialogId] = useState(null);

  const registerDialog = useCallback((id) => {
    dialogsRef.current = pushModalDialog(dialogsRef.current, id);
    setActive(true);
    setActiveDialogId(id);
    return () => {
      dialogsRef.current = removeModalDialog(dialogsRef.current, id);
      setActive(dialogsRef.current.length > 0);
      setActiveDialogId(dialogsRef.current.at(-1) ?? null);
    };
  }, []);
  const contextValue = useMemo(() => ({
    hostRef,
    active,
    activeDialogId,
    managed: true,
    registerDialog,
  }), [active, activeDialogId, registerDialog]);
  const topInset = titlebarVisible ? "var(--app-titlebar-height, 36px)" : "env(safe-area-inset-top, 0px)";

  return <ModalLayerContext.Provider value={contextValue}>
    {children}
    <div
      ref={hostRef}
      className="app-modal-host"
      style={{ "--app-modal-top-inset": topInset }}
      data-slot="app-modal-host"
      aria-live="off"
    />
  </ModalLayerContext.Provider>;
}

export function useAppModalLayer() {
  return useContext(ModalLayerContext);
}

export function useTrackedDialogState({ open: controlledOpen, defaultOpen = false, onOpenChange }) {
  const { registerDialog, activeDialogId, managed } = useAppModalLayer();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen === undefined ? uncontrolledOpen : Boolean(controlledOpen);
  const idRef = useRef(Symbol("app-modal"));

  useLayoutEffect(() => {
    if (!open) return undefined;
    return registerDialog(idRef.current);
  }, [open, registerDialog]);

  const handleOpenChange = useCallback((nextOpen, details) => {
    if (controlledOpen === undefined) setUncontrolledOpen(Boolean(nextOpen));
    onOpenChange?.(Boolean(nextOpen), details);
  }, [controlledOpen, onOpenChange]);

  return { open, handleOpenChange, isTop: !managed || activeDialogId === null || activeDialogId === idRef.current };
}
