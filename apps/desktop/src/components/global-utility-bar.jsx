import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FileText, Search, Sparkles } from "@/components/ui/icons";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContentWidthContainer } from "@/components/app-content-layout";
import { getUserIdentity, NavUser, UserAccountMenu } from "@/components/nav-user";
import { GLOBAL_UTILITY_BAR_HEIGHT } from "@/lib/app-shell-layout";
import { cn } from "@/lib/utils";

const COMPACT_UTILITY_QUERY = "(max-width: 36rem)";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, [query]);

  return matches;
}

function BottomUtilityAction({ icon: Icon, label, shortcut, onClick, compact }) {
  const button = <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-w-0 max-[36rem]:size-8 max-[36rem]:px-0"
      aria-label={label}
      onClick={onClick}
    >
    <Icon aria-hidden="true" focusable="false" />
    <span className="max-[36rem]:hidden">{label}</span>
    {shortcut && <kbd className="ml-1 text-[10px] text-muted-foreground max-[48rem]:hidden">{shortcut}</kbd>}
  </Button>;

  if (!compact) return button;
  return <Tooltip>
    <TooltipTrigger render={button} />
    <TooltipContent side="top" sideOffset={6}>{shortcut ? `${label} · ${shortcut}` : label}</TooltipContent>
  </Tooltip>;
}

function BottomAccount({ user, subscription, onOpenAccountCenter, onLogout }) {
  const { displayName, username } = getUserIdentity(user);
  return <UserAccountMenu
    user={user}
    subscription={subscription}
    onOpenAccountCenter={onOpenAccountCenter}
    onLogout={onLogout}
    side="top"
    align="end"
    sideOffset={6}
    trigger={<Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-w-0 max-w-[min(20rem,45vw)] justify-start aria-expanded:bg-muted max-[36rem]:size-8 max-[36rem]:px-0"
      aria-label={`账户：${displayName}`}
    >
      <Avatar className="size-7 shrink-0">
        <AvatarImage src={user.avatar_url || user.avatar} alt={displayName} />
        <AvatarFallback>{displayName.slice(0, 2) || "U"}</AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 text-left leading-tight max-[36rem]:hidden">
        <span className="truncate text-xs font-medium">{displayName}</span>
        <span className="truncate text-[11px] text-muted-foreground">{username}</span>
      </span>
    </Button>}
  />;
}

function BottomLogin({ onRequireAuth }) {
  return <Button
    type="button"
    variant="ghost"
    size="sm"
    className="min-w-0 max-[36rem]:size-8 max-[36rem]:px-0"
    aria-label="登录 StagePilot"
    onClick={onRequireAuth}
  >
    <Sparkles aria-hidden="true" focusable="false" />
    <span className="max-[36rem]:hidden">登录 StagePilot</span>
  </Button>;
}

export function GlobalUtilityBar({
  variant = "bottom",
  user,
  subscription,
  onOpenSearch,
  onOpenDocuments,
  onOpenAccountCenter,
  onLogout,
  onRequireAuth,
  className,
}) {
  const compact = useMediaQuery(COMPACT_UTILITY_QUERY);

  if (variant === "sidebar") {
    return <div data-slot="global-utility-bar" data-variant="sidebar" className={className}>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="搜索" onClick={onOpenSearch}>
            <Search aria-hidden="true" focusable="false" />
            <span>搜索</span>
            <span className="ml-auto text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">Ctrl K</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="帮助与文档" onClick={onOpenDocuments}>
            <FileText aria-hidden="true" focusable="false" />
            <span>帮助与文档</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {user ? <NavUser user={user} subscription={subscription} onOpenAccountCenter={onOpenAccountCenter} onLogout={onLogout} /> : <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="登录" onClick={onRequireAuth}>
            <Sparkles aria-hidden="true" focusable="false" />
            <span>登录 StagePilot</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>}
    </div>;
  }

  return <footer
    data-slot="global-utility-bar"
    data-variant="bottom"
    aria-label="全局工具"
    className={cn("h-12 shrink-0 border-t bg-background", className)}
    style={{ height: GLOBAL_UTILITY_BAR_HEIGHT }}
  >
    <ContentWidthContainer className="flex h-full items-center justify-between gap-2 px-3">
      <div className="flex min-w-0 items-center gap-1">
        <BottomUtilityAction icon={Search} label="搜索" shortcut="Ctrl K" onClick={onOpenSearch} compact={compact} />
        <BottomUtilityAction icon={FileText} label="帮助与文档" onClick={onOpenDocuments} compact={compact} />
      </div>
      <div className="flex min-w-0 items-center">
        {user ? <BottomAccount user={user} subscription={subscription} onOpenAccountCenter={onOpenAccountCenter} onLogout={onLogout} /> : <BottomLogin onRequireAuth={onRequireAuth} />}
      </div>
    </ContentWidthContainer>
  </footer>;
}
