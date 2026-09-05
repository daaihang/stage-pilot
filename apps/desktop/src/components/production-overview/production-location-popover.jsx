import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { MapPin, Pencil } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";
import { listProductionLocations } from "@/lib/production-api";
import { cn } from "@/lib/utils";
import { productionPath } from "@/lib/navigation";

export function ProductionLocationPopover({ workspace, production, onRequestEdit, onChanged, disabled = false, className, refreshKey }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const triggerRef = useRef(null);
  const navigate = useNavigate();
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

  return (
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
        onClick={onRequestEdit || (() => navigate(productionPath(workspace.id, production.id, "locations")))}
      >
        <Pencil />
      </Button>
    </div>
  );
}
