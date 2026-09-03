import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, Info, Minus, Moon, Power, Sparkles, Square, Terminal, X } from "lucide-react";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app-sidebar";
import { AccountCenter } from "@/components/account-center";
import { NavigationProvider, useNavigationData } from "@/components/navigation-provider";
import { WorkspaceProvider, useWorkspaceContext } from "@/components/workspace-provider";
import { WorkspacesPage } from "@/components/workspaces-page";
import { WorkspaceSettingsPage } from "@/components/workspace-settings-page";
import { ProductionOverviewPage } from "@/components/production-overview-page";
import { ProductionSettingsPage } from "@/components/production-settings-page";
import { ProgramLibraryPage } from "@/components/program-library-page";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { NavigationFailure, PlaceholderPage, ProductionsPage, WorkspaceHome } from "@/components/stagepilot-pages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarRadioItem, MenubarSeparator, MenubarShortcut, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger } from "@/components/ui/menubar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSonner, notify } from "@/components/ui/sonner";
import { AuthDialog } from "@/components/auth-dialog";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import { adoptAccessToken, getAccessToken, login as loginAccount, register as registerAccount, onSessionInvalidated, restoreSession, logout as logoutAccount } from "@/lib/auth";
import { appStore, isTauriRuntime } from "@/lib/app-store";
import { matchStagePilotRoute, productionPath, workspacePath } from "@/lib/navigation";
import { createProduction, toProductionSummary, updateProduction } from "@/lib/production-api";

const documentationUrl = "https://github.com/daaihang/stagepilot";
const accountWindowLabel = "account-center";
const accountNavigationEvent = "account-center:navigate";
const accountSessionRequestEvent = "account-center:request-session";
const accountSessionEvent = "account-center:session";
const subscriptionDefaults = { plan: "free" };
const isAccountCenterWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("window") === accountWindowLabel;
const isMac = navigator.userAgent.includes("Mac");
const isWindows = navigator.userAgent.includes("Windows");
const developerActions = new Set(["open-file", "open-folder", "copy-path", "notify", "open-devtools"]);

const menuBar = [
  { label: "文件", items: [{ label: "选择文件…", action: "open-file" }, { label: "选择文件夹…", action: "open-folder" }, { label: "复制当前路径", action: "copy-path" }] },
  { label: "视图", items: [{ label: "切换深色主题", action: "toggle-theme" }, { label: "打开开发者工具", action: "open-devtools" }, { label: "隐藏到托盘", action: "toggle-window" }, "separator", { label: "发送测试通知", action: "notify" }] },
  { label: "帮助", items: [{ label: "关于 StagePilot", action: "about" }, "separator", { label: "退出", action: "quit" }] },
];

const contextMenuItems = [
  { label: "切换深色主题", action: "toggle-theme", icon: Moon },
  { label: "打开开发工具", action: "open-devtools", icon: Terminal },
  "separator",
  { label: "关于 StagePilot", action: "about", icon: Info },
  { label: "退出", action: "quit", icon: Power },
];

function TitlebarMenu({ menu, onAction }) {
  const renderItem = (item, index) => {
    if (item === "separator" || item.type === "separator") return <MenubarSeparator key={`sep-${index}`} />;
    const Icon = item.icon;
    const label = <>{Icon && <Icon />}<span>{item.label}</span>{item.shortcut && <MenubarShortcut>{item.shortcut}</MenubarShortcut>}</>;
    if (item.submenu) return <MenubarSub key={item.label}><MenubarSubTrigger>{label}</MenubarSubTrigger><MenubarSubContent>{item.submenu.map(renderItem)}</MenubarSubContent></MenubarSub>;
    if (item.type === "checkbox") return <MenubarCheckboxItem key={item.label} checked={item.checked} onCheckedChange={item.onCheckedChange}>{label}</MenubarCheckboxItem>;
    if (item.type === "radio") return <MenubarRadioItem key={item.label} value={item.value} disabled={item.disabled}>{label}</MenubarRadioItem>;
    return <MenubarItem key={item.action ?? item.label} disabled={item.disabled} data-variant={item.variant} onClick={() => item.action && onAction(item.action)}>{label}</MenubarItem>;
  };
  return <MenubarMenu><MenubarTrigger>{menu.label}</MenubarTrigger><MenubarContent>{menu.items.map(renderItem)}</MenubarContent></MenubarMenu>;
}

function AccountCenterApp() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [subscription, setSubscription] = useState(subscriptionDefaults);
  const [theme, setTheme] = useState("light");
  const [devtools, setDevtools] = useState(true);
  const [showTitlebarTitle, setShowTitlebarTitle] = useState(true);
  const [titlebarTitleMode, setTitlebarTitleMode] = useState("page");
  const applyTheme = async (nextTheme, persist = true) => { document.documentElement.classList.toggle("dark", nextTheme === "dark"); setTheme(nextTheme); if (persist) await appStore.set("theme", nextTheme); };
  const handleDevtoolsChange = async (checked) => { setDevtools(checked); await appStore.set("devtools", checked); if (isTauriRuntime && checked) { try { await invoke("set_devtools", { enabled: true }); } catch {} } notify.message(checked ? "开发者工具已开启" : "开发者工具已关闭"); };
  const updateTitlebarVisibility = async (checked) => { setShowTitlebarTitle(checked); await appStore.set("showTitlebarTitle", checked); };
  const updateTitlebarMode = async (mode) => { setTitlebarTitleMode(mode); await appStore.set("titlebarTitleMode", mode); };
  useEffect(() => onSessionInvalidated(() => setUser(null)), []);
  useEffect(() => { let active = true; (async () => { try { await appStore.init(); const [savedSubscription, savedTheme, savedDevtools, savedTitlebarVisibility, savedTitlebarMode] = await Promise.all([appStore.get("subscription"), appStore.get("theme"), appStore.get("devtools"), appStore.get("showTitlebarTitle"), appStore.get("titlebarTitleMode")]); if (!active) return; if (savedSubscription && typeof savedSubscription === "object") setSubscription({ ...subscriptionDefaults, ...savedSubscription }); await applyTheme(savedTheme === "dark" ? "dark" : "light", false); if (typeof savedDevtools === "boolean") setDevtools(savedDevtools); if (typeof savedTitlebarVisibility === "boolean") setShowTitlebarTitle(savedTitlebarVisibility); if (savedTitlebarMode === "app" || savedTitlebarMode === "page") setTitlebarTitleMode(savedTitlebarMode); } catch (error) { if (active) setSessionError(error instanceof Error ? error.message : String(error)); } })(); return () => { active = false; }; }, []);
  useEffect(() => { if (!isTauriRuntime) { setAuthReady(true); return; } let active = true; let unlisten; (async () => { try { unlisten = await listen(accountSessionEvent, (event) => { if (!active) return; const { accessToken, user: sessionUser } = event.payload ?? {}; try { adoptAccessToken(accessToken); setUser(sessionUser ?? null); } catch (error) { setSessionError(error instanceof Error ? error.message : String(error)); } finally { setAuthReady(true); } }); await emitTo("main", accountSessionRequestEvent); } catch (error) { if (active) { setSessionError(error instanceof Error ? error.message : String(error)); setAuthReady(true); } } })(); return () => { active = false; unlisten?.(); }; }, []);
  if (!authReady) return <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">正在加载账号…</main>;
  if (!user) return <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">{sessionError ? `无法读取主窗口会话：${sessionError}` : "账号会话已失效，请返回主窗口重新登录。"}</main>;
  return <AccountCenter user={user} subscription={subscription} theme={theme} applyTheme={applyTheme} devtools={devtools} onDevtoolsChange={handleDevtoolsChange} showTitlebarTitle={showTitlebarTitle} titlebarTitleMode={titlebarTitleMode} onTitlebarVisibilityChange={updateTitlebarVisibility} onTitlebarModeChange={updateTitlebarMode} />;
}

function AppLoading() {
  return <main className="flex h-full min-h-0 items-center justify-center bg-muted/20 p-6"><div className="w-full max-w-2xl space-y-4"><div className="h-8 w-48 animate-pulse bg-muted" /><div className="h-4 w-80 animate-pulse bg-muted" /><div className="grid gap-4 md:grid-cols-2"><div className="h-36 animate-pulse bg-muted" /><div className="h-36 animate-pulse bg-muted" /></div><div className="h-48 animate-pulse bg-muted" /></div></main>;
}

function UnauthenticatedHome({ onOpenAuth }) {
  return <main className="flex min-h-full items-center justify-center p-6"><Card className="w-full max-w-xl"><CardHeader><CardTitle>欢迎来到 StagePilot</CardTitle><CardDescription>登录后即可管理演出活动、制作资源和团队工作空间。</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3"><div className="border p-3">活动与制作流程</div><div className="border p-3">长期资源管理</div><div className="border p-3">团队协作空间</div></div><Button onClick={onOpenAuth}>登录或创建账号</Button></CardContent></Card></main>;
}

function RoutedMainShell({ authStatus, user, subscription, onRequireAuth, onOpenDocuments, onOpenAccountCenter, onLogout, onNativeAction, showTitlebarTitle, titlebarTitleMode, isMaximized, onMinimize, onToggleMaximize, onHide }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { status: workspaceStatus, workspaces, currentWorkspace, switchWorkspace, adoptCreatedWorkspace, error: workspaceError, retry: retryWorkspaces } = useWorkspaceContext();
  const { productionsByWorkspace, localDraftsByWorkspace, productionAliases, loadProductions, repository, setProductionsByWorkspaceEntry, createLocalDraft, updateLocalDraft, discardLocalDraft, promoteLocalDraft } = useNavigationData();
  const navigationRepositoryRef = useRef(repository);
  navigationRepositoryRef.current = repository;
  const route = matchStagePilotRoute(location.pathname);
  const isWorkspacesRoute = location.pathname === "/workspaces";
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const workspace = route ? workspaces.find((item) => item.id === route.workspaceId) : null;
  const productionsLoaded = route ? Object.prototype.hasOwnProperty.call(productionsByWorkspace, route.workspaceId) : false;
  const remoteProductions = route ? productionsByWorkspace[route.workspaceId] ?? [] : [];
  const localDrafts = route ? localDraftsByWorkspace[route.workspaceId] ?? [] : [];
  // 本地 Draft 仅用于当前会话展示；不写回 Repository，也不混入后端缓存。
  const productions = [...localDrafts, ...remoteProductions];
  // Production Context：依附 currentWorkspace/route.workspaceId；
  // 深链恢复时由 productionDetail 单独加载，绝不出现父子和 URL 不一致的状态。
  const aliasedProductionId = route?.mode === "production" ? productionAliases[route.productionId] : null;
  const productionFromList = route?.mode === "production" ? productions.find((item) => item.id === route.productionId || item.id === aliasedProductionId) : null;
  const isLocalDraftRoute = Boolean(route?.mode === "production" && route.productionId?.startsWith("local-draft-"));
  const productionDeepLink = Boolean(route?.mode === "production" && workspace && productionsLoaded && !productionFromList && !isLocalDraftRoute);
  const [productionDetail, setProductionDetail] = useState({ loading: false, production: null, failed: false });
  const [productionError, setProductionError] = useState(null);

  useEffect(() => {
    if (!productionDeepLink) return;
    let active = true;
    setProductionDetail({ loading: true, production: null, failed: false });
    const repository = navigationRepositoryRef.current;
    (async () => {
      try {
        const found = await repository.getProduction(route.workspaceId, route.productionId);
        if (!active) return;
        if (!found) {
          setProductionDetail({ loading: false, production: null, failed: true });
          return;
        }
        setProductionDetail({ loading: false, production: found, failed: false });
        setProductionsByWorkspaceEntry(route.workspaceId, found);
      } catch {
        if (active) setProductionDetail({ loading: false, production: null, failed: true });
      }
    })();
    return () => { active = false; };
  }, [productionDeepLink, route?.workspaceId, route?.productionId]);
  const production = productionFromList || (productionDeepLink && !productionDetail.loading && !productionDetail.failed ? productionDetail.production : null);
  const productionUnavailable = Boolean(productionDeepLink && !productionDetail.loading && productionDetail.failed);
  const localDraftExpired = Boolean(isLocalDraftRoute && productionsLoaded && !productionFromList && !aliasedProductionId);

  const refreshProductions = useCallback(async () => {
    if (!route?.workspaceId || !workspace) return;
    setProductionError(null);
    try { await loadProductions(route.workspaceId, { force: true }); }
    catch (nextError) { setProductionError(nextError instanceof Error ? nextError : new Error(String(nextError))); }
  }, [loadProductions, route?.workspaceId, workspace]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !route?.workspaceId || !workspace || productionsLoaded) return;
    loadProductions(route.workspaceId).catch((nextError) => setProductionError(nextError instanceof Error ? nextError : new Error(String(nextError))));
  }, [authStatus, loadProductions, productionsLoaded, route?.workspaceId, workspace]);

  // 合并下拉：每个工作空间活动预览的按需加载状态（行内呈现，不进全局错误页）。
  const [productionLoadStates, setProductionLoadStates] = useState({});
  const reloadProductionsForMenu = useCallback(async (targetWorkspaceId, { force = false } = {}) => {
    if (!targetWorkspaceId) return;
    setProductionLoadStates((current) => ({ ...current, [targetWorkspaceId]: "loading" }));
    try {
      await loadProductions(targetWorkspaceId, { force });
      setProductionLoadStates((current) => ({ ...current, [targetWorkspaceId]: "ready" }));
    } catch {
      setProductionLoadStates((current) => ({ ...current, [targetWorkspaceId]: "error" }));
    }
  }, [loadProductions]);

  // 登录后的工作空间生命周期：
  // - 无工作空间 → /workspaces onboarding（AC-01）
  // - 有可恢复/唯一的当前工作空间 → 自动进入
  // - 多个工作空间且无可恢复记录 → /workspaces selector
  useEffect(() => {
    if (authStatus !== "authenticated" || workspaceStatus === "loading") return;
    if (location.pathname !== "/") {
      if ((workspaceStatus === "none") || (workspaceStatus === "selecting")) navigate("/workspaces", { replace: true });
      return;
    }
    if (workspaceStatus === "none" || workspaceStatus === "selecting") navigate("/workspaces", { replace: true });
    else if (workspaceStatus === "ready" && currentWorkspace) navigate(workspacePath(currentWorkspace.id), { replace: true });
  }, [authStatus, workspaceStatus, currentWorkspace, location.pathname, navigate]);

  // 已登录状态下访问 /w/:id/* 且 id 不在可访问列表时，渲染不可访问页面。
  const workspaceForbidden = Boolean(route && authStatus === "authenticated" && workspaceStatus === "ready" && !workspace);

  const changeWorkspace = async (nextWorkspace) => {
    if (!nextWorkspace || nextWorkspace.id === workspace?.id) return;
    try {
      await switchWorkspace(nextWorkspace.id);
      navigate(workspacePath(nextWorkspace.id));
      notify.info(`已切换到 ${nextWorkspace.name}`);
    } catch (nextError) { notify.error("无法切换工作空间", { description: String(nextError) }); }
  };

  // 合并下拉的动作集：进入工作台 / 打开活动（必要时先切空间）/ 查看全部活动。
  const enterWorkspace = async (nextWorkspace) => {
    if (!nextWorkspace) return;
    if (nextWorkspace.id === workspace?.id) {
      if (!route || route.workspaceId !== nextWorkspace.id) navigate(workspacePath(nextWorkspace.id));
      return;
    }
    await changeWorkspace(nextWorkspace);
  };

  const openProduction = async (targetWorkspace, nextProduction) => {
    if (!targetWorkspace || !nextProduction || nextProduction.isLocalDraft) return;
    if (targetWorkspace.id !== workspace?.id) {
      try {
        await switchWorkspace(targetWorkspace.id);
      } catch (nextError) {
        notify.error("无法切换工作空间", { description: String(nextError) });
        return;
      }
    }
    navigate(productionPath(targetWorkspace.id, nextProduction.id));
    if (targetWorkspace.id !== workspace?.id) notify.info(`已切换到 ${targetWorkspace.name}`);
  };

  const viewAllProductions = async (targetWorkspace) => {
    if (!targetWorkspace) return;
    if (targetWorkspace.id !== workspace?.id) {
      try {
        await switchWorkspace(targetWorkspace.id);
      } catch (nextError) {
        notify.error("无法切换工作空间", { description: String(nextError) });
        return;
      }
    }
    navigate(workspacePath(targetWorkspace.id, "productions"));
    if (targetWorkspace.id !== workspace?.id) notify.info(`已切换到 ${targetWorkspace.name}`);
  };

  const createDraft = () => {
    if (!workspace) return null;
    const draft = createLocalDraft(workspace.id);
    notify.info("已打开前端草稿", { description: "它只存在于当前窗口，暂不会保存到服务器。" });
    return draft;
  };
  const updateDraft = async (patch) => {
    if (!workspace || !production) return false;
    const next = { ...production, ...patch };
    if (next.startsAt && next.endsAt && new Date(next.endsAt) < new Date(next.startsAt)) {
      notify.error("无法保存活动信息", { description: "结束时间不能早于开始时间。" });
      return false;
    }
    const hasMeaningfulInfo = Boolean(
      (next.name?.trim() && !/^活动-\d+$/.test(next.name.trim())) ||
      next.startsAt || next.endsAt || next.venue?.trim() || next.description?.trim() ||
      (next.timezone && next.timezone !== "Asia/Shanghai"),
    );
    try {
      if (production.isLocalDraft) {
        if (!hasMeaningfulInfo) {
          updateLocalDraft(workspace.id, production.id, patch);
          return true;
        }
        const created = await createProduction(workspace.id, {
          name: next.name.trim(), description: next.description?.trim() || "", timezone: next.timezone || "Asia/Shanghai",
          startAt: next.startsAt || null, endAt: next.endsAt || null, status: "active",
        });
        promoteLocalDraft(workspace.id, production.id, toProductionSummary(created));
        notify.success("活动已启用", { description: "基础信息已保存，活动导航已解锁。" });
        return true;
      }
      const body = {};
      if (Object.prototype.hasOwnProperty.call(patch, "name")) body.name = String(patch.name).trim();
      if (Object.prototype.hasOwnProperty.call(patch, "description")) body.description = String(patch.description ?? "").trim();
      if (Object.prototype.hasOwnProperty.call(patch, "timezone")) body.timezone = patch.timezone;
      if (Object.prototype.hasOwnProperty.call(patch, "startsAt")) body.start_at = patch.startsAt || null;
      if (Object.prototype.hasOwnProperty.call(patch, "endsAt")) body.end_at = patch.endsAt || null;
      if (!Object.keys(body).length) return true;
      const updated = await updateProduction(workspace.id, production.id, body);
      setProductionsByWorkspaceEntry(workspace.id, toProductionSummary(updated));
      notify.success("活动信息已保存");
      return true;
    } catch (nextError) {
      notify.error("无法保存活动信息", { description: nextError instanceof Error ? nextError.message : String(nextError) });
      return false;
    }
  };
  const discardDraft = () => {
    if (!workspace || !production?.isLocalDraft) return;
    discardLocalDraft(workspace.id, production.id);
    notify.success("已放弃前端草稿");
    navigate(workspacePath(workspace.id, "productions"), { replace: true });
  };
  const pageTitle = titlebarTitleMode === "app" ? "StagePilot" : route?.meta.title ?? "StagePilot";

  let content;
  if (authStatus === "loading" || (authStatus === "authenticated" && workspaceStatus === "loading")) content = <AppLoading />;
  else if (authStatus !== "authenticated") content = <UnauthenticatedHome onOpenAuth={onRequireAuth} />;
  else if (isWorkspacesRoute) content = <WorkspacesPage onCreateWorkspace={() => setCreateWorkspaceOpen(true)} />;
  else if (workspaceError) content = <NavigationFailure description={workspaceError.message} onRetry={retryWorkspaces} />;
  else if (location.pathname === "/") content = <AppLoading />;
  else if (!route) content = <NavigationFailure title="页面不存在" description="这个 StagePilot 页面地址无效或已经移动。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : undefined} />;
  else if (workspaceForbidden) content = <NavigationFailure title="工作空间不可访问" description="你访问的工作空间不存在，或者当前账号无权访问。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : (workspaces[0] ? workspacePath(workspaces[0].id) : undefined)} />;
  else if (!workspace) content = <NavigationFailure title="工作空间不存在" description="你访问的工作空间不存在，或者当前账号无权访问。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : undefined} />;
  else if (localDraftExpired) content = <NavigationFailure title="草稿预览已结束" description="这个前端草稿只保存在创建它的当前窗口中。刷新或重新打开后不会恢复。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (productionError) content = <NavigationFailure title="无法加载活动" description={productionError.message} onRetry={refreshProductions} homePath={workspacePath(workspace.id)} />;
  else if (productionUnavailable) content = <NavigationFailure title="活动不可访问" description="这场活动不存在、已归档，或者不属于当前工作空间。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (productionDeepLink && !production) content = <AppLoading />;
  else if (route.mode === "production" && !productionsLoaded) content = <AppLoading />;
  else if (route.mode === "workspace" && route.page === "home") content = <WorkspaceHome route={route} workspace={workspace} productions={productions} />;
  else if (route.mode === "workspace" && route.page === "productions") content = <ProductionsPage route={route} workspace={workspace} productions={productions} loading={!productionsLoaded} onCreateDraft={createDraft} />;
  else if (route.mode === "workspace" && route.page === "programs") content = <ProgramLibraryPage workspace={workspace} />;
  else if (route.mode === "workspace" && route.page === "settings") content = <WorkspaceSettingsPage workspaceId={workspace.id} key={workspace.id} />;
  else if (route.mode === "production" && route.page === "overview") content = <ProductionOverviewPage workspace={workspace} production={production} onUpdateDraft={updateDraft} onDiscardDraft={discardDraft} key={route.productionId} />;
  else if (route.mode === "production" && production?.isLocalDraft) content = <NavigationFailure title="前端草稿仅提供概览" description="基础资料可在活动概览中填写；其他活动模块会在后端 Draft 接入后开放。" homePath={productionPath(workspace.id, production.id, "overview")} />;
  else if (route.mode === "production" && route.page === "settings") content = <ProductionSettingsPage workspace={workspace} production={production} key={production.id} />;
  else content = <PlaceholderPage route={route} workspace={workspace} production={production} />;

  const handleWorkspaceCreated = async (created) => {
    await adoptCreatedWorkspace(created);
    navigate(workspacePath(created.id), { replace: true });
  };

  return <SidebarProvider desktopOnly className="min-h-0 min-w-0 flex h-svh flex-col" defaultOpen><div className="app-shell flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header className="titlebar-content relative z-30 flex h-[var(--app-titlebar-height)] shrink-0 items-center border-b bg-background pl-2"><div className={cn("flex min-w-0 shrink-0 items-center gap-1", isMac && "pl-[68px]")}><div className="flex size-7 shrink-0 items-center justify-center text-primary" aria-label="StagePilot" title="StagePilot"><Sparkles className="size-4" /></div><SidebarTrigger className="shrink-0" /><Menubar className="shrink-0">{menuBar.map((menu) => <TitlebarMenu key={menu.label} menu={menu} onAction={onNativeAction} />)}</Menubar></div>{showTitlebarTitle && <div className="pointer-events-none absolute left-1/2 max-w-[min(40vw,320px)] -translate-x-1/2 truncate px-2 text-xs font-medium" aria-live="polite">{pageTitle}</div>}<div className="min-w-8 flex-1 self-stretch" data-tauri-drag-region />{isWindows && <div className="flex h-full shrink-0"><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={onMinimize}><Minus className="size-3" /></Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={onToggleMaximize}>{isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}</Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px] hover:bg-destructive/15 hover:text-destructive" onClick={onHide}><X /></Button></div>}</header>
    <div className="flex min-h-0 min-w-0 flex-1"><AppSidebar route={route} workspaces={workspaces} workspace={workspace} production={production} productions={productions} productionsByWorkspace={productionsByWorkspace} productionLoadStates={productionLoadStates} workspaceSelectionMode={isWorkspacesRoute} onEnterWorkspace={enterWorkspace} onOpenProduction={openProduction} onViewAllProductions={viewAllProductions} onReloadProductions={reloadProductionsForMenu} onCreateWorkspace={() => setCreateWorkspaceOpen(true)} onManageWorkspaces={() => navigate("/workspaces")} onOpenDocuments={onOpenDocuments} user={user} subscription={subscription} onOpenAccountCenter={onOpenAccountCenter} onLogout={onLogout} onRequireAuth={onRequireAuth} /><SidebarInset className="min-h-0 min-w-0 overflow-hidden"><div className="app-content-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6"><div className="mx-auto min-h-full min-w-0 max-w-6xl">{content}</div></div></SidebarInset></div>
  </div><CreateWorkspaceDialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen} onCreated={handleWorkspaceCreated} /></SidebarProvider>;
}

function SafeRoutedMainShell(props) {
  const location = useLocation();
  return <AppErrorBoundary resetKey={`${location.pathname}${location.search}`}><RoutedMainShell {...props} /></AppErrorBoundary>;
}

function MainApp() {
  const [theme, setTheme] = useState("light");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [devtools, setDevtools] = useState(true);
  const [showTitlebarTitle, setShowTitlebarTitle] = useState(true);
  const [titlebarTitleMode, setTitlebarTitleMode] = useState("page");
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("loading");
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [subscription, setSubscription] = useState(subscriptionDefaults);
  const themeRef = useRef("light");
  const applyTheme = async (nextTheme, persist = true) => { document.documentElement.classList.toggle("dark", nextTheme === "dark"); themeRef.current = nextTheme; setTheme(nextTheme); if (persist) await appStore.set("theme", nextTheme); };
  const hideWindow = async () => { try { await getCurrentWindow().hide(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const minimizeWindow = async () => { try { await getCurrentWindow().minimize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const toggleMaximize = async () => { try { await getCurrentWindow().toggleMaximize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const openDocuments = async () => { try { await openUrl(documentationUrl); notify.success("已打开帮助文档"); } catch (error) { notify.error("无法打开文档", { description: String(error) }); } };

  const openAccountCenter = useCallback(async (view = "profile", developerAction) => {
    if (!isTauriRuntime) return notify.message("浏览器预览模式下无法打开独立账户窗口");
    const toastId = notify.loading("正在打开账户中心…");
    try {
      const existing = await WebviewWindow.getByLabel(accountWindowLabel);
      if (existing) {
        await existing.show(); await existing.setFocus(); await emitTo(accountWindowLabel, accountNavigationEvent, view);
        if (developerAction) await emitTo(accountWindowLabel, "account-center:developer-action", developerAction);
        notify.success("已打开账户中心", { id: toastId }); return;
      }
      const params = new URLSearchParams({ window: accountWindowLabel, view });
      if (developerAction) params.set("action", developerAction);
      const child = new WebviewWindow(accountWindowLabel, { url: `index.html?${params}`, title: "账户中心", width: 920, height: 680, minWidth: 640, minHeight: 480, resizable: true, center: true });
      child.once("tauri://created", () => notify.success("已打开账户中心", { id: toastId }));
      child.once("tauri://error", (event) => notify.error("无法打开账户中心", { id: toastId, description: String(event.payload ?? "窗口创建失败") }));
    } catch (error) { notify.error("无法打开账户中心", { id: toastId, description: String(error) }); }
  }, []);

  const handleNativeAction = useCallback(async (action) => {
    if (developerActions.has(action)) { if (import.meta.env.DEV) await openAccountCenter("developer", action); else notify.message("此功能仅在开发构建中提供"); return; }
    if (action === "toggle-theme") await applyTheme(themeRef.current === "dark" ? "light" : "dark");
    if (action === "about") setAboutOpen(true);
    if (action === "toggle-window") await hideWindow();
    if (action === "quit") await invoke("quit_app");
  }, [openAccountCenter]);

  const handleLogin = async (email, password) => { const nextUser = await loginAccount(email, password); setUser(nextUser); setAuthStatus("authenticated"); setAuthDialogOpen(false); };
  const handleRegister = async (email, password) => { const result = await registerAccount(email, password); setUser(result.user); setAuthStatus("authenticated"); setAuthDialogOpen(false); return result; };
  const handleLogout = async () => { const result = await logoutAccount(); setUser(null); setAuthStatus("signed_out"); setAuthDialogOpen(true); if (result.remotelyRevoked) notify.success("已退出登录"); else notify.warning("已清除本机登录信息", { description: "无法连接服务端，会话会在到期后失效。" }); };

  useEffect(() => onSessionInvalidated(({ reason }) => {
    setUser(null);
    setAuthStatus("signed_out");
    setAuthDialogOpen(true);
    if (reason === "refresh_failed") notify.error("登录状态已失效", { description: "请重新登录后继续。" });
  }), []);

  useEffect(() => { if (!isTauriRuntime) return; let unlisten; listen(accountSessionRequestEvent, () => { const accessToken = getAccessToken(); emitTo(accountWindowLabel, accountSessionEvent, { accessToken, user }).catch(() => {}); }).then((cleanup) => { unlisten = cleanup; }); return () => unlisten?.(); }, [user]);

  useEffect(() => { let unlistenNative; let unlistenSettings; (async () => { try { await appStore.init(); const [savedTheme, savedDevtools, savedTitlebarVisibility, savedTitlebarMode, savedSubscription, restoredUser] = await Promise.all([appStore.get("theme"), appStore.get("devtools"), appStore.get("showTitlebarTitle"), appStore.get("titlebarTitleMode"), appStore.get("subscription"), restoreSession()]); await applyTheme(savedTheme === "dark" ? "dark" : "light", false); if (typeof savedDevtools === "boolean") setDevtools(savedDevtools); if (typeof savedTitlebarVisibility === "boolean") setShowTitlebarTitle(savedTitlebarVisibility); if (savedTitlebarMode === "app" || savedTitlebarMode === "page") setTitlebarTitleMode(savedTitlebarMode); if (savedSubscription && typeof savedSubscription === "object") setSubscription({ ...subscriptionDefaults, ...savedSubscription }); setUser(restoredUser); setAuthStatus(restoredUser ? "authenticated" : "signed_out"); setAuthDialogOpen(!restoredUser); } catch { setAuthStatus("signed_out"); setAuthDialogOpen(true); }
    if (isTauriRuntime) { try { unlistenNative = await listen("native-action", (event) => handleNativeAction(event.payload)); unlistenSettings = await listen("account-center:setting-changed", async (event) => { const { key, value } = event.payload ?? {}; if (key === "theme") await applyTheme(value === "dark" ? "dark" : "light", false); if (key === "devtools" && typeof value === "boolean") setDevtools(value); if (key === "showTitlebarTitle" && typeof value === "boolean") setShowTitlebarTitle(value); if (key === "titlebarTitleMode" && (value === "app" || value === "page")) setTitlebarTitleMode(value); if (["theme", "devtools", "showTitlebarTitle", "titlebarTitleMode"].includes(key)) await appStore.set(key, value); }); } catch {} }
    })(); return () => { unlistenNative?.(); unlistenSettings?.(); }; }, [handleNativeAction]);

  useEffect(() => { if (!isWindows) return; let unlisten; (async () => { try { const win = getCurrentWindow(); setIsMaximized(await win.isMaximized()); unlisten = await win.onResized(() => win.isMaximized().then(setIsMaximized).catch(() => {})); } catch {} })(); return () => unlisten?.(); }, []);
  useEffect(() => { const suppress = (event) => event.preventDefault(); document.addEventListener("contextmenu", suppress); return () => document.removeEventListener("contextmenu", suppress); }, []);

  return <TooltipProvider><ContextMenu><ContextMenuTrigger className="contents select-text"><HashRouter><NavigationProvider><WorkspaceProvider><SafeRoutedMainShell authStatus={authStatus} user={user} subscription={subscription} onRequireAuth={() => setAuthDialogOpen(true)} onOpenDocuments={openDocuments} onOpenAccountCenter={openAccountCenter} onLogout={handleLogout} onNativeAction={handleNativeAction} showTitlebarTitle={showTitlebarTitle} titlebarTitleMode={titlebarTitleMode} isMaximized={isMaximized} onMinimize={minimizeWindow} onToggleMaximize={toggleMaximize} onHide={hideWindow} /></WorkspaceProvider></NavigationProvider></HashRouter><AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} onLogin={handleLogin} onRegister={handleRegister} /><Dialog modal={false} open={aboutOpen} onOpenChange={setAboutOpen}><DialogContent><DialogHeader><DialogTitle>StagePilot</DialogTitle><DialogDescription>多租户演艺活动运营平台。</DialogDescription></DialogHeader><p className="text-sm text-muted-foreground">Workspace 沉淀长期资产，Production 组织一场活动的筹备与现场执行。</p></DialogContent></Dialog><AppSonner /></ContextMenuTrigger><ContextMenuContent className="min-w-48">{contextMenuItems.map((item, index) => item === "separator" ? <ContextMenuSeparator key={`sep-${index}`} /> : <ContextMenuItem key={item.action} onClick={() => handleNativeAction(item.action)}><item.icon /><span>{item.label}</span></ContextMenuItem>)}</ContextMenuContent></ContextMenu></TooltipProvider>;
}

function App() { return isAccountCenterWindow ? <AccountCenterApp /> : <MainApp />; }

export default App;
