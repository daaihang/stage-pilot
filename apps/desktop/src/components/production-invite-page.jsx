import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { acceptInvitation } from "@/lib/invitation-api";
import { directProductionPath, workspacePath } from "@/lib/navigation";

export function ProductionInvitePage({ token }) {
  const navigate = useNavigate(); const [busy, setBusy] = useState(false);
  const accept = async () => { setBusy(true); const toast = notify.loading("正在接受邀请…"); try { const result = await acceptInvitation(token); notify.success(result.scope_kind === "workspace" ? "已加入工作空间" : "已加入活动", { id: toast }); navigate(result.scope_kind === "workspace" ? workspacePath(result.workspace_id) : directProductionPath(result.production_id), { replace: true }); } catch (error) { notify.error("无法接受邀请", { id: toast, description: error.message }); } finally { setBusy(false); } };
  return <div className="flex min-h-[60vh] items-center justify-center"><Card className="w-full max-w-md"><CardHeader><CardTitle>邀请</CardTitle><CardDescription>接受后会立即获得对应工作空间或活动的访问权限。</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={accept} disabled={busy}>{busy ? "正在加入…" : "接受邀请并继续"}</Button></CardContent></Card></div>;
}
