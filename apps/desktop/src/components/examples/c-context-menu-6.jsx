import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ContextMenuDemo6() {
  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuCheckboxItem defaultChecked>显示书签栏</ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem>显示完整 URL</ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem defaultChecked>显示开发者工具</ContextMenuCheckboxItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
