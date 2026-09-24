import { UserAvatar } from "@/components/user-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { RiArrowUpDownLine, RiSparklingLine, RiUserLine, RiSettings3Line, RiLogoutBoxLine, RiVipCrownLine, RiTerminalBoxLine } from "@/components/ui/icons"

export function getUserIdentity(user) {
  const displayName = user?.display_name || user?.name || "User";
  const username = user?.username || user?.email || "";
  return { displayName, username };
}

export function UserAccountMenu({
  user,
  subscription,
  onOpenAccountCenter,
  onLogout,
  trigger,
  side = "right",
  align = "end",
  sideOffset = 4,
}) {
  const { displayName, username } = getUserIdentity(user);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        className="w-fit"
        side={side}
        align={align}
        sideOffset={sideOffset}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <UserAvatar avatarUrl={user.avatar_url || user.avatar} name={displayName} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs">{username}</span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onOpenAccountCenter("billing")}>
            {subscription?.plan === "pro" ? <RiVipCrownLine /> : <RiSparklingLine />}
            {subscription?.plan === "pro" ? "Pro 订阅" : "升级到 Pro"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onOpenAccountCenter("profile")}>
            <RiUserLine />
            个人中心
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onOpenAccountCenter("preferences")}>
            <RiSettings3Line />
            设置
          </DropdownMenuItem>
          {import.meta.env.DEV && (
            <DropdownMenuItem onClick={() => onOpenAccountCenter("developer")}>
              <RiTerminalBoxLine />
              开发工具
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout}>
          <RiLogoutBoxLine />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NavUser({
  user,
  subscription,
  onOpenAccountCenter,
  onLogout,
}) {
  const { displayName, username } = getUserIdentity(user);
  const { isMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <UserAccountMenu
          user={user}
          subscription={subscription}
          onOpenAccountCenter={onOpenAccountCenter}
          onLogout={onLogout}
          side={isMobile ? "bottom" : "right"}
          trigger={
            <SidebarMenuButton size="lg" className="aria-expanded:bg-muted group-data-[collapsible=icon]:justify-center">
              <UserAvatar className="size-8" avatarUrl={user.avatar_url || user.avatar} name={displayName} />
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{username}</span>
              </div>
              <RiArrowUpDownLine className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          }
        />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
