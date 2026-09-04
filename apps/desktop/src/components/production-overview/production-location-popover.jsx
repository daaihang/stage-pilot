import { useEffect, useState } from "react";

import { MapPin, Pencil } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";
import { listProductionLocations, toProductionLocation } from "@/lib/production-api";
import { cn } from "@/lib/utils";

export function ProductionLocationPopover({ production, onRequestEdit, disabled = false, className }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

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
        if (active) setLocations(items.map(toProductionLocation));
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
  }, [production.id]);

  const primary = locations.find((item) => item.isPrimary) || locations[0];
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
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled || !onRequestEdit}
        aria-label="编辑主地点"
        title="地点编辑将在活动地点详情中提供"
        onClick={onRequestEdit}
      >
        <Pencil />
      </Button>
    </div>
  );
}
