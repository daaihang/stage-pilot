import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { LazyStore } from "@tauri-apps/plugin-store";
import { Bell, CheckCircle2, Clipboard, Copy, Eye, FileText, Folder, FolderOpen, Info, Keyboard, Minus, MonitorCog, MonitorUp, Moon, PanelTop, Power, RefreshCw, Shapes, Sparkles, Square, Terminal, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app-sidebar";
import { AccountCenter } from "@/components/account-center";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarRadioGroup, MenubarRadioItem, MenubarSeparator, MenubarShortcut, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger } from "@/components/ui/menubar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSonner, notify } from "@/components/ui/sonner";
import { AuthScreen } from "@/components/auth-screen";
import { login as loginAccount, register as registerAccount, restoreSession, logout as logoutAccount } from "@/lib/auth";

const isTauriRuntime = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
const documentationUrl = "https://tauri.app/start/";
const pageTitles = { overview: "能力总览", files: "文件工具", system: "系统集成", activity: "活动记录", components: "UI 组件" };
const accountWindowLabel = "account-center";
const accountNavigationEvent = "account-center:navigate";
const accountUserDefaults = { name: "daaihang", username: "@daaihang", email: "daaihang@qq.com", avatar: "" };
const subscriptionDefaults = { plan: "free" };
const isAccountCenterWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("window") === accountWindowLabel;

const browserStore = {
  async init() {},
  async get(key) {
    try {
      const value = window.localStorage.getItem(`stagepilot:${key}`);
      return value === null ? undefined : JSON.parse(value);
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(`stagepilot:${key}`, JSON.stringify(value));
    } catch {}
  },
};

const store = isTauriRuntime ? new LazyStore("stagepilot.json", { autoSave: 150 }) : browserStore;
const MAX_HISTORY = 5;
const actionLabels = { "open-file": "选择文件", "open-folder": "选择文件夹", "copy-path": "复制当前路径", "toggle-theme": "切换主题", "toggle-window": "隐藏到托盘", "open-devtools": "打开开发者工具", about: "打开关于窗口", notify: "发送测试通知", quit: "退出应用" };
const menuBar = [
  { label: "文件", items: [{ label: "选择文件…", action: "open-file" }, { label: "选择文件夹…", action: "open-folder" }, { label: "复制当前路径", action: "copy-path" }] },
  { label: "视图", items: [{ label: "切换深色主题", action: "toggle-theme" }, { label: "打开开发者工具", action: "open-devtools" }, { label: "隐藏到托盘", action: "toggle-window" }, "separator", { label: "发送测试通知", action: "notify" }] },
  { label: "帮助", items: [{ label: "关于 StagePilot", action: "about" }, "separator", { label: "退出", action: "quit" }] },
];
const contextMenuItems = [
  { label: "切换深色主题", action: "toggle-theme", icon: Moon },
  { label: "复制当前路径", action: "copy-path", icon: Copy },
  { label: "发送测试通知", action: "notify", icon: Bell },
  "separator",
  { label: "打开开发者工具", action: "open-devtools", icon: Terminal },
  "separator",
  { label: "关于 StagePilot", action: "about", icon: Info },
  { label: "退出", action: "quit", icon: Power },
];
const isMac = navigator.userAgent.includes("Mac");
const isWindows = navigator.userAgent.includes("Windows");

function formatTime(value) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }

function TitlebarMenu({ menu, onAction }) {
  const renderItem = (item, index) => {
    if (item === "separator" || item.type === "separator") {
      return <MenubarSeparator key={`sep-${index}`} />;
    }

    const Icon = item.icon;
    const label = <>{Icon && <Icon />}<span>{item.label}</span>{item.shortcut && <MenubarShortcut>{item.shortcut}</MenubarShortcut>}</>;
    if (item.submenu) {
      return <MenubarSub key={item.label}><MenubarSubTrigger>{label}</MenubarSubTrigger><MenubarSubContent>{item.submenu.map(renderItem)}</MenubarSubContent></MenubarSub>;
    }
    if (item.type === "checkbox") {
      return <MenubarCheckboxItem key={item.label} checked={item.checked} onCheckedChange={(checked) => item.onCheckedChange?.(checked)}>{label}</MenubarCheckboxItem>;
    }
    if (item.type === "radio") {
      return <MenubarRadioItem key={item.label} value={item.value} disabled={item.disabled}>{label}</MenubarRadioItem>;
    }
    return <MenubarItem key={item.action ?? item.label} disabled={item.disabled} data-variant={item.variant} onClick={() => item.action && onAction(item.action)}>{label}</MenubarItem>;
  };

  return <MenubarMenu><MenubarTrigger>{menu.label}</MenubarTrigger><MenubarContent>{menu.items.map(renderItem)}</MenubarContent></MenubarMenu>;
}

function App() {
  return isAccountCenterWindow ? <AccountCenterApp /> : <MainApp />;
}

function AccountCenterApp() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [subscription, setSubscription] = useState(subscriptionDefaults);
  const [theme, setTheme] = useState("light");
  const [devtools, setDevtools] = useState(true);
  const [showTitlebarTitle, setShowTitlebarTitle] = useState(true);
  const [titlebarTitleMode, setTitlebarTitleMode] = useState("page");
  const applyTheme = async (nextTheme, persist = true) => { document.documentElement.classList.toggle("dark", nextTheme === "dark"); setTheme(nextTheme); if (persist) await store.set("theme", nextTheme); };
  const handleDevtoolsChange = async (checked) => { setDevtools(checked); await store.set("devtools", checked); if (isTauriRuntime && checked) { try { await invoke("set_devtools", { enabled: true }); } catch {} } };
  const updateTitlebarVisibility = async (checked) => { setShowTitlebarTitle(checked); await store.set("showTitlebarTitle", checked); };
  const updateTitlebarMode = async (mode) => { setTitlebarTitleMode(mode); await store.set("titlebarTitleMode", mode); };
  useEffect(() => { let active = true; (async () => { try { await store.init(); const [savedSubscription, savedTheme, savedDevtools, savedTitlebarVisibility, savedTitlebarMode, restoredUser] = await Promise.all([store.get("subscription"), store.get("theme"), store.get("devtools"), store.get("showTitlebarTitle"), store.get("titlebarTitleMode"), restoreSession()]); if (!active) return; setUser(restoredUser); if (savedSubscription && typeof savedSubscription === "object") setSubscription({ ...subscriptionDefaults, ...savedSubscription }); await applyTheme(savedTheme === "dark" ? "dark" : "light", false); if (typeof savedDevtools === "boolean") setDevtools(savedDevtools); if (typeof savedTitlebarVisibility === "boolean") setShowTitlebarTitle(savedTitlebarVisibility); if (savedTitlebarMode === "app" || savedTitlebarMode === "page") setTitlebarTitleMode(savedTitlebarMode); } catch {} finally { if (active) setAuthReady(true); } })(); return () => { active = false; }; }, []);
  if (!authReady) return <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">正在加载账号…</main>;
  if (!user) return <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">账号会话已失效，请返回主窗口重新登录。</main>;
  return <AccountCenter user={user} subscription={subscription} theme={theme} applyTheme={applyTheme} devtools={devtools} onDevtoolsChange={handleDevtoolsChange} showTitlebarTitle={showTitlebarTitle} titlebarTitleMode={titlebarTitleMode} onTitlebarVisibilityChange={updateTitlebarVisibility} onTitlebarModeChange={updateTitlebarMode} />;
}

function MainApp() {
  const [history, setHistory] = useState([]);
  const [theme, setTheme] = useState("light");
  const [activity, setActivity] = useState(["应用已准备就绪"]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [activeView, setActiveView] = useState("overview");
  const [isMaximized, setIsMaximized] = useState(false);
  const [devtools, setDevtools] = useState(true);
  const [showTitlebarTitle, setShowTitlebarTitle] = useState(true);
  const [titlebarTitleMode, setTitlebarTitleMode] = useState("page");
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("loading");
  const [subscription, setSubscription] = useState(subscriptionDefaults);
  const themeRef = useRef("light");
  const currentRecord = history[0];
  const featureCount = useMemo(() => ["原生标题栏控制", "系统托盘", "文件选择", "剪贴板", "通知", "单实例", "窗口状态", "全局快捷键"], []);
  const titlebarTitle = titlebarTitleMode === "app" ? "StagePilot" : (pageTitles[activeView] ?? "StagePilot");
  const addActivity = (message) => setActivity((items) => [`${formatTime(Date.now())} · ${message}`, ...items].slice(0, 6));
  const applyTheme = async (nextTheme, persist = true) => { document.documentElement.classList.toggle("dark", nextTheme === "dark"); themeRef.current = nextTheme; setTheme(nextTheme); if (persist) await store.set("theme", nextTheme); };
  const persistHistory = async (nextHistory) => { setHistory(nextHistory); await store.set("history", nextHistory); };
  const choosePath = async (kind) => { try { const selected = await open({ title: kind === "directory" ? "选择一个文件夹" : "选择一个文件", directory: kind === "directory", multiple: false }); if (!selected || typeof selected !== "string") return; const record = { path: selected, kind, selectedAt: new Date().toISOString() }; await persistHistory([record, ...history.filter((item) => item.path !== selected)].slice(0, MAX_HISTORY)); notify.success(kind === "directory" ? "已选择文件夹" : "已选择文件"); addActivity(`${kind === "directory" ? "选择文件夹" : "选择文件"}：${selected}`); } catch (error) { notify.error("无法打开系统选择框", { description: String(error) }); } };
  const copyCurrentPath = async () => { if (!currentRecord) return notify.message("请先选择文件或文件夹"); try { await writeText(currentRecord.path); notify.success("路径已复制到系统剪贴板"); addActivity("已复制当前路径"); } catch (error) { notify.error("复制失败", { description: String(error) }); } };
  const sendSystemNotification = async () => { try { let granted = await isPermissionGranted(); if (!granted) granted = (await requestPermission()) === "granted"; if (!granted) return notify.error("系统通知权限未授予"); sendNotification({ title: "StagePilot", body: currentRecord ? `当前项目：${currentRecord.path}` : "原生通知工作正常。" }); notify.success("已发送系统通知"); addActivity("发送测试通知"); } catch (error) { notify.error("发送通知失败", { description: String(error) }); } };
  const hideWindow = async () => { try { await getCurrentWindow().hide(); addActivity("隐藏主窗口到系统托盘"); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const minimizeWindow = async () => { try { await getCurrentWindow().minimize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const toggleMaximize = async () => { try { await getCurrentWindow().toggleMaximize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const handleNativeAction = async (action) => { addActivity(actionLabels[action] ?? `收到原生动作：${action}`); if (action === "open-file") { setActiveView("files"); await choosePath("file"); } if (action === "open-folder") { setActiveView("files"); await choosePath("directory"); } if (action === "copy-path") { setActiveView("files"); await copyCurrentPath(); } if (action === "toggle-theme") await applyTheme(themeRef.current === "dark" ? "light" : "dark"); if (action === "about") setAboutOpen(true); if (action === "notify") { setActiveView("system"); await sendSystemNotification(); } if (action === "toggle-window") await hideWindow(); if (action === "open-devtools") { if (!isTauriRuntime) return notify.message("浏览器预览模式下没有开发者工具"); try { const opened = await invoke("set_devtools", { enabled: true }); opened ? notify.success("已打开开发者工具") : notify.error("当前构建未启用开发者工具"); } catch (error) { notify.error("无法打开开发者工具", { description: String(error) }); } } if (action === "quit") await invoke("quit_app"); };
  const handleDevtoolsChange = async (checked) => { setDevtools(checked); await store.set("devtools", checked); if (isTauriRuntime && checked) { try { await invoke("set_devtools", { enabled: true }); } catch {} } notify.message(checked ? "开发者工具已开启" : "开发者工具已关闭", { description: checked ? "当前会话立即生效，重启后按保存的值初始化" : "Windows 下需重启应用才能完全禁用（F12 失效）" }); };
  const openDocuments = async () => { try { await openUrl(documentationUrl); } catch (error) { notify.error("无法打开文档", { description: String(error) }); } };
  const openAccountCenter = async (view = "profile") => { if (!isTauriRuntime) return notify.message("浏览器预览模式下无法打开独立账户窗口"); try { const existing = await WebviewWindow.getByLabel(accountWindowLabel); if (existing) { await existing.show(); await existing.setFocus(); await emitTo(accountWindowLabel, accountNavigationEvent, view); return; } const child = new WebviewWindow(accountWindowLabel, { url: `index.html?window=${accountWindowLabel}&view=${encodeURIComponent(view)}`, title: "账户中心", width: 840, height: 620, minWidth: 640, minHeight: 480, resizable: true, center: true }); child.once("tauri://error", (event) => notify.error("无法打开账户中心", { description: String(event.payload ?? "窗口创建失败") })); } catch (error) { notify.error("无法打开账户中心", { description: String(error) }); } };
  const handleLogin = async (email, password) => { const nextUser = await loginAccount(email, password); setUser(nextUser); setAuthStatus("authenticated"); };
  const handleRegister = async (email, password) => { const result = await registerAccount(email, password); setUser(result.user); setAuthStatus("authenticated"); return result; };
  const handleLogout = async () => { await logoutAccount(); setUser(null); setAuthStatus("signed_out"); };

  const updateTitlebarVisibility = async (checked) => { setShowTitlebarTitle(checked); await store.set("showTitlebarTitle", checked); };
  const updateTitlebarMode = async (mode) => { setTitlebarTitleMode(mode); await store.set("titlebarTitleMode", mode); };
  useEffect(() => { let unlistenNative; let unlistenSettings; (async () => { try { await store.init(); const [savedTheme, savedHistory, savedDevtools, savedTitlebarVisibility, savedTitlebarMode, savedSubscription, restoredUser] = await Promise.all([store.get("theme"), store.get("history"), store.get("devtools"), store.get("showTitlebarTitle"), store.get("titlebarTitleMode"), store.get("subscription"), restoreSession()]); await applyTheme(savedTheme === "dark" ? "dark" : "light", false); if (Array.isArray(savedHistory)) setHistory(savedHistory.slice(0, MAX_HISTORY)); if (typeof savedDevtools === "boolean") setDevtools(savedDevtools); if (typeof savedTitlebarVisibility === "boolean") setShowTitlebarTitle(savedTitlebarVisibility); if (savedTitlebarMode === "app" || savedTitlebarMode === "page") setTitlebarTitleMode(savedTitlebarMode); if (savedSubscription && typeof savedSubscription === "object") setSubscription({ ...subscriptionDefaults, ...savedSubscription }); setUser(restoredUser); setAuthStatus(restoredUser ? "authenticated" : "signed_out"); } catch { setAuthStatus("signed_out"); addActivity("无法连接账号服务，请检查 API 地址"); } try { unlistenNative = await listen("native-action", (event) => handleNativeAction(event.payload)); unlistenSettings = await listen("account-center:setting-changed", async (event) => { const { key, value } = event.payload ?? {}; if (key === "theme") await applyTheme(value === "dark" ? "dark" : "light", false); if (key === "devtools" && typeof value === "boolean") setDevtools(value); if (key === "showTitlebarTitle" && typeof value === "boolean") setShowTitlebarTitle(value); if (key === "titlebarTitleMode" && (value === "app" || value === "page")) setTitlebarTitleMode(value); if (["theme", "devtools", "showTitlebarTitle", "titlebarTitleMode"].includes(key)) await store.set(key, value); }); } catch { addActivity("运行在浏览器预览模式，原生事件不可用"); } })(); return () => { unlistenNative?.(); unlistenSettings?.(); }; }, []);

  useEffect(() => {
    if (!isWindows) return;
    let unlisten;
    (async () => {
      try {
        const win = getCurrentWindow();
        setIsMaximized(await win.isMaximized());
        unlisten = await win.onResized(() => { win.isMaximized().then(setIsMaximized).catch(() => {}); });
      } catch {}
    })();
    return () => unlisten?.();
  }, []);

  useEffect(() => { const suppress = (event) => event.preventDefault(); document.addEventListener("contextmenu", suppress); return () => document.removeEventListener("contextmenu", suppress); }, []);
  if (authStatus === "loading") return <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">正在恢复账号会话…</main>;
  if (authStatus === "signed_out") return <AuthScreen onLogin={handleLogin} onRegister={handleRegister} />;
  return <TooltipProvider><ContextMenu><ContextMenuTrigger className="contents select-text"><SidebarProvider desktopOnly className="min-h-0 min-w-0 flex h-svh flex-col" defaultOpen>
    <div className="app-shell flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header className="titlebar-content relative z-30 flex h-[var(--app-titlebar-height)] shrink-0 items-center border-b bg-background pl-2">
      <div className={cn("flex min-w-0 shrink-0 items-center gap-1", isMac && "pl-[68px]")}>
        <div className="flex size-7 shrink-0 items-center justify-center text-primary" aria-label="StagePilot" title="StagePilot"><Sparkles className="size-4" /></div>
        <SidebarTrigger className="shrink-0" />
        <Menubar className="shrink-0">{menuBar.map((menu) => <TitlebarMenu key={menu.label} menu={menu} onAction={handleNativeAction} />)}</Menubar>
      </div>
      {showTitlebarTitle && <div className="pointer-events-none absolute left-1/2 min-w-0 max-w-[min(40vw,320px)] -translate-x-1/2 truncate px-2 text-xs font-medium text-foreground" aria-live="polite">{titlebarTitle}</div>}
      <div className="min-w-8 flex-1 self-stretch" data-tauri-drag-region />
      {isWindows && <div className="flex h-full shrink-0 gap-0"><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={minimizeWindow}><Minus className="size-3" /></Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={toggleMaximize}>{isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}</Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px] hover:bg-destructive/15 hover:text-destructive dark:hover:bg-destructive/25" onClick={hideWindow}><X /></Button></div>}
    </header>
    <div className="flex min-h-0 min-w-0 flex-1">
      <AppSidebar activeView={activeView} onViewChange={setActiveView} onOpenDocuments={openDocuments} user={user} subscription={subscription} onOpenAccountCenter={openAccountCenter} onLogout={handleLogout} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <div className="app-content-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6"><div className="mx-auto min-w-0 max-w-6xl">{activeView === "overview" && <Overview featureCount={featureCount} />}{activeView === "files" && <FilesView history={history} currentRecord={currentRecord} choosePath={choosePath} copyCurrentPath={copyCurrentPath} clearHistory={async () => { await persistHistory([]); addActivity("已清空最近记录"); notify.success("最近记录已清空"); }} />}{activeView === "system" && <SystemView hideWindow={hideWindow} notify={sendSystemNotification} openAbout={() => setAboutOpen(true)} />}{activeView === "activity" && <ActivityView activity={activity} reset={() => setActivity(["活动记录已刷新"])} />}{activeView === "components" && <ComponentsView />}</div></div>
      </SidebarInset>
    </div>
    </div>
  </SidebarProvider><Dialog modal={false} open={aboutOpen} onOpenChange={setAboutOpen}><DialogContent><DialogHeader><DialogTitle>StagePilot</DialogTitle><DialogDescription>多租户演艺活动运营平台的桌面端基础框架。</DialogDescription></DialogHeader><div className="space-y-3 text-sm text-muted-foreground"><p>包含原生标题栏控制、侧栏、托盘、文件对话框、剪贴板、通知、单实例、窗口状态和全局快捷键。</p><p>所有高权限能力均通过 Tauri Capability 按需授权。</p></div></DialogContent></Dialog><AppSonner /></ContextMenuTrigger><ContextMenuContent className="min-w-48">{contextMenuItems.map((item, index) => item === "separator" ? <ContextMenuSeparator key={`sep-${index}`} /> : <ContextMenuItem key={item.action} onClick={() => handleNativeAction(item.action)}><item.icon /><span>{item.label}</span></ContextMenuItem>)}</ContextMenuContent></ContextMenu></TooltipProvider>;
}

function PageHeader({ title, description, action }) { return <div className="flex items-start justify-between gap-4"><div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div>{action}</div>; }
 function Overview({ featureCount }) { const cards = [[PanelTop, "原生标题栏", "保留平台窗口控制并自动避让"], [FolderOpen, "文件对话框", "调用系统文件与文件夹选择器"], [MonitorUp, "系统托盘", "关闭隐藏、左键显示、菜单操作"], [Keyboard, "全局快捷键", "Ctrl + Shift + Space 聚焦窗口"]]; return <div className="space-y-5"><PageHeader title="能力总览" description="Tauri 原生能力与 shadcn/ui 工作台。" /><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(([Icon, title, description]) => <Card key={title}><CardHeader className="space-y-3 pb-2"><div className="flex size-9 items-center justify-center rounded-none bg-primary/10 text-primary"><Icon className="size-4" /></div><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card>)}</section><Card><CardHeader><CardTitle>已接入能力</CardTitle><CardDescription>通过侧栏进入对应工作区，系统托盘仍可快速触发原生操作。</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{featureCount.map((feature) => <Badge key={feature} variant="outline">{feature}</Badge>)}</CardContent></Card></div>; }
 function FilesView({ history, currentRecord, choosePath, copyCurrentPath, clearHistory }) { return <div className="space-y-5"><PageHeader title="文件工具" description="只处理用户在系统选择框中明确选择的路径。" /><div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><Card><CardHeader><CardTitle>文件与目录</CardTitle><CardDescription>最近 5 条记录会保存到应用数据目录。</CardDescription></CardHeader><CardContent className="space-y-5"><div className="flex flex-wrap gap-2"><Button onClick={() => choosePath("file")}><FileText />选择文件</Button><Button variant="outline" onClick={() => choosePath("directory")}><Folder />选择文件夹</Button><Button variant="outline" disabled={!currentRecord} onClick={copyCurrentPath}><Copy />复制当前路径</Button></div><Card size="sm" className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>类型</TableHead><TableHead>路径</TableHead><TableHead className="text-right">时间</TableHead></TableRow></TableHeader><TableBody>{history.length ? history.map((item) => <TableRow key={`${item.path}-${item.selectedAt}`}><TableCell><Badge variant="secondary">{item.kind === "directory" ? "文件夹" : "文件"}</Badge></TableCell><TableCell className="max-w-[360px] truncate font-mono text-xs" title={item.path}>{item.path}</TableCell><TableCell className="text-right text-xs text-muted-foreground">{formatTime(item.selectedAt)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">尚未选择文件或文件夹</TableCell></TableRow>}</TableBody></Table></Card></CardContent></Card><Card><CardHeader><CardTitle>当前选择</CardTitle><CardDescription>路径可复制到系统剪贴板。</CardDescription></CardHeader><CardContent className="space-y-4">{currentRecord ? <><Card size="sm"><CardContent className="space-y-1"><p className="text-xs text-muted-foreground">{currentRecord.kind === "directory" ? "文件夹" : "文件"}</p><p className="break-all font-mono text-xs">{currentRecord.path}</p></CardContent></Card><Button className="w-full" variant="outline" onClick={copyCurrentPath}><Clipboard />复制路径</Button></> : <Card size="sm" className="border-dashed py-0"><CardContent className="p-6 text-center text-sm text-muted-foreground">选择一个文件后会显示在这里</CardContent></Card>}<Separator /><Button className="w-full" variant="ghost" onClick={clearHistory}><Trash2 />清空最近记录</Button></CardContent></Card></div></div>; }
 function SystemView({ hideWindow, notify, openAbout }) { return <div className="space-y-5"><PageHeader title="系统集成" description="窗口、托盘、通知与应用操作。" /><div className="grid min-w-0 items-start gap-5 md:grid-cols-[repeat(2,minmax(0,1fr))]"><Card><CardHeader><CardTitle>窗口与托盘</CardTitle><CardDescription>关闭主窗口会隐藏到系统托盘；托盘“退出”才会结束应用。</CardDescription></CardHeader><CardContent className="space-y-4"><StatusRow title="窗口状态恢复" description="位置与尺寸由插件自动保存" value={<Badge variant="secondary">已启用</Badge>} /><StatusRow title="系统托盘" description="左键点击即可显示或隐藏窗口" value={<Badge variant="secondary">已启用</Badge>} /><Button className="w-full" variant="outline" onClick={hideWindow}><Eye />隐藏到托盘</Button></CardContent></Card><Card><CardHeader><CardTitle>原生操作</CardTitle><CardDescription>快速触发常用的系统集成功能。</CardDescription></CardHeader><CardContent className="space-y-4"><StatusRow title="全局快捷键" description="显示并聚焦应用窗口" value={<Badge>Ctrl + Shift + Space</Badge>} /><StatusRow title="单实例" description="再次启动会聚焦当前窗口" value={<CheckCircle2 className="size-5 text-emerald-500" />} /><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={notify}><Bell />测试通知</Button><Button variant="outline" onClick={openAbout}><Info />关于</Button></div></CardContent></Card></div></div>; }
 function StatusRow({ title, description, value }) { return <Card size="sm" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"><div className="min-w-0"><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{description}</p></div><div className="shrink-0">{value}</div></Card>; }
 function ComponentsView() { const demos = [[ContextMenuDemo1, "基础菜单", "最小可用的右键菜单"], [ContextMenuDemo2, "图标操作", "剪贴板与删除等带图标的操作项"], [ContextMenuDemo3, "快捷键标注", "右对齐展示对应的键盘快捷键"], [ContextMenuDemo4, "嵌套子菜单", "子菜单挂载二级操作分组"], [ContextMenuDemo5, "分组标签", "用标签与分隔线组织长菜单"], [ContextMenuDemo6, "复选项", "带勾选状态的布尔开关项"], [ContextMenuDemo7, "单选项", "RadioGroup 单选状态切换"], [ContextMenuDemo8, "危险操作", "destructive 变体标记删除类操作"]]; return <div className="space-y-5"><PageHeader title="UI 组件" description="基于 Base UI ContextMenu 的右键菜单模式演示，区域外右键由应用自定义菜单接管。" /><section className="grid gap-4 md:grid-cols-2">{demos.map(([Demo, title, description]) => <Card key={title}><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Demo /></CardContent></Card>)}</section></div>; }
 function ActivityView({ activity, reset }) { return <div className="space-y-5"><PageHeader title="活动记录" description="页面操作、托盘和原生动作都会在此留痕。" action={<Button variant="outline" size="sm" onClick={reset}><RefreshCw />重置</Button>} /><Card><CardContent><div className="space-y-2">{activity.map((item, index) => <Card size="sm" key={`${item}-${index}`}><CardContent className="text-sm">{item}</CardContent></Card>)}</div></CardContent></Card></div>; }
export default App;
