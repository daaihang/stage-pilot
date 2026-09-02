import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function AuthScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); setNotice(""); try { if (mode === "login") await onLogin(email, password); else { const result = await onRegister(email, password); setNotice(result.debugToken ? `开发验证 token：${result.debugToken}` : "验证邮件已发送，请完成邮箱验证。"); } } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6"><Card className="w-full max-w-md"><CardHeader><CardTitle>{mode === "login" ? "登录 StagePilot" : "创建账号"}</CardTitle><CardDescription>{mode === "login" ? "使用任意已绑定的登录方式进入账号。" : "邮箱密码是当前登录方式，未来可绑定手机号或第三方账号。"}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}><Input type="email" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} required /><Input type="password" placeholder="密码（至少 8 位）" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />{error && <p className="text-sm text-destructive">{error}</p>}{notice && <p className="break-all text-sm text-muted-foreground">{notice}</p>}<Button className="w-full" disabled={busy}>{busy ? "处理中…" : mode === "login" ? "登录" : "注册"}</Button></form><button className="mt-4 w-full text-sm text-muted-foreground underline" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setNotice(""); }}>{mode === "login" ? "还没有账号？创建账号" : "已有账号？返回登录"}</button></CardContent></Card></main>;
}
