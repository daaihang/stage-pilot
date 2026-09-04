import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { RiClipboardLine, RiDeleteBinLine, RiFileCopyLine, RiScissorsLine } from "@/components/ui/icons"

export function ContextMenuDemo2() {
  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem>
              <RiFileCopyLine />
              复制
            </ContextMenuItem>
            <ContextMenuItem>
              <RiScissorsLine />
              剪切
            </ContextMenuItem>
            <ContextMenuItem>
              <RiClipboardLine />
              粘贴
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem variant="destructive">
              <RiDeleteBinLine />
              删除
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
