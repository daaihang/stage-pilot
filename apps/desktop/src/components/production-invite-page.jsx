import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { acceptProductionInvitation } from "@/lib/production-api";
import { directProductionPath } from "@/lib/navigation";

export function ProductionInvitePage({ token }) {
  const navigate = useNavigate(); const [busy, setBusy] = useState(false);
  const accept = async () => { setBusy(true); const toast = notify.loading("正在接受活动邀请…"); try { const result = await acceptProductionInvitation(token); notify.success("已加入活动", { id: toast }); navigate(directProductionPath(result.production_id), { replace: true }); } catch (error) { notify.error("无法接受邀请", { id: toast, description: error.message }); } finally { setBusy(false); } };
  return <div className="flex min-h-[60vh] items-center justify-center"><Card className="w-full max-w-md"><CardHeader><CardTitle>活动邀请</CardTitle><CardDescription>接受后，你将只获得这场活动的授权访问。</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={accept} disabled={busy}>{busy ? "正在加入…" : "接受邀请并进入活动"}</Button></CardContent></Card></div>;
}
