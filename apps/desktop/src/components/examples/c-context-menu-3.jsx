import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ContextMenuDemo3() {
  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem>
              返回
              <ContextMenuShortcut>Alt + ←</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled>
              前进
              <ContextMenuShortcut>Alt + →</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              刷新
              <ContextMenuShortcut>F5</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem>
              保存
              <ContextMenuShortcut>Ctrl + S</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              另存为…
              <ContextMenuShortcut>Ctrl + Shift + S</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
