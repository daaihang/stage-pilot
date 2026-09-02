import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { forgotPassword } from "@/lib/auth";

export function AuthScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); setNotice(""); try { if (mode === "login") await onLogin(email, password); else if (mode === "register") { const result = await onRegister(email, password); setNotice(result.debugToken ? `开发验证 token：${result.debugToken}` : "验证邮件已发送，请完成邮箱验证。"); } else { const result = await forgotPassword(email); setNotice(result.debug_token ? `开发重置 token：${result.debug_token}` : "如果账号存在，密码重置邮件已发送。"); } } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const title = mode === "login" ? "登录 StagePilot" : mode === "register" ? "创建账号" : "找回密码";
  return <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-muted/30 p-6"><Card className="w-full max-w-md"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{mode === "login" ? "使用已绑定的登录方式进入账号。" : mode === "register" ? "邮箱密码是当前登录方式，未来可绑定手机号或第三方账号。" : "输入邮箱，我们会发送密码重置链接。"}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}><Input type="email" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} required />{mode !== "forgot" && <Input type="password" placeholder="密码（至少 8 位）" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />}{error && <p className="text-sm text-destructive">{error}</p>}{notice && <p className="break-all text-sm text-muted-foreground">{notice}</p>}<Button className="w-full" disabled={busy}>{busy ? "处理中…" : mode === "login" ? "登录" : mode === "register" ? "注册" : "发送重置邮件"}</Button></form><div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground"><button type="button" className="underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setNotice(""); }}>{mode === "login" ? "还没有账号？创建账号" : "已有账号？返回登录"}</button>{mode === "login" && <button type="button" className="underline" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}>忘记密码</button>}{mode === "forgot" && <button type="button" className="underline" onClick={() => { setMode("login"); setError(""); setNotice(""); }}>返回登录</button>}</div></CardContent></Card></main>;
}
