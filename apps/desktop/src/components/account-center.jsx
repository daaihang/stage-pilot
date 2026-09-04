import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/sonner";
import { updateMe, updatePassword } from "@/lib/auth";
import { DeveloperTools } from "@/components/developer-tools";
import { CreditCard, LockKeyhole, ShieldCheck } from "@/components/ui/icons";

function AccountProfile({ user, onUserUpdate }) {
  const [displayName, setDisplayName] = useState(user?.display_name || user?.name || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDisplayName(user?.display_name || user?.name || ""), [user]);
  const save = async () => {
    const value = displayName.trim();
    if (!value) return notify.error("资料保存失败", { description: "显示名称不能为空。" });
    setSaving(true); const toastId = notify.loading("正在保存资料…");
    try { const updated = await updateMe({ display_name: value }); onUserUpdate?.(updated); notify.success("资料已保存", { id: toastId }); }
    catch (error) { notify.error("资料保存失败", { id: toastId, description: error instanceof Error ? error.message : String(error) }); }
    finally { setSaving(false); }
  };
  const name = user?.display_name || user?.name || "User";
  return <Card><CardHeader><CardTitle>个人资料</CardTitle><CardDescription>这些资料属于你的账户，不随 Workspace 改变。</CardDescription></CardHeader><CardContent className="space-y-5"><div className="flex items-center gap-4"><Avatar className="size-16"><AvatarImage src={user?.avatar_url || user?.avatar} alt={name} /><AvatarFallback>{name.slice(0, 2) || "U"}</AvatarFallback></Avatar><div><p className="text-base font-medium">{name}</p><p className="text-sm text-muted-foreground">{user?.username || "未设置用户名"}</p><p className="text-xs text-muted-foreground">{user?.email || "未设置邮箱"}</p></div></div><div className="space-y-2"><label className="text-sm font-medium" htmlFor="account-display-name">显示名称</label><input id="account-display-name" className="flex h-9 w-full border bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" value={displayName} onChange={(event) => setDisplayName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} /><Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存资料"}</Button></div><div className="border p-3 text-sm"><p className="text-xs text-muted-foreground">邮箱验证状态</p><p className="mt-1 font-medium">{user?.email_verified ? "已验证" : "待验证（后端接入后可操作）"}</p></div></CardContent></Card>;
}

function SettingRow({ title, description, value }) { return <div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div><div className="shrink-0">{value}</div></div>; }

function PreferencesView({ theme, applyTheme, showTitlebarTitle, titlebarTitleMode, onTitlebarVisibilityChange, onTitlebarModeChange, sidebarRailEnabled, onSidebarRailChange, contentWidth, onContentWidthChange }) {
  const [notifications, setNotifications] = useState(true);
  const updateNotifications = (checked) => { setNotifications(checked); notify.success(checked ? "桌面通知已开启" : "桌面通知已关闭"); };
  const widths = [["standard", "标准"], ["wide", "宽"], ["full", "全宽"]];
  const titlebarModes = [["none", "无"], ["page", "当前页面名称"], ["app", "应用名称"]];
  return <Card><CardHeader><CardTitle>偏好与通知</CardTitle><CardDescription>设置立即应用于当前桌面客户端，暂不写入服务端。</CardDescription></CardHeader><CardContent className="space-y-5">
    <SettingRow title="主题" description="在浅色、深色和系统外观之间切换" value={<div className="flex gap-1">{[["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]].map(([value, label]) => <Button key={value} size="sm" variant={theme === value ? "secondary" : "outline"} onClick={() => { applyTheme(value); notify.info(`已切换到${label}主题`); }}>{label}</Button>)}</div>} />
    <SettingRow title="页面内容宽度" description="独占详情时控制内容画布；普通分栏始终填满各自栏位。" value={<div className="flex gap-1">{widths.map(([value, label]) => <Button key={value} size="sm" variant={contentWidth === value ? "secondary" : "outline"} onClick={() => onContentWidthChange(value)}>{label}</Button>)}</div>} />
    <SettingRow title="标题栏标题" description="选择窗口标题栏中央的显示内容；选择“无”后，移入标题栏仍可查看完整面包屑" value={<div className="flex gap-1" role="radiogroup" aria-label="标题栏标题">{titlebarModes.map(([value, label]) => <Button key={value} type="button" size="sm" variant={(value === "none" ? !showTitlebarTitle : showTitlebarTitle && titlebarTitleMode === value) ? "secondary" : "outline"} role="radio" aria-checked={value === "none" ? !showTitlebarTitle : showTitlebarTitle && titlebarTitleMode === value} onClick={() => { if (value === "none") onTitlebarVisibilityChange(false); else { if (!showTitlebarTitle) onTitlebarVisibilityChange(true); onTitlebarModeChange(value); } }}>{label}</Button>)}</div>} />
    <SettingRow title="侧栏边缘热区" description="紧贴侧栏的细条点击可展开或收起侧栏；关闭后仍可用 Ctrl+B 或标题栏按钮切换" value={<Switch checked={sidebarRailEnabled} onCheckedChange={onSidebarRailChange} />} />
    <SettingRow title="桌面通知" description="接收活动提醒和系统状态通知" value={<Switch checked={notifications} onCheckedChange={updateNotifications} />} />
    <SettingRow title="语言" description="多语言界面将在偏好服务接入后开放" value={<Badge variant="outline">中文（即将开放）</Badge>} />
    <SettingRow title="时区" description="活动时间显示时区将在偏好服务接入后开放" value={<Badge variant="outline">Asia/Shanghai</Badge>} />
  </CardContent></Card>;
}

function SecurityView() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" }); const [saving, setSaving] = useState(false);
  const changePassword = async () => {
    if (!form.current || form.next.length < 8 || form.next !== form.confirm) return notify.error("无法修改密码", { description: form.next.length < 8 ? "新密码至少需要 8 个字符。" : "两次输入的新密码不一致。" });
    setSaving(true); const toastId = notify.loading("正在修改密码…");
    try { await updatePassword(form.current, form.next); setForm({ current: "", next: "", confirm: "" }); notify.success("密码已修改", { id: toastId }); }
    catch (error) { notify.error("密码修改失败", { id: toastId, description: error instanceof Error ? error.message : String(error) }); }
    finally { setSaving(false); }
  };
  return <div className="space-y-4"><Card><CardHeader><CardTitle>登录与安全</CardTitle><CardDescription>密码修改已接入，其他安全能力等待后端接口。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-3 border p-3"><LockKeyhole className="size-4 text-primary" /><div><p className="text-sm font-medium">修改密码</p><p className="text-xs text-muted-foreground">使用当前密码验证身份后设置新密码。</p></div></div>{[["security-current", "当前密码", "current"], ["security-next", "新密码", "next"], ["security-confirm", "确认新密码", "confirm"]].map(([id, label, key]) => <div key={id} className="space-y-2"><label className="text-sm font-medium" htmlFor={id}>{label}</label><input id={id} type="password" className="flex h-9 w-full border bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></div>)}<Button onClick={changePassword} disabled={saving}>{saving ? "提交中…" : "修改密码"}</Button></CardContent></Card><PlaceholderSecurity title="邮箱验证" description="邮箱验证和重新发送验证邮件将在后端接入后开放。" /><PlaceholderSecurity title="登录设备与会话" description="设备列表、远程退出和登录历史将在会话 API 接入后开放。" /><PlaceholderSecurity title="注销账户" description="账户删除需要后端确认和数据保留策略，暂不可操作。" /></div>;
}
function PlaceholderSecurity({ title, description }) { return <Card><CardContent className="flex items-start gap-3 p-4"><ShieldCheck className="mt-0.5 size-4 text-muted-foreground" /><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div></CardContent></Card>; }

function BillingView({ subscription }) {
  const isPro = subscription?.plan === "pro";
  return <div className="space-y-4"><Card><CardHeader><CardTitle>方案与账单</CardTitle><CardDescription>当前方案来自本地订阅状态，支付服务接入后将自动同步。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between gap-4 border p-4"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center bg-primary/10 text-primary"><CreditCard className="size-4" /></div><div><p className="font-medium">{isPro ? "Pro 方案" : "免费方案"}</p><p className="text-sm text-muted-foreground">{isPro ? "已启用 Pro 能力" : "适合本地体验和基础功能"}</p></div></div><Badge variant={isPro ? "default" : "secondary"}>{isPro ? "PRO" : "FREE"}</Badge></div><div className="grid gap-3 text-sm md:grid-cols-3"><div className="border p-3">工作空间：{isPro ? "不限" : "基础额度"}</div><div className="border p-3">活动与资源：{isPro ? "完整能力" : "本地体验"}</div><div className="border p-3">团队协作：{isPro ? "可用" : "即将开放"}</div></div><Button className="w-full" variant={isPro ? "outline" : "default"} onClick={() => notify.message(isPro ? "订阅管理将在接入支付服务后开放" : "升级功能将在接入支付服务后开放", { description: "当前为前端预览模式。" })}>{isPro ? "管理订阅" : "升级到 Pro"}</Button></CardContent></Card><Card><CardContent className="p-4 text-sm text-muted-foreground">账单、发票和付款方式将在计费服务接入后显示。</CardContent></Card></div>;
}

export function AccountCenter({ page = "profile", user, workspace, onUserUpdate, subscription, theme, applyTheme, devtools, onDevtoolsChange, showTitlebarTitle, titlebarTitleMode, onTitlebarVisibilityChange, onTitlebarModeChange, sidebarRailEnabled, onSidebarRailChange, contentWidth, onContentWidthChange, initialAction }) {
  const titles = { profile: ["个人资料", "管理你的个人身份信息和邮箱。"], preferences: ["偏好与通知", "控制 StagePilot 的外观和通知体验。"], security: ["登录与安全", "保护账号、密码和登录安全。"], billing: ["方案与账单", "查看当前方案和可用能力。"], developer: ["开发工具", "验证桌面能力和 UI 组件。"] };
  const [title, description] = titles[page] || titles.profile;
  const pageWidthClass = { standard: "max-w-6xl", wide: "max-w-7xl", full: "max-w-none" }[contentWidth] || "max-w-6xl";
  return <div className={`mx-auto w-full ${pageWidthClass} space-y-5`}><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div>{page === "profile" && <AccountProfile user={user} onUserUpdate={onUserUpdate} />}{page === "preferences" && <PreferencesView theme={theme} applyTheme={applyTheme} showTitlebarTitle={showTitlebarTitle} titlebarTitleMode={titlebarTitleMode} onTitlebarVisibilityChange={onTitlebarVisibilityChange} onTitlebarModeChange={onTitlebarModeChange} sidebarRailEnabled={sidebarRailEnabled} onSidebarRailChange={onSidebarRailChange} contentWidth={contentWidth} onContentWidthChange={onContentWidthChange} />}{page === "security" && <SecurityView />}{page === "billing" && <BillingView subscription={subscription} />}{page === "developer" && import.meta.env.DEV && <DeveloperTools workspace={workspace} devtools={devtools} onDevtoolsChange={onDevtoolsChange} initialAction={initialAction} contentWidth={contentWidth} />}</div>;
}
