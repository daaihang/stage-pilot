import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/auth";

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}分${rest ? `${rest}秒` : ""}` : `${rest}秒`;
}

function formatStart(value, timezone) {
  if (!value) return "";
  try { return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone || "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return ""; }
}

export function PublicProgramSheetPage({ token, onRequireAuth }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => { let active = true; fetch(`${API_BASE}/v1/public/program-sheet-shares/${encodeURIComponent(token)}`, { headers: { "Referrer-Policy": "no-referrer" } }).then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || "分享链接不可用"); return body; }).then((data) => active && setState({ loading: false, error: null, data })).catch((error) => active && setState({ loading: false, error, data: null })); return () => { active = false; }; }, [token]);
  if (state.loading) return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">正在加载节目单…</main>;
  if (state.error) return <main className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md space-y-3 text-center"><h1 className="text-lg font-semibold">分享链接不可用</h1><p className="text-sm text-muted-foreground">{state.error.message}</p>{/需要登录|登录/.test(state.error.message || "") && onRequireAuth ? <button type="button" className="inline-flex h-9 items-center justify-center border px-4 text-sm font-medium hover:bg-muted" onClick={() => onRequireAuth()}>登录后继续访问</button> : null}</div></main>;
  const data = state.data || {}; const items = Array.isArray(data.items) ? data.items : []; const timezone = data.timezone || data.production_timezone || "Asia/Shanghai";
  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-6"><div className="mx-auto max-w-3xl space-y-6"><header className="space-y-2 border-b pb-5"><p className="text-xs text-muted-foreground">{data.production_name || "活动"} · 节目单 v{data.revision || "—"}</p><h1 className="text-2xl font-semibold tracking-tight">{data.name || "节目单"}</h1>{data.published_at ? <p className="text-xs text-muted-foreground">发布于 {formatStart(data.published_at, timezone)} · 活动时区 {timezone}</p> : null}{Array.isArray(data.occurrences) && data.occurrences.length ? <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{data.occurrences.map((occurrence) => <span key={occurrence.id || occurrence.occurrence_id} className="border px-2 py-1">{occurrence.name || occurrence.title || "场次"}{occurrence.starts_at ? ` · ${formatStart(occurrence.starts_at, timezone)}` : ""}</span>)}</div> : null}</header><div className="divide-y border-y">{items.map((item, index) => { const duration = item.duration_seconds_override ?? item.duration_seconds ?? 0; const snapshot = item.program_snapshot || item.programSnapshot || {}; const type = item.segment_type_snapshot?.name || item.segmentTypeSnapshot?.name || snapshot.program_type_name || item.kind || "节目"; const title = item.title_override || item.title || snapshot.name || "未命名条目"; return <div key={item.id || index} className="flex items-start gap-3 py-4 sm:gap-5"><span className="w-8 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium sm:text-base">{title}</p><span className="border px-1.5 py-0.5 text-[11px] text-muted-foreground">{type}</span></div>{item.starts_at ? <p className="mt-1 text-xs text-muted-foreground">{formatStart(item.starts_at, timezone)}</p> : null}</div><span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatSeconds(duration)}</span></div>; })}{!items.length ? <p className="py-10 text-center text-sm text-muted-foreground">此节目单没有可公开显示的条目。</p> : null}</div></div></main>;
}
