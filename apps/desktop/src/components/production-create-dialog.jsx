import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/sonner"
import { createProduction } from "@/lib/production-api"

export function CreateProductionDialog({ workspace, open, onOpenChange, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    startsAt: "",
    endsAt: "",
    timezone: "Asia/Shanghai",
    description: "",
  })
  const [creating, setCreating] = useState(false)

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  const submit = async (event) => {
    event.preventDefault()

    const name = form.name.trim()
    if (!name) {
      notify.error("请输入活动名称")
      return
    }

    const startsAt = form.startsAt ? new Date(form.startsAt).toISOString() : null
    const endsAt = form.endsAt ? new Date(form.endsAt).toISOString() : null
    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      notify.error("结束时间不能早于开始时间")
      return
    }

    setCreating(true)
    try {
      const created = await createProduction(workspace.id, {
        name,
        description: form.description,
        timezone: form.timezone,
        startAt: startsAt,
        endAt: endsAt,
      })
      notify.success(`已创建活动「${created.name}」`, { description: `时区：${created.timezone}` })
      onCreated?.(created)
    } catch (error) {
      notify.error("创建活动失败", { description: error.message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建活动</DialogTitle>
          <DialogDescription>创建后自动进入这场活动的生产空间。</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">活动名称</span>
            <Input value={form.name} onChange={set("name")} maxLength={120} placeholder="例如：2026 青年音乐节" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">开始时间</span>
              <Input type="datetime-local" value={form.startsAt} onChange={set("startsAt")} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">结束时间</span>
              <Input type="datetime-local" value={form.endsAt} onChange={set("endsAt")} />
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">时区（IANA）</span>
            <Input value={form.timezone} onChange={set("timezone")} placeholder="Asia/Shanghai" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">描述（可选）</span>
            <Input value={form.description} onChange={set("description")} maxLength={500} />
          </label>
          <Button type="submit" className="w-full" disabled={creating}>
            {creating ? "创建中..." : "创建活动"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
