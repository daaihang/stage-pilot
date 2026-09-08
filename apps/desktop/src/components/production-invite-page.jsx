import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notify } from "@/components/ui/sonner";
import { acceptInvitation, normalizeInvitationCode } from "@/lib/invitation-api";
import { directProductionPath, workspacePath } from "@/lib/navigation";

export function InvitationAcceptPage({ code, authenticated = true, onRequireAuth }) {
  const navigate = useNavigate(); const [busy, setBusy] = useState(false); const [confirmOpen, setConfirmOpen] = useState(false);
  const normalizedCode = normalizeInvitationCode(code);
  const authPromptedRef = useRef(false);
  useEffect(() => {
    if (!authenticated && !authPromptedRef.current) {
      authPromptedRef.current = true;
      onRequireAuth?.();
    }
  }, [authenticated, onRequireAuth]);
  useEffect(() => {
    if (authenticated && normalizedCode) setConfirmOpen(true);
  }, [authenticated, normalizedCode]);
  const accept = async () => { setBusy(true); const toast = notify.loading("正在接受邀请…"); try { const result = await acceptInvitation(normalizedCode); notify.success(result.scope_kind === "workspace" ? "已加入工作空间" : "已加入活动", { id: toast }); navigate(result.scope_kind === "workspace" ? workspacePath(result.workspace_id) : directProductionPath(result.production_id), { replace: true }); } catch (error) { notify.error("无法接受邀请", { id: toast, description: error.message }); } finally { setBusy(false); } };
  const invalidCode = !normalizedCode;
  return <div className="flex min-h-[60vh] items-center justify-center"><Card className="w-full max-w-md"><CardHeader><CardTitle>{invalidCode ? "邀请链接无效" : "接受邀请"}</CardTitle><CardDescription>{invalidCode ? "请检查链接或短码是否完整，然后重新打开邀请。" : authenticated ? "确认后会立即获得对应工作空间或活动的访问权限。" : "请先登录或注册账号，登录后会回到此邀请并继续确认。"}</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={() => (authenticated ? setConfirmOpen(true) : onRequireAuth?.())} disabled={busy || invalidCode}>{authenticated ? "打开接受确认" : "登录或注册后继续"}</Button></CardContent></Card><Dialog open={confirmOpen && authenticated && !invalidCode} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>确认接受邀请？</DialogTitle><DialogDescription>接受后会立即获得这份邀请授予的访问权限。Workspace 邀请还会校验当前账号的已验证邮箱。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>暂不接受</Button><Button type="button" onClick={accept} disabled={busy}>{busy ? "正在接受…" : "接受邀请"}</Button></DialogFooter></DialogContent></Dialog></div>;
}

export const ProductionInvitePage = InvitationAcceptPage;
