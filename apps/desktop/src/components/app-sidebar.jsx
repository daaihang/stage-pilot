import { Activity, FileText, FolderOpen, LayoutDashboard, MonitorCog, Shapes } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavUser } from "@/components/nav-user";

const navigation = [
  { id: "overview", label: "能力总览", icon: LayoutDashboard },
  { id: "files", label: "文件工具", icon: FolderOpen },
  { id: "system", label: "系统集成", icon: MonitorCog },
  { id: "activity", label: "活动记录", icon: Activity },
  { id: "components", label: "UI 组件", icon: Shapes },
];

export function AppSidebar({ activeView, onViewChange, onOpenDocuments, user, subscription, onOpenAccountCenter, onLogout, ...props }) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarContent><SidebarGroup><SidebarGroupLabel>工作台</SidebarGroupLabel><SidebarMenu>{navigation.map((item) => {
        const Icon = item.icon;
        return <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={activeView === item.id} tooltip={item.label} onClick={() => onViewChange(item.id)}><Icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>;
      })}</SidebarMenu></SidebarGroup></SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="文档" onClick={onOpenDocuments}>
              <FileText />
              <span>文档</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={user} subscription={subscription} onOpenAccountCenter={onOpenAccountCenter} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
