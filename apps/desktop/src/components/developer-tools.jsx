import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { Bell, CheckCircle2, Clipboard, Copy, Eye, FileText, Folder, PanelRightOpen, RefreshCw, Terminal, Trash2, XCircle } from "lucide-react";
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
import { useWindowDetail } from "@/components/window-detail-context";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/sonner";
import { appStore, isTauriRuntime } from "@/lib/app-store";
import { completeFileUpload, createFileUpload, deleteFile, downloadFile, uploadToPresignedUrl } from "@/lib/file-api";

const MAX_HISTORY = 5;
const formatTime = (value) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));

function LayoutInspector() {
  const { detailPresentation: mode, detailWidth: width } = useWindowDetail();
  return <div className="flex min-h-full flex-col bg-background">
    <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-4 py-3">
      <div><h2 className="text-sm font-semibold">布局检查器</h2><p className="mt-0.5 text-xs text-muted-foreground">开发工具页详情面板试验</p></div>
    </header>
    <div className="space-y-6 p-4 text-sm">
      <section className="border-y py-4"><p className="text-xs text-muted-foreground">当前呈现</p><p className="mt-1 font-medium">{mode === "exclusive" ? "详情独占工作区" : mode === "inline" ? "嵌入式分栏" : "详情页覆盖主工作区"}</p><p className="mt-1 text-xs text-muted-foreground">{mode === "exclusive" ? "详情以带外边距的大窗口覆盖中央工作区；左侧应用导航仍保持可见。" : mode === "inline" ? `详情宽度 ${width}px；拖动左侧分割线或使用键盘方向键调整，独占与关闭由标题栏控制。` : "窄屏时详情作为主工作区内的独立页面显示，不模糊背景，也不覆盖应用标题栏。"}</p></section>
      <section className="space-y-2"><h3 className="font-medium">试验目标</h3><p className="text-xs leading-5 text-muted-foreground">此区域不是卡片或浮层式侧栏。在宽屏中，它与主内容共享同一个工作区，仅由一条竖向分割线区隔；分割线只调整详情宽度，独占和关闭通过窗口标题栏控制。</p></section>
      <section className="space-y-2 border-t pt-4"><h3 className="font-medium">后续接入</h3><p className="text-xs leading-5 text-muted-foreground">资源库、活动实例或工作会话可复用同一容器，将列表保留在主区，并把选中对象放到这里。</p></section>
    </div>
  </div>;
}

export function DeveloperTools({ workspace, devtools, onDevtoolsChange, initialAction, contentWidth = "standard", title = "开发工具", description = "验证桌面能力和 UI 组件。" }) {
  const [uploadTest, setUploadTest] = useState({ status: "idle", name: "", progress: 0, detail: "" });
  const uploadInputRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [activity, setActivity] = useState(["开发工具已准备就绪"]);
  const [diagnostics, setDiagnostics] = useState([{ label: "尚未检测", ok: true, detail: "点击「重新检测」" }]);
  const detailTriggerRef = useRef(null);
  const { detailOpen, registerDetail, setDetailOpen } = useWindowDetail();
  const currentRecord = history[0];
  const addActivity = useCallback((message) => setActivity((items) => [`${formatTime(Date.now())} · ${message}`, ...items].slice(0, 8)), []);
  const persistHistory = async (nextHistory) => { setHistory(nextHistory); await appStore.set("history", nextHistory); };

  useEffect(() => { appStore.init().then(() => appStore.get("history")).then((saved) => { if (Array.isArray(saved)) setHistory(saved.slice(0, MAX_HISTORY)); }).catch(() => {}); }, []);

  // 运行状态诊断：每项都做真实探测，不展示硬编码结论。
  // - 运行环境：Tauri WebView 还是浏览器预览；
  // - 窗口控制 / 窗口状态恢复：IPC 调用当前窗口 API（浏览器预览预期失败）；
  // - 剪贴板：写入探测文本（会覆盖用户剪贴板，只在使用者主动检测时执行）；
  // - 系统通知权限：通知插件在当前环境的授权状态。
  const collectDiagnostics = useCallback(async ({ includeClipboard = true } = {}) => {
    const results = [{ label: "运行环境", ok: true, detail: isTauriRuntime ? "Tauri 桌面" : "浏览器预览" }];
    const probe = async (label, task) => {
      try {
        const detail = await task();
        results.push({ label, ok: true, detail: detail || "可用" });
      } catch (error) {
        results.push({ label, ok: false, detail: String(error).slice(0, 80) });
      }
    };
    await probe("窗口控制", async () => {
      if (!isTauriRuntime) throw new Error("浏览器预览模式");
      const win = getCurrentWindow();
      return (await win.isVisible()) ? "可见" : "已隐藏";
    });
    await probe("窗口状态恢复", async () => {
      if (!isTauriRuntime) throw new Error("浏览器预览模式");
      return (await getCurrentWindow().isMaximized()) ? "已最大化" : "已恢复";
    });
    if (includeClipboard) {
      await probe("剪贴板", async () => {
        await writeText("StagePilot 剪贴板诊断");
        return "写入成功";
      });
    }
    await probe("系统通知权限", async () => {
      if (!isTauriRuntime) throw new Error("浏览器预览模式");
      return (await isPermissionGranted()) ? "已授予" : "未授予";
    });
    setDiagnostics(results);
    return results;
  }, []);

  useEffect(() => {
    // 挂载时静默探测一次（不写剪贴板、不发 toast）：进入页面不是用户动作。
    collectDiagnostics({ includeClipboard: false }).catch(() => {});
  }, [collectDiagnostics]);

  const runRuntimeDiagnostics = useCallback(async () => {
    const results = await collectDiagnostics();
    const failed = results.filter((item) => !item.ok).length;
    if (failed) notify.message(`诊断完成：${failed} 项异常`, { description: failed === 1 && !isTauriRuntime ? "浏览器预览模式下桌面能力预期不可用。" : undefined });
    else notify.success("诊断完成：全部正常");
    addActivity(`运行状态诊断：${results.length - failed}/${results.length} 项正常`);
  }, [addActivity, collectDiagnostics]);

  const choosePath = useCallback(async (kind) => {
    if (!isTauriRuntime) {
      notify.message("浏览器预览模式下不可用", { description: "系统文件选择框只在 Tauri 桌面运行时提供。" });
      return;
    }
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
    if (!isTauriRuntime) {
      notify.message("浏览器预览模式下不可用", { description: "系统通知只在 Tauri 桌面运行时提供。" });
      return;
    }
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!granted) return notify.error("系统通知权限未授予");
      sendNotification({ title: "StagePilot", body: currentRecord ? `当前项目：${currentRecord.path}` : "原生通知工作正常。" });
      notify.success("已发送系统通知"); addActivity("发送测试通知");
    } catch (error) { notify.error("发送通知失败", { description: String(error) }); }
  }, [addActivity, currentRecord]);

  const hideMainWindow = useCallback(async () => {
    if (!isTauriRuntime) {
      notify.message("浏览器预览模式下不可用", { description: "窗口控制只在 Tauri 桌面运行时提供。" });
      return;
    }
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

  const runUploadTest = useCallback(async (event) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!workspace?.id) return notify.error("无法测试上传", { description: "当前没有可用的工作空间。" });
    const toast = notify.loading("正在测试文件上传…");
    setUploadTest({ status: "uploading", name: file.name, progress: 0, detail: "正在创建上传任务" });
    try {
      const created = await createFileUpload(workspace.id, { filename: file.name, content_type: file.type, size_bytes: file.size, production_id: null });
      await uploadToPresignedUrl(created.upload.url, file, (progress) => setUploadTest({ status: "uploading", name: file.name, progress, detail: "正在直传 MinIO / S3" }));
      const completed = await completeFileUpload(workspace.id, created.file.id);
      setUploadTest({ status: "success", name: file.name, progress: 1, detail: `上传成功，状态：${completed.status}` });
      notify.success("文件上传测试成功", { id: toast });
      addActivity(`文件上传测试成功：${file.name}`);
    } catch (error) {
      setUploadTest({ status: "error", name: file.name, progress: 0, detail: error?.message || String(error) });
      notify.error("文件上传测试失败", { id: toast, description: error?.message || String(error) });
      addActivity(`文件上传测试失败：${file.name}`);
    }
  }, [addActivity, workspace]);

  const demos = useMemo(() => [[ContextMenuDemo1, "基础菜单"], [ContextMenuDemo2, "图标操作"], [ContextMenuDemo3, "快捷键标注"], [ContextMenuDemo4, "嵌套子菜单"], [ContextMenuDemo5, "分组标签"], [ContextMenuDemo6, "复选项"], [ContextMenuDemo7, "单选项"], [ContextMenuDemo8, "危险操作"]], []);
  useEffect(() => registerDetail({ key: "developer-tools", getDetail: () => <LayoutInspector />, triggerRef: detailTriggerRef, storageKey: "detailPane:window:v1" }), [registerDetail]);

  const mainWidthClass = { standard: "max-w-6xl", wide: "max-w-7xl", full: "max-w-none" }[contentWidth] || "max-w-6xl";
  return <div className="h-full min-h-0 overflow-y-auto p-4 md:p-6"><div className={`mx-auto w-full ${mainWidthClass} space-y-4`}><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div><Card><CardHeader><CardTitle>开发者选项</CardTitle><CardDescription>这些能力只在开发构建中显示。</CardDescription></CardHeader><CardContent className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">开发者工具</p><p className="text-xs text-muted-foreground">关闭后需重启应用才能完全禁用</p></div><div className="flex flex-wrap items-center justify-end gap-2"><Button ref={detailTriggerRef} size="sm" variant="outline" onClick={() => setDetailOpen(!detailOpen)} aria-pressed={detailOpen}><PanelRightOpen />{detailOpen ? "关闭详情" : "打开详情"}</Button><Button size="sm" variant="outline" onClick={openDevtools}><Terminal />打开</Button><Switch checked={devtools} onCheckedChange={onDevtoolsChange} /></div></CardContent></Card>
    <Tabs defaultValue="files"><TabsList><TabsTrigger value="files">文件工具</TabsTrigger><TabsTrigger value="upload">上传测试</TabsTrigger><TabsTrigger value="system">系统集成</TabsTrigger><TabsTrigger value="activity">活动记录</TabsTrigger><TabsTrigger value="components">UI 组件</TabsTrigger></TabsList>
      <TabsContent value="files"><Card><CardHeader><CardTitle>文件与目录</CardTitle><CardDescription>最近 5 条记录保存在应用数据目录。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2"><Button onClick={() => choosePath("file")}><FileText />选择文件</Button><Button variant="outline" onClick={() => choosePath("directory")}><Folder />选择文件夹</Button><Button variant="outline" disabled={!currentRecord} onClick={copyCurrentPath}><Copy />复制当前路径</Button></div><Table><TableHeader><TableRow><TableHead>类型</TableHead><TableHead>路径</TableHead><TableHead className="text-right">时间</TableHead></TableRow></TableHeader><TableBody>{history.length ? history.map((item) => <TableRow key={`${item.path}-${item.selectedAt}`}><TableCell><Badge variant="secondary">{item.kind === "directory" ? "文件夹" : "文件"}</Badge></TableCell><TableCell className="max-w-96 truncate font-mono text-xs" title={item.path}>{item.path}</TableCell><TableCell className="text-right text-xs text-muted-foreground">{formatTime(item.selectedAt)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="h-20 text-center text-muted-foreground">暂无记录</TableCell></TableRow>}</TableBody></Table><Separator /><Button variant="ghost" onClick={() => persistHistory([]).then(() => notify.success("最近记录已清空"))}><Trash2 />清空最近记录</Button></CardContent></Card></TabsContent>
      <TabsContent value="upload"><Card><CardHeader><CardTitle>S3 / MinIO 上传测试</CardTitle><CardDescription>选择一个文件，验证预签名 URL、直传和完成确认。</CardDescription></CardHeader><CardContent className="space-y-4"><><Button type="button" disabled={!workspace} onClick={() => uploadInputRef.current?.click()}><FileText />选择测试文件</Button><input ref={uploadInputRef} className="hidden" type="file" onChange={runUploadTest} /></>{!workspace && <p className="text-sm text-muted-foreground">当前没有可用工作空间。</p>}{uploadTest.name && <div className="border p-3 text-sm"><div className="flex justify-between gap-3"><span className="truncate">{uploadTest.name}</span><Badge variant={uploadTest.status === "success" ? "secondary" : uploadTest.status === "error" ? "destructive" : "outline"}>{uploadTest.status === "success" ? "成功" : uploadTest.status === "error" ? "失败" : `${Math.round(uploadTest.progress * 100)}%`}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{uploadTest.detail}</p>{uploadTest.status === "uploading" && <div className="mt-2 h-1 bg-muted"><div className="h-full bg-primary" style={{ width: `${uploadTest.progress * 100}%` }} /></div>}</div>}</CardContent></Card></TabsContent>
       <TabsContent value="system"><div className="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardTitle>窗口与托盘</CardTitle><CardDescription>验证桌面壳层能力。</CardDescription></CardHeader><CardContent className="space-y-3"><Button className="w-full" variant="outline" onClick={hideMainWindow} disabled={!isTauriRuntime}><Eye />隐藏主窗口</Button><Button className="w-full" variant="outline" onClick={sendSystemNotification}><Bell />测试通知</Button>{!isTauriRuntime && <p className="text-xs text-muted-foreground">浏览器预览模式下窗口与系统能力不可用。</p>}</CardContent></Card><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>运行状态</CardTitle><CardDescription>当前运行环境的真实诊断结果。</CardDescription></div><Button size="sm" variant="outline" onClick={runRuntimeDiagnostics}><RefreshCw />重新检测</Button></CardHeader><CardContent className="space-y-3">{diagnostics.map((item) => <p key={item.label} className="flex items-center gap-2 text-sm">{item.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <XCircle className="size-4 shrink-0 text-red-500" />}<span>{item.label}</span><span className="ml-auto truncate text-xs text-muted-foreground" title={item.detail}>{item.detail}</span></p>)}</CardContent></Card></div></TabsContent>
      <TabsContent value="activity"><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>活动记录</CardTitle><CardDescription>当前开发工具窗口的操作记录。</CardDescription></div><Button size="sm" variant="outline" onClick={() => { setActivity(["活动记录已刷新"]); notify.success("活动记录已重置"); }}><RefreshCw />重置</Button></CardHeader><CardContent className="space-y-2">{activity.map((item, index) => <div key={`${item}-${index}`} className="border p-3 text-sm">{item}</div>)}</CardContent></Card></TabsContent>
      <TabsContent value="components"><section className="grid gap-4 md:grid-cols-2">{demos.map(([Demo, title]) => <Card key={title}><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent><Demo /></CardContent></Card>)}</section></TabsContent>
    </Tabs>
  </div></div>;
}
