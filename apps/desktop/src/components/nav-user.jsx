import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
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
import { RiArrowUpDownLine, RiSparklingLine, RiUserLine, RiSettings3Line, RiLogoutBoxLine, RiVipCrownLine } from "@remixicon/react"

export function NavUser({
  user,
  subscription,
  onOpenAccountCenter,
  onLogout,
}) {
  const { isMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted group-data-[collapsible=icon]:justify-center">
                <Avatar className="size-8">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback>{user.name?.slice(0, 2) || "U"}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.username}</span>
                </div>
                <RiArrowUpDownLine className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            }>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-fit"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar>
                    <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback>{user.name?.slice(0, 2) || "U"}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.username}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onOpenAccountCenter("subscription")}>
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
              <DropdownMenuItem onClick={() => onOpenAccountCenter("settings")}>
                <RiSettings3Line />
                设置
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <RiLogoutBoxLine />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
