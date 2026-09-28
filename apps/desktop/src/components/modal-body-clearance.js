import { useLayoutEffect, useRef } from "react";

const FOOTER_SELECTOR = '[data-slot="dialog-footer"], [data-slot="alert-dialog-footer"]';

export function useModalBodyClearance() {
  const bodyRef = useRef(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;

    let observedFooter = null;
    const syncFooter = () => {
      const footer = body.querySelector(FOOTER_SELECTOR);
      if (footer !== observedFooter) {
        if (observedFooter) resizeObserver?.unobserve(observedFooter);
        observedFooter = footer;
        if (observedFooter) resizeObserver?.observe(observedFooter);
      }
      const height = footer?.getBoundingClientRect().height ?? 0;
      body.style.setProperty("--app-dialog-body-footer-clearance", `${Math.ceil(height)}px`);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncFooter);
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(syncFooter);
    if (mutationObserver) mutationObserver.observe(body, { childList: true, subtree: true });
    syncFooter();

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      body.style.removeProperty("--app-dialog-body-footer-clearance");
    };
  }, []);

  return bodyRef;
}
