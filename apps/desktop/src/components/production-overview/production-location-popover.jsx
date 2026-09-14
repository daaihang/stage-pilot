import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { MapPin, Pencil } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";
import { listProductionLocations } from "@/lib/production-api";
import { cn } from "@/lib/utils";
import { useOptionalWindowDetail, useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import { ProductionLocationsPage } from "@/components/production-locations-page";

function ProductionLocationDetailBridge({ workspace, production, onChanged, triggerRef, routerLocation, navigate }) {
  const { setDetailOpen } = useWindowDetail();
  const panelOpen = new URLSearchParams(routerLocation.search).get("panel") === "locations";
  const getDetail = useCallback(
    () => <ProductionLocationsPage workspace={workspace} production={production} onChanged={() => onChanged?.()} key={production.id} />,
    [onChanged, production, workspace],
  );
  const closePanel = useCallback(() => {
    const params = new URLSearchParams(routerLocation.search);
    params.delete("panel");
    const search = params.toString();
    navigate(`${routerLocation.pathname}${search ? `?${search}` : ""}`, { replace: true, preventScrollReset: true });
  }, [navigate, routerLocation.pathname, routerLocation.search]);

  useWindowDetailRegistration({
    key: `production-locations:${production.id}`,
    storageKey: `detailPane:production-locations:${production.id}:v2`,
    detailLabel: "活动地点",
    triggerRef,
    getDetail,
    onClose: closePanel,
  });

  useEffect(() => {
    setDetailOpen(panelOpen, { announce: false });
  }, [panelOpen, setDetailOpen]);

  return null;
}

export function ProductionLocationPopover({ workspace, production, onRequestEdit, onChanged, disabled = false, className, refreshKey }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const triggerRef = useRef(null);
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const windowDetail = useOptionalWindowDetail();
  const canWrite = !production.isCreationSession && (["owner", "admin"].includes(workspace?.role) || production?.permissionKeys?.includes("production.edit"));

  useEffect(() => {
    let active = true;
    if (production.isCreationSession) {
      setLocations([]);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    listProductionLocations(production.id)
      .then((items) => {
        if (active) setLocations(items);
      })
      .catch((error) => {
        if (!active) return;
        setLocations([]);
        notify.error("无法加载活动地点", {
          description: error?.message || String(error),
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [production.id, refreshKey]);

  const primary = locations.find((item) => item.isPrimary);
  const display = primary
    ? `${primary.venueName}${primary.spaceName ? ` · ${primary.spaceName}` : ""}`
    : "地点待定";
  const openDetails = onRequestEdit || (() => {
    if (windowDetail) {
      const params = new URLSearchParams(routerLocation.search);
      params.set("panel", "locations");
      const search = params.toString();
      navigate(`${routerLocation.pathname}${search ? `?${search}` : ""}`, { preventScrollReset: true });
      windowDetail.setDetailOpen(true, { announce: false });
      return;
    }
    notify.info("活动地点详情暂不可用");
  });

  return (
    <>
      {windowDetail ? <ProductionLocationDetailBridge workspace={workspace} production={production} onChanged={onChanged} triggerRef={triggerRef} routerLocation={routerLocation} navigate={navigate} /> : null}
      <div className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
      <MapPin className="size-4 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate", !primary && "text-muted-foreground")}>
        {loading ? "地点加载中…" : display}
      </span>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled || !canWrite}
        aria-label="编辑地点"
        title="编辑活动地点"
        onClick={openDetails}
      >
        <Pencil />
      </Button>
      </div>
    </>
  );
}
