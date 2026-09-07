import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { acceptInvitation } from "@/lib/invitation-api";
import { directProductionPath, workspacePath } from "@/lib/navigation";

export function InvitationAcceptPage({ code, authenticated = true, onRequireAuth }) {
  const navigate = useNavigate(); const [busy, setBusy] = useState(false);
  const authPromptedRef = useRef(false);
  useEffect(() => {
    if (!authenticated && !authPromptedRef.current) {
      authPromptedRef.current = true;
      onRequireAuth?.();
    }
  }, [authenticated, onRequireAuth]);
  const accept = async () => { setBusy(true); const toast = notify.loading("正在接受邀请…"); try { const result = await acceptInvitation(code); notify.success(result.scope_kind === "workspace" ? "已加入工作空间" : "已加入活动", { id: toast }); navigate(result.scope_kind === "workspace" ? workspacePath(result.workspace_id) : directProductionPath(result.production_id), { replace: true }); } catch (error) { notify.error("无法接受邀请", { id: toast, description: error.message }); } finally { setBusy(false); } };
  return <div className="flex min-h-[60vh] items-center justify-center"><Card className="w-full max-w-md"><CardHeader><CardTitle>接受邀请</CardTitle><CardDescription>{authenticated ? "接受后会立即获得对应工作空间或活动的访问权限。" : "请先登录或注册账号，登录后会回到此邀请并继续接受。"}</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={authenticated ? accept : onRequireAuth} disabled={busy}>{authenticated ? (busy ? "正在加入…" : "接受邀请并继续") : "登录或注册后继续"}</Button></CardContent></Card></div>;
}

export const ProductionInvitePage = InvitationAcceptPage;
