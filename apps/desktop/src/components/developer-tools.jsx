import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { Bell, CheckCircle2, Clipboard, Copy, Eye, FileText, Folder, Info, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { ContextMenuDemo1 } from "@/components/examples/c-context-menu-1";
import { ContextMenuDemo2 } from "@/components/examples/c-context-menu-2";
import { ContextMenuDemo3 } from "@/components/examples/c-context-menu-3";
import { ContextMenuDemo4 } from "@/components/examples/c-context-menu-4";
import { ContextMenuDemo5 } from "@/components/examples/c-context-menu-5";
import { ContextMenuDemo6 } from "@/components/examples/c-context-menu-6";
import { ContextMenuDemo7 } from "@/components/examples/c-context-menu-7";
import { ContextMenuDemo8 } from "@/components/examples/c-context-menu-8";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { appStore, isTauriRuntime } from "@/lib/app-store";

const MAX_HISTORY = 5;
const formatTime = (value) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));

export function DeveloperTools({ devtools, onDevtoolsChange, initialAction }) {
  const [history, setHistory] = useState([]);
  const [activity, setActivity] = useState(["开发工具已准备就绪"]);
  const currentRecord = history[0];
  const addActivity = useCallback((message) => setActivity((items) => [`${formatTime(Date.now())} · ${message}`, ...items].slice(0, 8)), []);
  const persistHistory = async (nextHistory) => { setHistory(nextHistory); await appStore.set("history", nextHistory); };

  useEffect(() => { appStore.init().then(() => appStore.get("history")).then((saved) => { if (Array.isArray(saved)) setHistory(saved.slice(0, MAX_HISTORY)); }).catch(() => {}); }, []);

  const choosePath = useCallback(async (kind) => {
    try {
      const selected = await open({ title: kind === "directory" ? "选择一个文件夹" : "选择一个文件", directory: kind === "directory", multiple: false });
      if (!selected || typeof selected !== "string") return;
      const record = { path: selected, kind, selectedAt: new Date().toISOString() };
      await persistHistory([record, ...history.filter((item) => item.path !== selected)].slice(0, MAX_HISTORY));
      notify.success(kind === "directory" ? "已选择文件夹" : "已选择文件");
      addActivity(`${kind === "directory" ? "选择文件夹" : "选择文件"}：${selected}`);
    } catch (error) { notify.error("无法打开系统选择框", { description: String(error) }); }
  }, [addActivity, history]);

  const copyCurrentPath = useCallback(async () => {
    if (!currentRecord) return notify.message("请先选择文件或文件夹");
    try { await writeText(currentRecord.path); notify.success("路径已复制到系统剪贴板"); addActivity("已复制当前路径"); }
    catch (error) { notify.error("复制失败", { description: String(error) }); }
  }, [addActivity, currentRecord]);

  const sendSystemNotification = useCallback(async () => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!granted) return notify.error("系统通知权限未授予");
      sendNotification({ title: "StagePilot", body: currentRecord ? `当前项目：${currentRecord.path}` : "原生通知工作正常。" });
      notify.success("已发送系统通知"); addActivity("发送测试通知");
    } catch (error) { notify.error("发送通知失败", { description: String(error) }); }
  }, [addActivity, currentRecord]);

  const hideMainWindow = useCallback(async () => {
    try { await getCurrentWindow().hide(); notify.success("主窗口已隐藏到托盘"); addActivity("隐藏主窗口到系统托盘"); }
    catch (error) { notify.error("窗口操作失败", { description: String(error) }); }
  }, [addActivity]);

  const openDevtools = useCallback(async () => {
    if (!isTauriRuntime) return notify.message("浏览器预览模式下没有开发者工具");
    try { const opened = await invoke("set_devtools", { enabled: true }); opened ? notify.success("已打开开发者工具") : notify.error("当前构建未启用开发者工具"); }
    catch (error) { notify.error("无法打开开发者工具", { description: String(error) }); }
  }, []);

  const runAction = useCallback(async (action) => {
    if (action === "open-file") await choosePath("file");
    if (action === "open-folder") await choosePath("directory");
    if (action === "copy-path") await copyCurrentPath();
    if (action === "notify") await sendSystemNotification();
    if (action === "open-devtools") await openDevtools();
  }, [choosePath, copyCurrentPath, openDevtools, sendSystemNotification]);

  useEffect(() => { if (initialAction) queueMicrotask(() => runAction(initialAction)); }, [initialAction, runAction]);

  const demos = useMemo(() => [[ContextMenuDemo1, "基础菜单"], [ContextMenuDemo2, "图标操作"], [ContextMenuDemo3, "快捷键标注"], [ContextMenuDemo4, "嵌套子菜单"], [ContextMenuDemo5, "分组标签"], [ContextMenuDemo6, "复选项"], [ContextMenuDemo7, "单选项"], [ContextMenuDemo8, "危险操作"]], []);

  return <div className="space-y-4"><Card><CardHeader><CardTitle>开发者选项</CardTitle><CardDescription>这些能力只在开发构建中显示。</CardDescription></CardHeader><CardContent className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">开发者工具</p><p className="text-xs text-muted-foreground">关闭后需重启应用才能完全禁用</p></div><div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={openDevtools}><Terminal />打开</Button><Switch checked={devtools} onCheckedChange={onDevtoolsChange} /></div></CardContent></Card>
    <Tabs defaultValue="files"><TabsList><TabsTrigger value="files">文件工具</TabsTrigger><TabsTrigger value="system">系统集成</TabsTrigger><TabsTrigger value="activity">活动记录</TabsTrigger><TabsTrigger value="components">UI 组件</TabsTrigger></TabsList>
      <TabsContent value="files"><Card><CardHeader><CardTitle>文件与目录</CardTitle><CardDescription>最近 5 条记录保存在应用数据目录。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2"><Button onClick={() => choosePath("file")}><FileText />选择文件</Button><Button variant="outline" onClick={() => choosePath("directory")}><Folder />选择文件夹</Button><Button variant="outline" disabled={!currentRecord} onClick={copyCurrentPath}><Copy />复制当前路径</Button></div><Table><TableHeader><TableRow><TableHead>类型</TableHead><TableHead>路径</TableHead><TableHead className="text-right">时间</TableHead></TableRow></TableHeader><TableBody>{history.length ? history.map((item) => <TableRow key={`${item.path}-${item.selectedAt}`}><TableCell><Badge variant="secondary">{item.kind === "directory" ? "文件夹" : "文件"}</Badge></TableCell><TableCell className="max-w-96 truncate font-mono text-xs" title={item.path}>{item.path}</TableCell><TableCell className="text-right text-xs text-muted-foreground">{formatTime(item.selectedAt)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="h-20 text-center text-muted-foreground">暂无记录</TableCell></TableRow>}</TableBody></Table><Separator /><Button variant="ghost" onClick={() => persistHistory([]).then(() => notify.success("最近记录已清空"))}><Trash2 />清空最近记录</Button></CardContent></Card></TabsContent>
      <TabsContent value="system"><div className="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardTitle>窗口与托盘</CardTitle><CardDescription>验证桌面壳层能力。</CardDescription></CardHeader><CardContent className="space-y-3"><Button className="w-full" variant="outline" onClick={hideMainWindow}><Eye />隐藏主窗口</Button><Button className="w-full" variant="outline" onClick={sendSystemNotification}><Bell />测试通知</Button></CardContent></Card><Card><CardHeader><CardTitle>运行状态</CardTitle></CardHeader><CardContent className="space-y-3"><p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-emerald-500" />窗口状态恢复已启用</p><p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-emerald-500" />单实例与托盘已启用</p><Button variant="outline" onClick={() => notify.info("StagePilot", { description: "多租户演艺活动运营平台桌面端。" })}><Info />关于</Button></CardContent></Card></div></TabsContent>
      <TabsContent value="activity"><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>活动记录</CardTitle><CardDescription>当前开发工具窗口的操作记录。</CardDescription></div><Button size="sm" variant="outline" onClick={() => { setActivity(["活动记录已刷新"]); notify.success("活动记录已重置"); }}><RefreshCw />重置</Button></CardHeader><CardContent className="space-y-2">{activity.map((item, index) => <div key={`${item}-${index}`} className="border p-3 text-sm">{item}</div>)}</CardContent></Card></TabsContent>
      <TabsContent value="components"><section className="grid gap-4 md:grid-cols-2">{demos.map(([Demo, title]) => <Card key={title}><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent><Demo /></CardContent></Card>)}</section></TabsContent>
    </Tabs>
  </div>;
}
