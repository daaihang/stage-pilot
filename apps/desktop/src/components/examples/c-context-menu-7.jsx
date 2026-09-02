import { useState } from "react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ContextMenuDemo7() {
  const [user, setUser] = useState("a")
  const [theme, setTheme] = useState("light")

  return (
    <div className="flex w-full items-center justify-center p-4">
      <ContextMenu>
        <ContextMenuTrigger className="text-muted-foreground flex aspect-[2/0.5] w-full items-center justify-center border border-dashed text-sm">
          在此右键
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel>成员</ContextMenuLabel>
            <ContextMenuRadioGroup value={user} onValueChange={setUser}>
              <ContextMenuRadioItem value="a">示例用户 A</ContextMenuRadioItem>
              <ContextMenuRadioItem value="b">示例用户 B</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>主题</ContextMenuLabel>
            <ContextMenuRadioGroup value={theme} onValueChange={setTheme}>
              <ContextMenuRadioItem value="light">浅色</ContextMenuRadioItem>
              <ContextMenuRadioItem value="dark">深色</ContextMenuRadioItem>
              <ContextMenuRadioItem value="system">跟随系统</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
