import * as React from "react"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"
import {
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseLine,
  RiCloseCircleLine,
  RiFileCopyLine,
  RiInformationLine,
  RiLoaderLine,
  RiErrorWarningLine,
} from "@remixicon/react"

import { cn } from "@/lib/utils"

const notificationIcons = {
  success: RiCheckboxCircleLine,
  info: RiInformationLine,
  warning: RiErrorWarningLine,
  error: RiCloseCircleLine,
  loading: RiLoaderLine,
  default: RiInformationLine,
}

const notificationIconColors = {
  success: "text-emerald-600 dark:text-emerald-400",
  info: "text-violet-600 dark:text-violet-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
  loading: "text-muted-foreground",
  default: "text-muted-foreground",
}

function toPlainText(message, description) {
  return [message, description]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => String(value))
    .join("\n")
}

async function copyNotificationMessage(message) {
  try {
    await writeText(message)
    return true
  } catch {}

  try {
    await navigator.clipboard.writeText(message)
    return true
  } catch {
    return false
  }
}

function NotificationToast({ id, type = "default", message, description, action, originalMessage }) {
  const [copied, setCopied] = React.useState(false)
  const Icon = notificationIcons[type] ?? notificationIcons.default
  const fullMessage = originalMessage ?? toPlainText(message, description)

  const handleCopy = async () => {
    if (await copyNotificationMessage(fullMessage)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="app-sonner-notification" data-type={type} role="status">
      <Icon className={cn("size-4 shrink-0", notificationIconColors[type] ?? notificationIconColors.default, type === "loading" && "animate-spin")} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-5">{message}</p>
        {description && <p className="whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          className="app-sonner-action"
          onClick={(event) => {
            action.onClick?.(event)
            toast.dismiss(id)
          }}
        >
          {action.label}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" className="app-sonner-icon-button" aria-label="复制完整消息" title="复制完整消息" onClick={handleCopy}>
          {copied ? <RiCheckLine className="size-4 text-emerald-600 dark:text-emerald-400" /> : <RiFileCopyLine className="size-4" />}
        </button>
        <button type="button" className="app-sonner-icon-button" aria-label="关闭提示" title="关闭提示" onClick={() => toast.dismiss(id)}>
          <RiCloseLine className="size-4" />
        </button>
      </div>
    </div>
  )
}

function createNotification(type, message, options = {}) {
  const { description, action, duration, id, originalMessage } = options
  return toast.custom(
    (toastId) => (
      <NotificationToast
        id={toastId}
        type={type}
        message={message}
        description={description}
        action={action}
        originalMessage={originalMessage}
      />
    ),
    {
      id,
      duration: duration ?? (type === "error" ? 6000 : type === "loading" ? Infinity : 4000),
    }
  )
}

const notify = {
  message: (message, options) => createNotification("default", message, options),
  success: (message, options) => createNotification("success", message, options),
  info: (message, options) => createNotification("info", message, options),
  warning: (message, options) => createNotification("warning", message, options),
  error: (message, options) => createNotification("error", message, options),
  loading: (message, options) => createNotification("loading", message, options),
  dismiss: (id) => toast.dismiss(id),
  promise: async (promise, messages) => {
    const id = createNotification("loading", messages.loading, { description: messages.description, duration: Infinity })
    try {
      const result = await promise
      const message = typeof messages.success === "function" ? messages.success(result) : messages.success
      createNotification("success", message, { id, duration: messages.successDuration })
      return result
    } catch (error) {
      const message = typeof messages.error === "function" ? messages.error(error) : messages.error
      createNotification("error", message, { id, description: String(error), duration: messages.errorDuration })
      throw error
    }
  },
}

function AppSonner() {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      offset={0}
      visibleToasts={1}
      closeButton={false}
      className="app-sonner"
      style={{ "--width": "100%" }}
    />
  )
}

export { AppSonner, notify }
