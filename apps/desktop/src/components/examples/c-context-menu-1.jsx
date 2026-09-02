import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ContextMenuDemo1() {
  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem>返回</ContextMenuItem>
            <ContextMenuItem disabled>前进</ContextMenuItem>
            <ContextMenuItem>刷新</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
