import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ContextMenuDemo4() {
  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem>
              复制
              <ContextMenuShortcut>Ctrl + C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              剪切
              <ContextMenuShortcut>Ctrl + X</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger>更多工具</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuGroup>
                <ContextMenuItem>另存页面…</ContextMenuItem>
                <ContextMenuItem>创建快捷方式…</ContextMenuItem>
                <ContextMenuItem>命名窗口…</ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem>开发者工具</ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem variant="destructive">删除</ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
