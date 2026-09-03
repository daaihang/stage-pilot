import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { notify } from "@/components/ui/sonner";
import { useWorkspaceContext } from "@/components/workspace-provider";
import { productionStatusLabels, updateProduction } from "@/lib/production-api";

/**
 * Production Settings（Phase 13）：General。
 * OWNER / ADMIN 可编辑（后端 PATCH 要求 ADMIN+）；MEMBER 只读。
 * 支持 name / description / status / timezone / start_at / end_at。
 */
export function ProductionSettingsPage({ workspace, production }) {
  const { membershipRole } = useWorkspaceContext();
  const canManage = membershipRole === "owner" || membershipRole === "admin";
  const [form, setForm] = useState({
    name: production.name,
    description: production.description || "",
    status: production.status,
    timezone: production.timezone,
    startsAt: toLocalInputValue(production.startsAt, production.timezone),
    endsAt: toLocalInputValue(production.endsAt, production.timezone),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      name: production.name,
      description: production.description || "",
      status: production.status,
      timezone: production.timezone,
      startsAt: toLocalInputValue(production.startsAt, production.timezone),
      endsAt: toLocalInputValue(production.endsAt, production.timezone),
    });
  }, [production.id, production.updatedAt]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      notify.error("活动名称不能为空");
      return;
    }
    const startsAt = form.startsAt ? new Date(form.startsAt).toISOString() : null;
    const endsAt = form.endsAt ? new Date(form.endsAt).toISOString() : null;
    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      notify.error("结束时间不能早于开始时间");
      return;
    }
    setSaving(true);
    try {
      await updateProduction(workspace.id, production.id, {
        name,
        description: form.description,
        status: form.status,
        timezone: form.timezone,
        start_at: startsAt,
        end_at: endsAt,
      });
      notify.success("活动设置已保存");
    } catch (error) {
      notify.error("保存失败", { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>常规</CardTitle>
          <CardDescription>
            {canManage ? "OWNER / ADMIN 可以修改活动信息。" : "你在这个工作空间是 MEMBER，只能查看活动信息。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={save}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">活动名称</span>
              <Input value={form.name} onChange={set("name")} maxLength={120} disabled={!canManage} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">描述</span>
              <Input value={form.description} onChange={set("description")} maxLength={500} disabled={!canManage} />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">开始时间（{form.timezone}）</span>
                <Input type="datetime-local" value={form.startsAt} onChange={set("startsAt")} disabled={!canManage} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">结束时间（{form.timezone}）</span>
                <Input type="datetime-local" value={form.endsAt} onChange={set("endsAt")} disabled={!canManage} />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">时区（IANA）</span>
                <Input value={form.timezone} onChange={set("timezone")} placeholder="Asia/Shanghai" disabled={!canManage} />
              </label>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">状态</span>
                <StatusSelect value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value }))} disabled={!canManage} />
              </div>
            </div>
            {canManage && <Button type="submit" disabled={saving}>{saving ? "保存中…" : "保存更改"}</Button>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusSelect({ value, onChange, disabled }) {
  const items = useMemo(() => Object.entries(productionStatusLabels).map(([id, meta]) => ({ id, label: meta.label })), []);
  const current = items.find((item) => item.id === value) ?? items[0];
  if (disabled) return <Badge variant="secondary" className="h-9 px-3">{current.label}</Badge>;
  return (
    <SelectPrimitive.Root value={value} onValueChange={(next) => onChange(next)}>
      <SelectPrimitive.Trigger className="flex h-9 w-full items-center justify-between border px-3 text-sm">
        {current.label}
        <SelectPrimitive.Icon><span aria-hidden="true">⌄</span></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4}>
          <SelectPrimitive.Popup className="z-50 min-w-40 border bg-background p-1 shadow-md">
            {items.map((item) => (
              <SelectPrimitive.Item key={item.id} value={item.id} className="flex cursor-default items-center px-2 py-1.5 text-sm outline-none data-highlighted:bg-muted">
                <SelectPrimitive.ItemIndicator className="mr-2">✓</SelectPrimitive.ItemIndicator>
                {item.label}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** RFC3339 → datetime-local 输入值（按活动时区的墙钟时间）。 */
function toLocalInputValue(instant, timezone) {
  if (!instant) return "";
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone || "Asia/Shanghai",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(instant));
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
  } catch {
    return "";
  }
}
