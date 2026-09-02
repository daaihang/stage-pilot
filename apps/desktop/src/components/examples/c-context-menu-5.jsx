import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ContextMenuDemo5() {
  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel>文件</ContextMenuLabel>
            <ContextMenuItem>
              新建文件
              <ContextMenuShortcut>Ctrl + N</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              打开文件
              <ContextMenuShortcut>Ctrl + O</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              保存
              <ContextMenuShortcut>Ctrl + S</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>编辑</ContextMenuLabel>
            <ContextMenuItem>
              撤销
              <ContextMenuShortcut>Ctrl + Z</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              重做
              <ContextMenuShortcut>Ctrl + Shift + Z</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem>
              剪切
              <ContextMenuShortcut>Ctrl + X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              复制
              <ContextMenuShortcut>Ctrl + C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              粘贴
              <ContextMenuShortcut>Ctrl + V</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem variant="destructive">
              删除
              <ContextMenuShortcut>Delete</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
