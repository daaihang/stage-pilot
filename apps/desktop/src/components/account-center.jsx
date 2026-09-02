import { useEffect, useMemo, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/sonner";
import { AppSonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CheckCircle2, CreditCard, Palette, Settings, Sparkles, UserRound } from "lucide-react";

const accountPages = [
  { id: "profile", label: "个人中心", icon: UserRound, title: "个人中心", description: "查看当前账户资料。" },
  { id: "subscription", label: "订阅与 Pro", icon: Sparkles, title: "订阅与 Pro", description: "查看当前套餐和订阅能力。" },
  { id: "settings", label: "设置", icon: Settings, title: "设置", description: "管理应用外观和开发者选项。" },
];

function AccountProfile({ user }) {
  return <Card><CardHeader><CardTitle>账户资料</CardTitle><CardDescription>当前资料仅供查看，后续接入账户服务后可在此更新。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-4"><Avatar className="size-16"><AvatarImage src={user.avatar} alt={user.name} /><AvatarFallback>{user.name?.slice(0, 2) || "U"}</AvatarFallback></Avatar><div><p className="text-base font-medium">{user.name}</p><p className="text-sm text-muted-foreground">{user.username}</p><p className="text-xs text-muted-foreground">{user.email}</p></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="border p-3"><p className="text-xs text-muted-foreground">名称</p><p className="mt-1 text-sm font-medium">{user.name}</p></div><div className="border p-3"><p className="text-xs text-muted-foreground">Username</p><p className="mt-1 text-sm font-medium">{user.username}</p></div></div></CardContent></Card>;
}

function SubscriptionView({ subscription }) {
  const isPro = subscription.plan === "pro";
  return <Card><CardHeader><CardTitle>订阅状态</CardTitle><CardDescription>订阅状态目前保存在本地，支付服务接入后将自动同步。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between gap-4 border p-4"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center bg-primary/10 text-primary"><CreditCard className="size-4" /></div><div><p className="font-medium">{isPro ? "Pro 会员" : "免费版"}</p><p className="text-sm text-muted-foreground">{isPro ? "已启用 Pro 能力" : "适合本地体验和基础功能"}</p></div></div><Badge variant={isPro ? "default" : "secondary"}>{isPro ? "PRO" : "FREE"}</Badge></div><Button className="w-full" variant={isPro ? "outline" : "default"} onClick={() => notify.message(isPro ? "订阅管理将在接入支付服务后开放" : "升级功能将在接入支付服务后开放", { description: "当前为本地演示模式。" })}>{isPro ? "管理订阅" : "升级到 Pro"}</Button></CardContent></Card>;
}

function SettingsView({ theme, applyTheme, devtools, onDevtoolsChange, showTitlebarTitle, titlebarTitleMode, onTitlebarVisibilityChange, onTitlebarModeChange }) {
  return <div className="space-y-4"><Card><CardHeader><CardTitle>外观</CardTitle><CardDescription>控制应用主题和标题栏内容。</CardDescription></CardHeader><CardContent className="space-y-4"><SettingRow title="深色模式" description="下次启动时自动恢复" value={<Switch checked={theme === "dark"} onCheckedChange={(checked) => applyTheme(checked ? "dark" : "light")} />} /><SettingRow title="标题栏标题" description="在标题栏中央显示页面或应用名称" value={<Switch checked={showTitlebarTitle} onCheckedChange={onTitlebarVisibilityChange} />} /><div className={`space-y-2 border p-3 ${!showTitlebarTitle ? "opacity-50" : ""}`} aria-disabled={!showTitlebarTitle}><div className="flex items-center gap-2"><Palette className="size-4" /><p className="text-xs font-medium">标题内容</p></div><div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="标题栏内容"><button type="button" role="radio" aria-checked={titlebarTitleMode === "page"} disabled={!showTitlebarTitle} className={`border px-2 py-2 text-left text-xs ${titlebarTitleMode === "page" ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => onTitlebarModeChange("page")}>当前页面名称</button><button type="button" role="radio" aria-checked={titlebarTitleMode === "app"} disabled={!showTitlebarTitle} className={`border px-2 py-2 text-left text-xs ${titlebarTitleMode === "app" ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => onTitlebarModeChange("app")}>应用名称</button></div></div></CardContent></Card><Card><CardHeader><CardTitle>开发者</CardTitle><CardDescription>面向本地调试的应用能力。</CardDescription></CardHeader><CardContent><SettingRow title="开发者工具" description="关闭后需重启应用才能完全禁用" value={<Switch checked={devtools} onCheckedChange={onDevtoolsChange} />} /></CardContent></Card></div>;
}

function SettingRow({ title, description, value }) {
  return <div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div><div className="shrink-0">{value}</div></div>;
}

export function AccountCenter({ user, subscription, theme, applyTheme, devtools, onDevtoolsChange, showTitlebarTitle, titlebarTitleMode, onTitlebarVisibilityChange, onTitlebarModeChange }) {
  const initialPage = useMemo(() => new URLSearchParams(window.location.search).get("view") || "profile", []);
  const [activePage, setActivePage] = useState(accountPages.some((page) => page.id === initialPage) ? initialPage : "profile");
  const page = accountPages.find((item) => item.id === activePage) || accountPages[0];

  useEffect(() => {
    let unlisten;
    listen("account-center:navigate", (event) => {
      if (accountPages.some((item) => item.id === event.payload)) setActivePage(event.payload);
    }).then((cleanup) => { unlisten = cleanup; });
    return () => unlisten?.();
  }, []);

  const syncSetting = (key, value) => emitTo("main", "account-center:setting-changed", { key, value }).catch(() => {});
  const updateTheme = (value) => { applyTheme(value); syncSetting("theme", value); };
  const updateTitleVisibility = (value) => { onTitlebarVisibilityChange(value); syncSetting("showTitlebarTitle", value); };
  const updateTitleMode = (value) => { onTitlebarModeChange(value); syncSetting("titlebarTitleMode", value); };
  const updateDevtools = (value) => { onDevtoolsChange(value); syncSetting("devtools", value); };

  return <TooltipProvider><SidebarProvider desktopOnly className="min-h-0 min-w-0 flex h-svh"><Sidebar collapsible="none" className="hidden w-52 border-r md:flex"><SidebarContent><SidebarGroup><SidebarGroupContent><SidebarMenu>{accountPages.map((item) => { const Icon = item.icon; return <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={activePage === item.id} onClick={() => setActivePage(item.id)}><Icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>; })}</SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent></Sidebar><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><header className="flex min-h-16 shrink-0 items-center border-b px-5"><div><p className="text-xs text-muted-foreground">账户中心</p><h1 className="text-sm font-medium">{page.title}</h1></div></header><div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6"><div className="md:hidden"><div className="flex gap-1 overflow-x-auto border-b pb-2">{accountPages.map((item) => <Button key={item.id} size="sm" variant={activePage === item.id ? "secondary" : "ghost"} onClick={() => setActivePage(item.id)}>{item.label}</Button>)}</div></div><div className="mx-auto w-full max-w-3xl space-y-5"><div><h2 className="text-xl font-semibold tracking-tight">{page.title}</h2><p className="text-sm text-muted-foreground">{page.description}</p></div>{activePage === "profile" && <AccountProfile user={user} />}{activePage === "subscription" && <SubscriptionView subscription={subscription} />}{activePage === "settings" && <SettingsView theme={theme} applyTheme={updateTheme} devtools={devtools} onDevtoolsChange={updateDevtools} showTitlebarTitle={showTitlebarTitle} titlebarTitleMode={titlebarTitleMode} onTitlebarVisibilityChange={updateTitleVisibility} onTitlebarModeChange={updateTitleMode} />}</div></div></main></SidebarProvider><AppSonner /></TooltipProvider>;
}
