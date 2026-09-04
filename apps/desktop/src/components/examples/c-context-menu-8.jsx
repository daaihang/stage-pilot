import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { RiArchiveLine, RiDeleteBinLine, RiPencilLine, RiUpload2Line } from "@/components/ui/icons"

export function ContextMenuDemo8() {
  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem>
              <RiPencilLine />
              编辑
            </ContextMenuItem>
            <ContextMenuItem>
              <RiUpload2Line />
              分享
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem>
              <RiArchiveLine />
              归档
            </ContextMenuItem>
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
