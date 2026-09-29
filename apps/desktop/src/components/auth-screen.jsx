import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogDescription, DialogFooter, DialogForm, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { forgotPassword } from "@/lib/auth";
import { notify } from "@/components/ui/sonner";

export function AuthScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const title = mode === "login" ? "登录 StagePilot" : mode === "register" ? "创建账号" : "找回密码";
  const description = mode === "login" ? "使用已绑定的登录方式进入账号。" : mode === "register" ? "邮箱密码是当前登录方式，未来可绑定手机号或第三方账号。" : "输入邮箱，我们会发送密码重置链接。";
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const action = mode === "login" ? "登录" : mode === "register" ? "注册" : "发送密码重置邮件";
    try {
      if (mode === "login") { await onLogin(email, password); notify.success("登录成功", { description: "正在打开你的 StagePilot 工作台。" }); }
      else if (mode === "register") { const result = await onRegister(email, password); notify.success("注册成功", { description: result.debugToken ? "开发环境验证 token 已生成，请完成邮箱验证。" : "验证邮件已发送，请完成邮箱验证。" }); }
      else { const result = await forgotPassword(email); const nextNotice = result.debug_token ? "开发环境重置 token 已生成。" : "如果账号存在，密码重置邮件已发送。"; notify.success("重置邮件请求已提交", { description: nextNotice }); setNotice(result.debug_token ? `开发重置 token：${result.debug_token}` : nextNotice); }
    } catch (exception) {
      const message = exception instanceof Error ? exception.message : String(exception);
      setError(message); notify.error(`${action}失败`, { description: message });
    } finally { setBusy(false); }
  };
  const switchMode = (nextMode) => { setMode(nextMode); setError(""); setNotice(""); };
  return (
    <DialogForm onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <Input autoFocus type="email" placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} required />
          {mode !== "forgot" && <Input type="password" placeholder="密码（至少 8 位）" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="break-all text-sm text-muted-foreground">{notice}</p>}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <button type="button" className="underline" onClick={() => switchMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "还没有账号？创建账号" : "已有账号？返回登录"}</button>
            {mode === "login" && <button type="button" className="underline" onClick={() => switchMode("forgot")}>忘记密码</button>}
            {mode === "forgot" && <button type="button" className="underline" onClick={() => switchMode("login")}>返回登录</button>}
          </div>
        </div>
      </DialogBody>
      <DialogFooter layout="auth" primary={<Button type="submit" className="w-full" disabled={busy}>{busy ? "处理中…" : mode === "login" ? "登录" : mode === "register" ? "注册" : "发送重置邮件"}</Button>} />
    </DialogForm>
  );
}
