import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/sonner"
import { createWorkspace } from "@/lib/workspace-api"

export function CreateWorkspaceDialog({ open, onOpenChange, onCreated }) {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      notify.error("请输入工作空间名称")
      return
    }

    setCreating(true)
    try {
      const created = await createWorkspace({ name: trimmed })
      notify.success(`已创建工作空间「${created.name}」`, { description: "你已成为这个工作空间的 OWNER。" })
      setName("")
      onOpenChange(false)
      await onCreated?.(created)
    } catch (error) {
      notify.error("创建工作空间失败", { description: error?.message || String(error) })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>创建工作空间</DialogTitle>
          <DialogDescription>创建后你将自动成为 OWNER，并进入这个工作空间的工作台。</DialogDescription>
        </DialogHeader><DialogBody>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">工作空间名称</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：南宁高中传媒社团联盟" maxLength={80} autoFocus />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>取消</Button>
            <Button type="submit" disabled={creating}>{creating ? "创建中..." : "创建工作空间"}</Button>
          </DialogFooter>
        </form>
      </DialogBody></DialogContent>
    </Dialog>
  )
}
