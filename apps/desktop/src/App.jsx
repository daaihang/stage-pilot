import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, Info, Minus, Moon, Power, Sparkles, Square, Terminal, X } from "@/components/ui/icons";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app-sidebar";
import { AppContentLayout } from "@/components/app-content-layout";
import { AccountCenter } from "@/components/account-center";
import { DeveloperTools } from "@/components/developer-tools";
import { PageChromeProvider, PageDetailTitlebarAction } from "@/components/page-chrome";
import { WindowDetailHost, WindowDetailProvider } from "@/components/window-detail-context";
import { NavigationProvider, useNavigationData } from "@/components/navigation-provider";
import { WorkspaceProvider, useWorkspaceContext } from "@/components/workspace-provider";
import { WorkspacesPage } from "@/components/workspaces-page";
import { UnifiedWorkContextPage } from "@/components/unified-work-context-page";
import { WorkspaceSettingsPage } from "@/components/workspace-settings-page";
import { ProductionOverviewPage } from "@/components/production-overview-page";
import { ProductionSettingsPage } from "@/components/production-settings-page";
import { ProductionMembersPage, ProductionRolesPage } from "@/components/production-access-pages";
import { ProductionInvitePage } from "@/components/production-invite-page";
import { ProgramLibraryPage } from "@/components/program-library-page";
import { ProgramTypeManagementPage } from "@/components/program-type-management-page";
import { VenueTypeManagementPage } from "@/components/venue-type-management-page";
import { FileTypeManagementPage } from "@/components/file-type-management-page";
import { ResourceDetailPage, WorkspaceResourcePage } from "@/components/workspace-resource-pages";
import { FilesPage } from "@/components/files-page";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { NavigationFailure, PlaceholderPage, ProductionsPage, WorkspaceHome } from "@/components/stagepilot-pages";
import { ProductionPlanningPlaceholderPage } from "@/components/production-planning-placeholder-page";
import { WorkspaceMembersPage, WorkspaceRolesPage } from "@/components/workspace-access-pages";
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
import { login as loginAccount, register as registerAccount, onSessionInvalidated, restoreSession, logout as logoutAccount } from "@/lib/auth";
import { appStore, getRecentContexts, isTauriRuntime, saveRecentContext } from "@/lib/app-store";
import { accountPath, buildBreadcrumbItems, directProductionPath, matchStagePilotRoute, productionPath, resolveAccountReturnTarget, workspacePath } from "@/lib/navigation";
import { TitlebarBreadcrumbs } from "@/components/titlebar-breadcrumbs";
import { createProduction, getAccessibleProduction, toProductionSummary, updateAccessibleProduction, updateProduction } from "@/lib/production-api";

const documentationUrl = "https://github.com/daaihang/stagepilot";
const subscriptionDefaults = { plan: "free" };
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

function AppLoading() {
  return <main className="flex h-full min-h-0 items-center justify-center bg-muted/20 p-6"><div className="w-full max-w-2xl space-y-4"><div className="h-8 w-48 animate-pulse bg-muted" /><div className="h-4 w-80 animate-pulse bg-muted" /><div className="grid gap-4 md:grid-cols-2"><div className="h-36 animate-pulse bg-muted" /><div className="h-36 animate-pulse bg-muted" /></div><div className="h-48 animate-pulse bg-muted" /></div></main>;
}

function UnauthenticatedHome({ onOpenAuth }) {
  return <main className="flex min-h-full items-center justify-center p-6"><Card className="w-full max-w-xl"><CardHeader><CardTitle>欢迎来到 StagePilot</CardTitle><CardDescription>登录后即可管理演出活动、制作资源和团队工作空间。</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3"><div className="border p-3">活动与制作流程</div><div className="border p-3">长期资源管理</div><div className="border p-3">团队协作空间</div></div><Button onClick={onOpenAuth}>登录或创建账号</Button></CardContent></Card></main>;
}

function RoutedMainShell({ authStatus, user, onUserUpdate, subscription, theme, applyTheme, devtools, onDevtoolsChange, onRequireAuth, onOpenDocuments, onLogout, onNativeAction, showTitlebarTitle, titlebarTitleMode, onTitlebarVisibilityChange, onTitlebarModeChange, sidebarRailEnabled, onSidebarRailChange, contentWidth, onContentWidthChange, isMaximized, onMinimize, onToggleMaximize, onHide }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { status: workspaceStatus, workspaces, currentWorkspace, switchWorkspace, adoptCreatedWorkspace, error: workspaceError, retry: retryWorkspaces } = useWorkspaceContext();
  const { productionsByWorkspace, creationSession, loadProductions, repository, setProductionsByWorkspaceEntry, createCreationSession, updateCreationSession, discardCreationSession, getCreationSession } = useNavigationData();
  const navigationRepositoryRef = useRef(repository);
  const creationRequestRef = useRef(null);
  const creationRouteIdRef = useRef(null);
  const [creationRequestPending, setCreationRequestPending] = useState(false);
  const [detailModalActive, setDetailModalActive] = useState(false);
  navigationRepositoryRef.current = repository;
  const route = matchStagePilotRoute(location.pathname, location.search);
  const [directProductionState, setDirectProductionState] = useState({ id: "", loading: false, value: null, failed: false });
  const isWorkspacesRoute = location.pathname === "/workspaces";
  const isWorkRoute = route?.mode === "work";
  const isInviteRoute = route?.mode === "invite";
  const isAccountRoute = route?.mode === "account";
  const accountReturnPath = isAccountRoute ? resolveAccountReturnTarget(location.search, currentWorkspace ? workspacePath(currentWorkspace.id) : "/workspaces") : null;
  const accountReturnRoute = accountReturnPath ? matchStagePilotRoute(accountReturnPath.split("?")[0]) : null;
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [recentContexts, setRecentContexts] = useState([]);
  const recentContextAccountKey = user?.id || user?.email || "anonymous";
  useEffect(() => {
    let active = true;
    if (authStatus !== "authenticated") { setRecentContexts([]); return undefined; }
    getRecentContexts(recentContextAccountKey).then((items) => { if (active) setRecentContexts(items); });
    return () => { active = false; };
  }, [authStatus, recentContextAccountKey]);
  const rememberContext = useCallback(async (context) => {
    const next = await saveRecentContext(recentContextAccountKey, { ...context, lastOpenedAt: Date.now() });
    setRecentContexts(next);
  }, [recentContextAccountKey]);
  const workspace = route?.direct && directProductionState.value ? { id: directProductionState.value.workspaceId, name: directProductionState.value.workspaceName, role: directProductionState.value.workspaceRole, plan: "活动协作者", workspaceNavigable: directProductionState.value.workspaceNavigable } : (route ? workspaces.find((item) => item.id === route.workspaceId) : null);
  const productionsLoaded = route ? Object.prototype.hasOwnProperty.call(productionsByWorkspace, route.workspaceId) : false;
  const remoteProductions = route ? productionsByWorkspace[route.workspaceId] ?? [] : [];
  const productions = remoteProductions;
  const isProductionRoute = route?.mode === "production";
  useEffect(() => {
    if (!route?.direct || authStatus !== "authenticated") return undefined;
    let active = true;
    setDirectProductionState({ id: route.productionId, loading: true, value: null, failed: false });
    getAccessibleProduction(route.productionId).then((value) => {
      if (active) setDirectProductionState({ id: route.productionId, loading: false, value: toProductionSummary(value), failed: false });
    }).catch(() => { if (active) setDirectProductionState({ id: route.productionId, loading: false, value: null, failed: true }); });
    return () => { active = false; };
  }, [authStatus, route?.direct, route?.productionId]);
  // Production Context：依附 currentWorkspace/route.workspaceId；
  // 深链恢复时由 productionDetail 单独加载，绝不出现父子和 URL 不一致的状态。
  const creationRoute = Boolean(isProductionRoute && creationSession?.id === route.productionId && creationSession.workspaceId === route.workspaceId);
  const isCreationSessionRoute = Boolean(isProductionRoute && route.productionId?.startsWith("creation-session-"));
  if (creationRoute) creationRouteIdRef.current = creationSession.id;
  const productionFromList = isProductionRoute ? productions.find((item) => item.id === route.productionId) : null;
  const productionRouteKey = isProductionRoute ? `${route.workspaceId}:${route.productionId}` : null;
  const productionDeepLink = Boolean(isProductionRoute && workspace && productionsLoaded && !productionFromList && !creationRoute && !isCreationSessionRoute);
  const [productionDetail, setProductionDetail] = useState({ key: null, loading: false, production: null, failed: false });
  const [productionError, setProductionError] = useState(null);
  const routeProductionDetail = productionDetail.key === productionRouteKey ? productionDetail : null;
  const productionDetailLoading = Boolean(productionDeepLink && (!routeProductionDetail || routeProductionDetail.loading));

  useEffect(() => {
    if (!productionDeepLink) {
      if (!productionRouteKey) setProductionDetail((current) => current.key === null ? current : { key: null, loading: false, production: null, failed: false });
      return undefined;
    }
    const requestKey = productionRouteKey;
    let active = true;
    setProductionDetail({ key: requestKey, loading: true, production: null, failed: false });
    const repository = navigationRepositoryRef.current;
    (async () => {
      try {
        const found = await repository.getProduction(route.workspaceId, route.productionId);
        if (!active) return;
        if (!found) {
          setProductionDetail({ key: requestKey, loading: false, production: null, failed: true });
          return;
        }
        setProductionDetail({ key: requestKey, loading: false, production: found, failed: false });
        setProductionsByWorkspaceEntry(route.workspaceId, found);
      } catch {
        if (active) setProductionDetail({ key: requestKey, loading: false, production: null, failed: true });
      }
    })();
    return () => { active = false; };
  }, [productionDeepLink, productionRouteKey, route?.workspaceId, route?.productionId, setProductionsByWorkspaceEntry]);
  const production = route?.direct ? directProductionState.value : (productionFromList || (creationRoute ? creationSession : null) || (productionDeepLink && routeProductionDetail && !routeProductionDetail.loading && !routeProductionDetail.failed ? routeProductionDetail.production : null));
  const productionUnavailable = Boolean(productionDeepLink && routeProductionDetail && !routeProductionDetail.loading && routeProductionDetail.failed);
  const creationSessionExpired = Boolean(isCreationSessionRoute && !creationRoute);

  useEffect(() => {
    if (authStatus !== "authenticated" || !route || !workspace) return;
    if (route.mode === "production" && production && !production.isCreationSession) {
      void rememberContext({ type: "production", id: production.id, name: production.name, path: route.direct ? directProductionPath(production.id) : productionPath(workspace.id, production.id), workspaceId: workspace.id, workspaceName: workspace.name });
      return;
    }
    if (route.mode === "workspace") {
      void rememberContext({ type: "workspace", id: workspace.id, name: workspace.name, path: workspacePath(workspace.id) });
    }
  }, [authStatus, location.pathname, production, rememberContext, route?.mode, route?.workspaceId, workspace]);

  useEffect(() => {
    setProductionError(null);
  }, [route?.workspaceId]);

  useEffect(() => {
    if (!creationSession || !creationRouteIdRef.current || creationRoute || creationRequestPending) return;
    discardCreationSession(creationSession.id);
    creationRouteIdRef.current = null;
  }, [creationRoute, creationRequestPending, creationSession, discardCreationSession]);

  useEffect(() => {
    if (authStatus !== "authenticated" && creationSession) {
      discardCreationSession(creationSession.id);
      creationRouteIdRef.current = null;
    }
  }, [authStatus, creationSession, discardCreationSession]);

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
    if (isAccountRoute || isWorkRoute || isInviteRoute || route?.direct) return;
    if (location.pathname !== "/") {
      if ((workspaceStatus === "none") || (workspaceStatus === "selecting")) navigate("/workspaces", { replace: true });
      return;
    }
    if (workspaceStatus === "none" || workspaceStatus === "selecting") navigate("/workspaces", { replace: true });
    else if (workspaceStatus === "ready" && currentWorkspace) navigate(workspacePath(currentWorkspace.id), { replace: true });
  }, [authStatus, workspaceStatus, currentWorkspace, location.pathname, navigate, isAccountRoute, isWorkRoute, isInviteRoute, route?.direct]);

  // 已登录状态下访问 /w/:id/* 且 id 不在可访问列表时，渲染不可访问页面。
  const workspaceForbidden = Boolean(route && !route.direct && authStatus === "authenticated" && workspaceStatus === "ready" && !workspace);

  const changeWorkspace = async (nextWorkspace) => {
    if (!nextWorkspace || nextWorkspace.id === workspace?.id) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    try {
      await switchWorkspace(nextWorkspace.id);
      if (creationSession) discardCreationSession(creationSession.id);
      navigate(workspacePath(nextWorkspace.id));
      notify.info(`已切换到 ${nextWorkspace.name}`);
    } catch (nextError) { notify.error("无法切换工作空间", { description: String(nextError) }); }
  };

  // 合并下拉的动作集：进入工作台 / 打开活动（必要时先切空间）/ 查看全部活动。
  const enterWorkspace = async (nextWorkspace) => {
    if (!nextWorkspace) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (nextWorkspace.id === workspace?.id) {
      if (creationSession) discardCreationSession(creationSession.id);
      navigate(workspacePath(nextWorkspace.id), { replace: Boolean(creationSession) });
      return;
    }
    await changeWorkspace(nextWorkspace);
  };

  const openProduction = async (targetWorkspace, nextProduction) => {
    if (!targetWorkspace || !nextProduction || nextProduction.isCreationSession) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (creationSession) discardCreationSession(creationSession.id);
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

  const openRecentContext = async (item) => {
    if (!item?.path) return;
    if (creationRequestPending && creationSession) { notify.info("正在创建活动，请稍候"); return; }
    if (item.workspaceId && item.workspaceId !== workspace?.id) {
      try { await switchWorkspace(item.workspaceId); }
      catch (nextError) { notify.error("无法切换工作空间", { description: String(nextError) }); return; }
    }
    if (creationSession) discardCreationSession(creationSession.id);
    navigate(item.path);
  };

  const viewAllProductions = async (targetWorkspace) => {
    if (!targetWorkspace) return;
    if (creationRequestPending && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (creationSession) discardCreationSession(creationSession.id);
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

  const createCreation = () => {
    if (!workspace) return null;
    const session = createCreationSession(workspace.id);
    if (session && route?.mode !== "production") navigate(productionPath(workspace.id, session.id));
    return session;
  };
  const createCreationFromHome = () => {
    createCreation();
  };
  const openWorkspaceProductions = () => navigate(workspacePath(workspace.id, "productions"));
  const openWorkspaceCalendar = () => navigate(workspacePath(workspace.id, "calendar"));
  const updateProductionData = async (patch) => {
    if (!workspace || !production) return false;
    const next = { ...production, ...patch };
    if (next.plannedStartAt && next.plannedEndAt && new Date(next.plannedEndAt) < new Date(next.plannedStartAt)) {
      notify.error("无法保存活动信息", { description: "结束时间不能早于开始时间。" });
      return false;
    }
    const hasMeaningfulInfo = Boolean(
      (next.name?.trim() && next.name.trim() !== (next.defaultName || "活动-0")) ||
      next.plannedStartAt || next.plannedEndAt || next.description?.trim() ||
      (next.timezone && next.timezone !== "Asia/Shanghai"),
    );
    try {
      if (production.isCreationSession) {
        if (!hasMeaningfulInfo) {
          updateCreationSession(production.id, patch);
          return true;
        }
        // 失焦事件可能在请求已经开始后继续到达；保留它们，创建完成后再作为正式活动修改提交。
        if (creationRequestRef.current) {
          updateCreationSession(production.id, patch);
          return creationRequestRef.current;
        }
        const latest = updateCreationSession(production.id, patch) || { ...production, ...patch };
        setCreationRequestPending(true);
        const request = (async () => {
          try {
            const created = await createProduction(workspace.id, {
              name: latest.name?.trim() || production.name, description: latest.description?.trim() || "", timezone: latest.timezone || "Asia/Shanghai",
              plannedStartAt: latest.plannedStartAt || null, plannedEndAt: latest.plannedEndAt || null,
            });
            const latestSession = getCreationSession() || latest;
            const summary = { ...toProductionSummary(created), venue: latestSession.venue || "" };
            setProductionsByWorkspaceEntry(workspace.id, summary);
            discardCreationSession(production.id);
            creationRouteIdRef.current = null;
            navigate(productionPath(workspace.id, created.id, "overview"), { replace: true });
            notify.success("活动已创建", { description: "基础信息已保存，活动导航已解锁。" });
            return true;
          } catch (nextError) {
            notify.error("无法创建活动", { description: nextError instanceof Error ? nextError.message : String(nextError) });
            return false;
          } finally {
            creationRequestRef.current = null;
            setCreationRequestPending(false);
          }
        })();
        creationRequestRef.current = request;
        return request;
      }
      const body = {};
      if (Object.prototype.hasOwnProperty.call(patch, "name")) body.name = String(patch.name).trim();
      if (Object.prototype.hasOwnProperty.call(patch, "description")) body.description = String(patch.description ?? "").trim();
      if (Object.prototype.hasOwnProperty.call(patch, "timezone")) body.timezone = patch.timezone;
      if (Object.prototype.hasOwnProperty.call(patch, "plannedStartAt")) body.planned_start_at = patch.plannedStartAt || null;
      if (Object.prototype.hasOwnProperty.call(patch, "plannedEndAt")) body.planned_end_at = patch.plannedEndAt || null;
      const hasVenuePatch = Object.prototype.hasOwnProperty.call(patch, "venue");
      const localVenue = hasVenuePatch ? String(patch.venue ?? "").trim() : (production.venue || "");
      if (!Object.keys(body).length) {
        if (hasVenuePatch) {
          setProductionsByWorkspaceEntry(workspace.id, { ...production, venue: localVenue });
          notify.info("地点已更新", { description: "地点目前只在当前窗口展示，不会保存到服务端。" });
        }
        return true;
      }
      const updated = route?.direct ? await updateAccessibleProduction(production.id, body) : await updateProduction(workspace.id, production.id, body);
      setProductionsByWorkspaceEntry(workspace.id, { ...toProductionSummary(updated), venue: localVenue });
      notify.success("活动信息已保存");
      return true;
    } catch (nextError) {
      notify.error("无法保存活动信息", { description: nextError instanceof Error ? nextError.message : String(nextError) });
      return false;
    }
  };
  const updateProductionSettings = async (patch) => {
    if (!workspace || !production || production.isCreationSession) throw new Error("创建会话只能在活动概览中完善基础信息。");
    const updated = route?.direct ? await updateAccessibleProduction(production.id, patch) : await updateProduction(workspace.id, production.id, patch);
    const summary = { ...toProductionSummary(updated), venue: production.venue || "" };
    setProductionsByWorkspaceEntry(workspace.id, summary);
    return summary;
  };
  const leaveCreationSession = () => {
    if (!workspace || !production?.isCreationSession) return;
    if (creationRequestRef.current) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    discardCreationSession(production.id);
    creationRouteIdRef.current = null;
    navigate(workspacePath(workspace.id, "productions"), { replace: true });
  };
  const accountReturnProduction = accountReturnRoute?.mode === "production"
    ? (productionsByWorkspace[accountReturnRoute.workspaceId] ?? []).find((item) => item.id === accountReturnRoute.productionId)
    : null;
  const accountReturnWorkspace = accountReturnRoute?.workspaceId ? workspaces.find((item) => item.id === accountReturnRoute.workspaceId) : currentWorkspace;
  const accountReturnLabel = accountReturnProduction
    ? `返回活动：${accountReturnProduction.name}`
    : accountReturnRoute?.mode === "production" ? "返回活动" : `返回工作空间：${accountReturnWorkspace?.name || "工作空间"}`;
  const navigateAccount = useCallback((view = "profile", developerAction) => {
    if (creationRequestRef.current && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    const from = isAccountRoute
      ? accountReturnPath
      : (creationSession ? workspacePath(creationSession.workspaceId, "productions") : `${location.pathname}${location.search}`);
    if (creationSession) discardCreationSession(creationSession.id);
    const action = developerAction ? `&action=${encodeURIComponent(developerAction)}` : "";
    navigate(`${accountPath(view, from)}${action}`);
  }, [accountReturnPath, creationRequestPending, creationSession, discardCreationSession, isAccountRoute, location.pathname, location.search, navigate]);
  const handleShellLogout = useCallback(() => {
    if (creationRequestRef.current && creationSession) {
      notify.info("正在创建活动，请稍候");
      return;
    }
    if (creationSession) discardCreationSession(creationSession.id);
    onLogout();
  }, [creationRequestPending, creationSession, discardCreationSession, onLogout]);
  const handleShellNativeAction = useCallback((action) => {
    if (developerActions.has(action)) {
      if (import.meta.env.DEV) navigateAccount("developer", action);
      else notify.message("此功能仅在开发构建中提供");
      return;
    }
    onNativeAction(action);
  }, [navigateAccount, onNativeAction]);
  useEffect(() => {
    const onWindowAction = (event) => handleShellNativeAction(event.detail);
    window.addEventListener("stagepilot-native-action", onWindowAction);
    if (!isTauriRuntime) return () => window.removeEventListener("stagepilot-native-action", onWindowAction);
    let cleanup;
    listen("native-action", (event) => handleShellNativeAction(event.payload)).then((next) => { cleanup = next; });
    return () => { cleanup?.(); window.removeEventListener("stagepilot-native-action", onWindowAction); };
  }, [handleShellNativeAction]);
  const pageTitle = titlebarTitleMode === "app" ? "StagePilot" : route?.meta.title ?? "StagePilot";
  const titlebarBreadcrumbItems = buildBreadcrumbItems({ route, workspace, production });

  let content;
  if (authStatus === "loading" || (authStatus === "authenticated" && workspaceStatus === "loading")) content = <AppLoading />;
  else if (authStatus !== "authenticated") content = <UnauthenticatedHome onOpenAuth={onRequireAuth} />;
  else if (isAccountRoute && route.page === "developer" && import.meta.env.DEV) content = <DeveloperTools workspace={workspace} devtools={devtools} onDevtoolsChange={onDevtoolsChange} contentWidth={contentWidth} initialAction={new URLSearchParams(location.search).get("action")} />;
  else if (isAccountRoute) content = <AccountCenter page={route.page} user={user} onUserUpdate={onUserUpdate} subscription={subscription} theme={theme} applyTheme={applyTheme} devtools={devtools} onDevtoolsChange={onDevtoolsChange} showTitlebarTitle={showTitlebarTitle} titlebarTitleMode={titlebarTitleMode} onTitlebarVisibilityChange={onTitlebarVisibilityChange} onTitlebarModeChange={onTitlebarModeChange} sidebarRailEnabled={sidebarRailEnabled} onSidebarRailChange={onSidebarRailChange} contentWidth={contentWidth} onContentWidthChange={onContentWidthChange} initialAction={new URLSearchParams(location.search).get("action")} />;
  else if (route?.mode === "invite") content = <ProductionInvitePage token={route.token} />;
  else if (isWorkRoute) content = <UnifiedWorkContextPage initialTab={route.tab} onCreateWorkspace={() => setCreateWorkspaceOpen(true)} onEnterWorkspace={enterWorkspace} />;
  else if (isWorkspacesRoute) content = <WorkspacesPage onCreateWorkspace={() => setCreateWorkspaceOpen(true)} />;
  else if (workspaceError) content = <NavigationFailure description={workspaceError.message} onRetry={retryWorkspaces} />;
  else if (location.pathname === "/") content = <AppLoading />;
  else if (!route) content = <NavigationFailure title="页面不存在" description="这个 StagePilot 页面地址无效或已经移动。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : undefined} />;
  else if (route.direct && directProductionState.loading) content = <AppLoading />;
  else if (route.direct && directProductionState.failed) content = <NavigationFailure title="活动不可访问" description="这场活动不存在，或你已没有访问权限。" homePath="/work?tab=participating" />;
  else if (workspaceForbidden) content = <NavigationFailure title="工作空间不可访问" description="你访问的工作空间不存在，或者当前账号无权访问。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : (workspaces[0] ? workspacePath(workspaces[0].id) : undefined)} />;
  else if (!workspace) content = <NavigationFailure title="工作空间不存在" description="你访问的工作空间不存在，或者当前账号无权访问。" homePath={currentWorkspace ? workspacePath(currentWorkspace.id) : undefined} />;
  else if (creationSessionExpired) content = <NavigationFailure title="创建会话已结束" description="这次创建内容尚未提交，离开或刷新后不会恢复。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (productionError) content = <NavigationFailure title="无法加载活动" description={productionError.message} onRetry={refreshProductions} homePath={workspacePath(workspace.id)} />;
  else if (productionUnavailable) content = <NavigationFailure title="活动不可访问" description="这场活动不存在、已归档，或者不属于当前工作空间。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (productionDeepLink && productionDetailLoading) content = <AppLoading />;
  else if (isProductionRoute && !productionsLoaded && !creationRoute) content = <AppLoading />;
  else if (isProductionRoute && !production) content = <NavigationFailure title="活动不可访问" description="这场活动不存在、已归档，或者不属于当前工作空间。" homePath={workspacePath(workspace.id, "productions")} />;
  else if (route.mode === "workspace" && route.page === "home") content = <WorkspaceHome route={route} workspace={workspace} productions={productions} onCreate={createCreationFromHome} onViewProductions={openWorkspaceProductions} onOpenCalendar={openWorkspaceCalendar} />;
  else if (route.mode === "workspace" && route.page === "productions") content = <ProductionsPage route={route} workspace={workspace} productions={productions} loading={!productionsLoaded} onCreate={createCreation} />;
  else if (route.mode === "workspace" && route.page === "members") content = <WorkspaceMembersPage route={route} workspace={workspace} />;
  else if (route.mode === "workspace" && route.page === "roles") content = <WorkspaceRolesPage route={route} workspace={workspace} />;
  else if (route.mode === "workspace" && route.page === "program-types") content = <ProgramTypeManagementPage workspace={workspace} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "venue-types") content = <VenueTypeManagementPage workspace={workspace} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "file-types") content = <FileTypeManagementPage workspace={workspace} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "programs" && route.resourceId) content = <ResourceDetailPage workspace={workspace} resourceType="programs" resourceId={route.resourceId} />;
  else if (route.mode === "workspace" && route.page === "programs") content = <ProgramLibraryPage workspace={workspace} />;
  else if (route.mode === "workspace" && ["people", "organizations", "venues", "equipment"].includes(route.page) && route.resourceId) content = <ResourceDetailPage workspace={workspace} resourceType={route.page} resourceId={route.resourceId} />;
  else if (route.mode === "workspace" && ["people", "organizations", "venues", "equipment"].includes(route.page)) content = <WorkspaceResourcePage workspace={workspace} resourceType={route.page} />;
  else if (route.mode === "workspace" && route.page === "settings") content = <WorkspaceSettingsPage workspaceId={workspace.id} key={workspace.id} />;
  else if (route.mode === "workspace" && route.page === "files") content = <FilesPage workspace={workspace} />;
  else if (route.mode === "production" && route.page === "overview") content = <ProductionOverviewPage workspace={workspace} production={production} onUpdateProduction={updateProductionData} onLeaveCreation={leaveCreationSession} creationBusy={creationRequestPending} key={route.productionId} />;
  else if (route.mode === "production" && production?.isCreationSession) content = <NavigationFailure title="创建会话仅支持概览" description="提交第一个有效字段后，活动的其他模块会自动开放。" homePath={productionPath(workspace.id, production.id, "overview")} />;
  else if (route.mode === "production" && ["schedule", "occurrences", "rehearsals"].includes(route.page)) content = <ProductionPlanningPlaceholderPage route={route} workspace={workspace} production={production} />;
  else if (route.mode === "production" && route.page === "settings") content = <ProductionSettingsPage workspace={workspace} production={production} onUpdateProduction={updateProductionSettings} key={production.id} />;
  else if (route.mode === "production" && route.page === "members") content = <ProductionMembersPage workspace={workspace} production={production} key={production.id} />;
  else if (route.mode === "production" && route.page === "roles") content = <ProductionRolesPage workspace={workspace} production={production} key={production.id} />;
  else if (route.mode === "production" && route.page === "files") content = <FilesPage workspace={workspace} productionId={route.productionId} title="活动文件" key={route.productionId} />;
  else content = <PlaceholderPage route={route} workspace={workspace} production={production} />;

  const contentLayout = isAccountRoute && route?.page === "developer" && import.meta.env.DEV ? "workspace" : "document";

  const handleWorkspaceCreated = async (created) => {
    await adoptCreatedWorkspace(created);
    navigate(workspacePath(created.id), { replace: true });
  };

  // 创建会话需要保留 Production Context 的返回入口和禁用导航，
  // 但它从未加入 productionsByWorkspace，因此不会出现在正式活动预览中。
  const sidebarProduction = production;
  return <PageChromeProvider><WindowDetailProvider contentWidth={contentWidth} onModalActiveChange={setDetailModalActive}><SidebarProvider desktopOnly className="min-h-0 min-w-0 flex h-svh flex-col" defaultOpen><div className="app-shell flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header className="titlebar-content relative z-30 flex h-[var(--app-titlebar-height)] shrink-0 items-center border-b bg-background pl-2"><div className={cn("relative z-20 flex min-w-0 shrink-0 items-center gap-1", isMac && "pl-[68px]")}><SidebarTrigger className="shrink-0" /><Menubar className="shrink-0">{menuBar.map((menu) => <TitlebarMenu key={menu.label} menu={menu} onAction={handleShellNativeAction} />)}</Menubar></div><TitlebarBreadcrumbs items={titlebarBreadcrumbItems} title={pageTitle} showTitle={showTitlebarTitle} /><div className="min-w-8 flex-1 self-stretch" data-tauri-drag-region /><PageDetailTitlebarAction />{isWindows && <div className="flex h-full shrink-0"><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={onMinimize}><Minus className="size-3" /></Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px]" onClick={onToggleMaximize}>{isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}</Button><Button variant="ghost" size="icon-sm" className="h-full w-[46px] hover:bg-destructive/15 hover:text-destructive" onClick={onHide}><X /></Button></div>}</header>
    <div className="flex min-h-0 min-w-0 flex-1"><AppSidebar inert={detailModalActive || undefined} route={route} workspace={workspace} production={sidebarProduction} recentContexts={recentContexts} onOpenRecentContext={openRecentContext} workspaceSelectionMode={isWorkspacesRoute} railEnabled={sidebarRailEnabled} accountReturnPath={accountReturnPath} accountReturnLabel={accountReturnLabel} onLeaveCreation={leaveCreationSession} onCreateWorkspace={() => setCreateWorkspaceOpen(true)} onManageWorkspaces={() => { if (creationRequestPending && creationSession) { notify.info("正在创建活动，请稍候"); return; } if (creationSession) discardCreationSession(creationSession.id); navigate("/work"); }} onOpenDocuments={onOpenDocuments} user={user} subscription={subscription} onOpenAccountCenter={navigateAccount} onLogout={handleShellLogout} onRequireAuth={onRequireAuth} /><SidebarInset className="min-h-0 min-w-0 overflow-hidden"><WindowDetailHost><AppContentLayout mode={contentLayout} contentWidth={contentWidth}>{content}</AppContentLayout></WindowDetailHost></SidebarInset></div>
   </div><CreateWorkspaceDialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen} onCreated={handleWorkspaceCreated} /><AppSonner /></SidebarProvider></WindowDetailProvider></PageChromeProvider>;
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
  const [sidebarRailEnabled, setSidebarRailEnabled] = useState(true);
  const [contentWidth, setContentWidth] = useState("standard");
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("loading");
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [subscription, setSubscription] = useState(subscriptionDefaults);
  const themeRef = useRef("light");
  const applyTheme = async (nextTheme, persist = true) => { const useDark = nextTheme === "dark" || (nextTheme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches); document.documentElement.classList.toggle("dark", useDark); themeRef.current = nextTheme; setTheme(nextTheme); if (persist) await appStore.set("theme", nextTheme); };
  const hideWindow = async () => { try { await getCurrentWindow().hide(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const minimizeWindow = async () => { try { await getCurrentWindow().minimize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const toggleMaximize = async () => { try { await getCurrentWindow().toggleMaximize(); } catch (error) { notify.error("窗口操作失败", { description: String(error) }); } };
  const openDocuments = async () => { try { await openUrl(documentationUrl); notify.success("已打开帮助文档"); } catch (error) { notify.error("无法打开文档", { description: String(error) }); } };

  const handleNativeAction = useCallback(async (action) => {
    if (developerActions.has(action)) {
      window.dispatchEvent(new CustomEvent("stagepilot-native-action", { detail: action }));
      return;
    }
    if (action === "toggle-theme") await applyTheme(themeRef.current === "dark" ? "light" : "dark");
    if (action === "about") setAboutOpen(true);
    if (action === "toggle-window") await hideWindow();
    if (action === "quit") await invoke("quit_app");
  }, []);

  const handleLogin = async (email, password) => { const nextUser = await loginAccount(email, password); setUser(nextUser); setAuthStatus("authenticated"); setAuthDialogOpen(false); };
  const handleRegister = async (email, password) => { const result = await registerAccount(email, password); setUser(result.user); setAuthStatus("authenticated"); setAuthDialogOpen(false); return result; };
  const handleLogout = async () => { const result = await logoutAccount(); setUser(null); setAuthStatus("signed_out"); setAuthDialogOpen(true); if (result.remotelyRevoked) notify.success("已退出登录"); else notify.warning("已清除本机登录信息", { description: "无法连接服务端，会话会在到期后失效。" }); };

  useEffect(() => onSessionInvalidated(({ reason }) => {
    setUser(null);
    setAuthStatus("signed_out");
    setAuthDialogOpen(true);
    if (reason === "refresh_failed") notify.error("登录状态已失效", { description: "请重新登录后继续。" });
  }), []);

  useEffect(() => { (async () => { try { await appStore.init(); const [savedTheme, savedDevtools, savedTitlebarVisibility, savedTitlebarMode, savedSidebarRail, savedContentWidth, savedSubscription, restoredUser] = await Promise.all([appStore.get("theme"), appStore.get("devtools"), appStore.get("showTitlebarTitle"), appStore.get("titlebarTitleMode"), appStore.get("sidebarRailEnabled"), appStore.get("contentWidth"), appStore.get("subscription"), restoreSession()]); await applyTheme(["light", "dark", "system"].includes(savedTheme) ? savedTheme : "light", false); if (typeof savedDevtools === "boolean") setDevtools(savedDevtools); if (typeof savedTitlebarVisibility === "boolean") setShowTitlebarTitle(savedTitlebarVisibility); if (savedTitlebarMode === "app" || savedTitlebarMode === "page") setTitlebarTitleMode(savedTitlebarMode); if (typeof savedSidebarRail === "boolean") setSidebarRailEnabled(savedSidebarRail); if (["standard", "wide", "full"].includes(savedContentWidth)) setContentWidth(savedContentWidth); if (savedSubscription && typeof savedSubscription === "object") setSubscription({ ...subscriptionDefaults, ...savedSubscription }); setUser(restoredUser); setAuthStatus(restoredUser ? "authenticated" : "signed_out"); setAuthDialogOpen(!restoredUser); } catch { setAuthStatus("signed_out"); setAuthDialogOpen(true); } })(); }, []);

  useEffect(() => { if (!isWindows) return; let unlisten; (async () => { try { const win = getCurrentWindow(); setIsMaximized(await win.isMaximized()); unlisten = await win.onResized(() => win.isMaximized().then(setIsMaximized).catch(() => {})); } catch {} })(); return () => unlisten?.(); }, []);
  useEffect(() => { const suppress = (event) => event.preventDefault(); document.addEventListener("contextmenu", suppress); return () => document.removeEventListener("contextmenu", suppress); }, []);

  const handleDevtoolsChange = async (checked) => { setDevtools(checked); await appStore.set("devtools", checked); if (isTauriRuntime && checked) { try { await invoke("set_devtools", { enabled: true }); } catch {} } notify.message(checked ? "开发者工具已开启" : "开发者工具已关闭"); };
  const updateTitlebarVisibility = async (checked) => { setShowTitlebarTitle(checked); await appStore.set("showTitlebarTitle", checked); notify.success(checked ? "标题栏标题已显示" : "标题栏标题已隐藏"); };
  const updateTitlebarMode = async (mode) => { setTitlebarTitleMode(mode); await appStore.set("titlebarTitleMode", mode); notify.success("标题栏设置已更新"); };
  const updateSidebarRail = async (checked) => { setSidebarRailEnabled(checked); try { await appStore.set("sidebarRailEnabled", checked); } catch { notify.error("偏好保存失败"); } notify.success(checked ? "侧栏边缘热区已开启" : "侧栏边缘热区已关闭"); };
  const updateContentWidth = async (nextWidth) => { if (!["standard", "wide", "full"].includes(nextWidth) || nextWidth === contentWidth) return; setContentWidth(nextWidth); try { await appStore.set("contentWidth", nextWidth); notify.success("页面宽度偏好已更新"); } catch { notify.error("页面宽度偏好保存失败"); } };

 return <TooltipProvider><ContextMenu><ContextMenuTrigger className="contents select-text"><HashRouter><NavigationProvider authStatus={authStatus}><WorkspaceProvider authStatus={authStatus}><SafeRoutedMainShell authStatus={authStatus} user={user} onUserUpdate={setUser} subscription={subscription} theme={theme} applyTheme={applyTheme} devtools={devtools} onDevtoolsChange={handleDevtoolsChange} onRequireAuth={() => setAuthDialogOpen(true)} onOpenDocuments={openDocuments} onLogout={handleLogout} onNativeAction={handleNativeAction} showTitlebarTitle={showTitlebarTitle} titlebarTitleMode={titlebarTitleMode} onTitlebarVisibilityChange={updateTitlebarVisibility} onTitlebarModeChange={updateTitlebarMode} sidebarRailEnabled={sidebarRailEnabled} onSidebarRailChange={updateSidebarRail} contentWidth={contentWidth} onContentWidthChange={updateContentWidth} isMaximized={isMaximized} onMinimize={minimizeWindow} onToggleMaximize={toggleMaximize} onHide={hideWindow} /></WorkspaceProvider></NavigationProvider></HashRouter><AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} onLogin={handleLogin} onRegister={handleRegister} /><Dialog modal={false} open={aboutOpen} onOpenChange={setAboutOpen}><DialogContent><DialogHeader><DialogTitle>StagePilot</DialogTitle><DialogDescription>多租户演艺活动运营平台。</DialogDescription></DialogHeader><p className="text-sm text-muted-foreground">Workspace 沉淀长期资产，Production 组织筹备与现场执行。</p></DialogContent></Dialog></ContextMenuTrigger><ContextMenuContent className="min-w-48">{contextMenuItems.map((item, index) => item === "separator" ? <ContextMenuSeparator key={`sep-${index}`} /> : <ContextMenuItem key={item.action} onClick={() => handleNativeAction(item.action)}><item.icon /><span>{item.label}</span></ContextMenuItem>)}</ContextMenuContent></ContextMenu></TooltipProvider>;
}

function App() { return <MainApp />; }

export default App;
