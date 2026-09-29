import { Download, FileUp, Pause, Play, RotateCcw, Transfer, Trash2 } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useTransferCenter } from "@/components/transfer-center-context";
import { isTauriRuntime } from "@/lib/app-store";

const bytes = (value) => {
  const amount = Number(value) || 0;
  if (amount < 1024) return `${amount} B`;
  if (amount < 1024 ** 2) return `${(amount / 1024).toFixed(1)} KB`;
  if (amount < 1024 ** 3) return `${(amount / 1024 ** 2).toFixed(1)} MB`;
  return `${(amount / 1024 ** 3).toFixed(2)} GB`;
};

const labelFor = (task) => ({
  queued: "排队中", preparing: task.direction === "upload" ? "校验本地文件" : "准备下载", transferring: task.direction === "upload" ? "上传中" : "下载中",
  scanning: "安全检查中", paused: "已暂停", failed: "失败", expired: "会话已过期", rejected: "安全检查未通过", needs_file: "需重新选择文件",
  completed: "已完成", cancelled: "已取消",
})[task.status] || task.status;

function TransferItem({ task, pause, resume, restart, reselectSource, cancel }) {
  const Icon = task.direction === "upload" ? FileUp : Download;
  const progress = task.totalBytes ? Math.min(100, Math.round((task.transferredBytes || 0) / task.totalBytes * 100)) : 0;
  return <div className="space-y-2 border-b px-3 py-2.5 last:border-b-0">
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={task.filename}>{task.filename}</p>
        <p className="truncate text-[11px] text-muted-foreground">{task.intent?.contextName || "文件资料"} · {labelFor(task)}</p>
      </div>
      {task.status === "queued" || task.status === "preparing" || task.status === "transferring" ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`暂停 ${task.filename}`} onClick={() => pause(task.id)}><Pause /></Button> : null}
      {task.status === "paused" || task.status === "failed" ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`继续 ${task.filename}`} onClick={() => resume(task.id)}><Play /></Button> : null}
      {task.status === "expired" ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`重新开始 ${task.filename}`} onClick={() => restart(task.id)}><RotateCcw /></Button> : null}
      {task.status === "needs_file" && (isTauriRuntime
        ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`重新选择 ${task.filename}`} onClick={() => reselectSource(task.id)}><FileUp /></Button>
        : <label className="cursor-pointer" aria-label={`重新选择 ${task.filename}`}><FileUp className="size-4" /><input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void reselectSource(task.id, file); }} /></label>)}
      {!(["scanning", "completed", "cancelled"].includes(task.status)) ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`取消 ${task.filename}`} onClick={() => cancel(task.id)}><Trash2 /></Button> : null}
    </div>
    {["transferring", "paused", "failed", "expired", "rejected", "scanning", "completed"].includes(task.status) && <>
      <div className="h-1.5 bg-muted" role="progressbar" aria-label={`${task.filename}传输进度`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} /></div>
      <div className="flex justify-between gap-2 text-[11px] text-muted-foreground"><span>{bytes(task.transferredBytes)} / {bytes(task.totalBytes)}</span><span>{task.status === "transferring" && task.speedBps ? `${bytes(task.speedBps)}/s` : `${progress}%`}</span></div>
    </>}
    {task.error && <p className="text-[11px] text-destructive">{task.error}</p>}
  </div>;
}

export function TransferCenterTrigger({ variant = "sidebar" }) {
  const { tasks, activeCount, pause, resume, restart, reselectSource, cancel, clearFinished } = useTransferCenter();
  const badge = activeCount ? <span className="ml-auto min-w-5 rounded-full bg-primary px-1 text-center text-[10px] text-primary-foreground group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:-top-1">{activeCount}</span> : null;
  const trigger = variant === "sidebar"
    ? <SidebarMenuButton tooltip="传输中心" aria-label={`传输中心${activeCount ? `，${activeCount} 项进行中` : ""}`} className="relative"><Transfer /><span>传输中心</span>{badge}</SidebarMenuButton>
    : <Button type="button" variant="ghost" size="sm" aria-label={`传输中心${activeCount ? `，${activeCount} 项进行中` : ""}`} className="relative min-w-0 max-[36rem]:size-8 max-[36rem]:px-0"><Transfer /><span className="max-[36rem]:hidden">传输中心</span>{activeCount > 0 && <span className="rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{activeCount}</span>}</Button>;
  return <Popover>
    {variant === "sidebar" ? <SidebarMenu><SidebarMenuItem><PopoverTrigger render={trigger} /></SidebarMenuItem></SidebarMenu> : <PopoverTrigger render={trigger} />}
    <PopoverContent side={variant === "sidebar" ? "right" : "top"} align={variant === "sidebar" ? "end" : "center"} sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
      <div className="flex items-center justify-between border-b px-3 py-2"><h2 className="text-sm font-medium">传输中心</h2><Button type="button" variant="ghost" size="sm" onClick={clearFinished} disabled={!tasks.some((task) => ["completed", "cancelled", "rejected"].includes(task.status))}>清理已完成</Button></div>
      <div className="max-h-[min(60vh,28rem)] overflow-y-auto" aria-label="传输任务列表">
        {tasks.length ? [...tasks].reverse().map((task) => <TransferItem key={task.id} task={task} pause={pause} resume={resume} restart={restart} reselectSource={reselectSource} cancel={cancel} />) : <p className="px-3 py-8 text-center text-xs text-muted-foreground">暂无传输任务</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
