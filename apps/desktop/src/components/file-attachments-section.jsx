import { useCallback, useEffect, useState } from "react";
import { Clock3, Copy, Download, FileUp, RefreshCw, Trash2 } from "@/components/ui/icons";
import { useTransferCenter } from "@/components/transfer-center-context";
import { isTauriRuntime } from "@/lib/app-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/sonner";
import { listFileTypes } from "@/lib/resource-api";
import { resolveSelectItems } from "@/lib/select-options";
import {
  clearUploadResume, copyProductionProgramAttachment, detachAttachment, listAttachmentVersions, restoreAttachment,
  listProductionProgramAttachments, listProgramAttachments,
} from "@/lib/file-api";

export function FileAttachmentsSection({ workspace, production, programId, sourceProgramId }) {
  const isProduction = Boolean(production);
  const { enqueueUpload, enqueueDownload } = useTransferCenter();
  const [items, setItems] = useState([]);
  const [capabilities, setCapabilities] = useState({});
  const [sourceItems, setSourceItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [selectedType, setSelectedType] = useState("none");
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versionItems, setVersionItems] = useState({});
  const [confirmDetach, setConfirmDetach] = useState(null);
  const [showTrash, setShowTrash] = useState(false);

  const reload = useCallback(async () => {
    const result = isProduction
      ? await listProductionProgramAttachments(production.id, programId, showTrash)
      : await listProgramAttachments(workspace.id, programId, showTrash);
    setItems(result.items || []);
    setCapabilities(result.capabilities || {});
  }, [isProduction, production?.id, programId, showTrash, workspace.id]);

  useEffect(() => {
    reload().catch((error) => notify.error("无法加载附件", { description: error?.message || String(error) }));
  }, [reload]);
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener("stagepilot-transfer-finished", refresh);
    return () => window.removeEventListener("stagepilot-transfer-finished", refresh);
  }, [reload]);
  useEffect(() => {
    if (isProduction || !workspace?.id) return;
    setTypesLoading(true);
    listFileTypes(workspace.id, { scope: "program" })
      .then((result) => setTypes((result.items || []).filter((item) => item.is_active)))
      .catch((error) => notify.error("无法加载文件类型", { description: error?.message || String(error) }))
      .finally(() => setTypesLoading(false));
  }, [isProduction, workspace?.id]);
  useEffect(() => {
    if (!isProduction || !sourceProgramId || !workspace?.role) return;
    listProgramAttachments(workspace.id, sourceProgramId)
      .then((result) => setSourceItems(result.items || []))
      .catch((error) => notify.error("无法加载来源节目附件", { description: error?.message || String(error) }));
  }, [isProduction, sourceProgramId, workspace?.id, workspace?.role]);

  const uploadIntent = () => ({
    kind: isProduction ? "production-program-attachment" : "program-attachment",
    workspaceId: workspace.id, productionId: production?.id, programId,
    contextName: production?.name || workspace.name,
    fileTypeId: isProduction || selectedType === "none" ? null : selectedType,
    restricted: restricted || types.find((type) => type.id === selectedType)?.template_key === "program.rights",
  });
  const uploadNew = async (event) => {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = "";
    if (!isTauriRuntime && !file) return;
    try { await enqueueUpload(uploadIntent(), { file }); } catch { /* queue owns feedback */ }
  };
  const uploadVersion = async (item, event) => {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = "";
    if (!isTauriRuntime && !file) return;
    try { await enqueueUpload({ kind: "attachment-version", attachmentId: item.id,
      contextName: production?.name || workspace.name }, { file }); } catch { /* queue owns feedback */ }
  };

  const showVersions = async (item) => {
    if (versionItems[item.id]) { setVersionItems((current) => ({ ...current, [item.id]: null })); return; }
    try {
      const result = await listAttachmentVersions(item.id);
      setVersionItems((current) => ({ ...current, [item.id]: result.items || [] }));
      notify.info("已加载版本历史");
    } catch (error) { notify.error("无法加载版本历史", { description: error?.message || String(error) }); }
  };

  const download = async (item, versionId) => {
    try { await enqueueDownload({ kind: "attachment", attachmentId: item.id, versionId,
      contextName: production?.name || workspace.name }); } catch { /* queue owns feedback */ }
  };

  const detach = async () => {
    if (!confirmDetach) return;
    const toast = notify.loading("正在解除附件关联…");
    try {
      await detachAttachment(confirmDetach.id);
      setConfirmDetach(null);
      await reload();
      notify.success("已解除关联，配额已释放；内容仍保留 30 天供恢复", { id: toast });
    } catch (error) { notify.error("解除关联失败", { id: toast, description: error?.message || String(error) }); }
  };

  const restore = async (item) => {
    const toast = notify.loading("正在恢复附件…");
    try {
      await restoreAttachment(item.id);
      await reload();
      notify.success("附件已恢复", { id: toast });
    } catch (error) { notify.error("恢复附件失败", { id: toast, description: error?.message || String(error) }); }
  };

  const copy = async (source, versionId = source.version_id) => {
    const toast = notify.loading("正在复制固定版本到活动…");
    setBusy(true);
    try {
      const result = await copyProductionProgramAttachment(production.id, programId, { attachment_id: source.id, version_id: versionId });
      clearUploadResume(result._resumeKey);
      await reload();
      notify.info("已提交固定版本复制；安全检查通过后可用，来源后续版本不会自动同步", { id: toast });
    } catch (error) { notify.error("复制附件失败", { id: toast, description: error?.message || String(error) }); }
    finally { setBusy(false); }
  };

  return <Card variant="flush">
    <CardHeader className="border-b"><CardTitle>附件与版本</CardTitle><CardDescription>附件按所属节目授权；历史版本可单独下载。</CardDescription></CardHeader>
    <CardContent className="space-y-4 p-4">
      {capabilities.can_attach && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setShowTrash((current) => !current)}>{showTrash ? "返回附件" : "查看回收站"}</Button></div>}
      {capabilities.can_attach && <div className="flex flex-wrap items-center gap-3">
        {!isProduction && (() => { const options = [{ value: "none", label: "未分类" }, ...types.map((type) => ({ value: type.id, label: type.name || "未命名文件类型" }))]; const select = resolveSelectItems(options, { value: selectedType, loading: typesLoading }); return <Select items={select.items} value={selectedType} onValueChange={setSelectedType} disabled={typesLoading}><SelectTrigger className="w-48"><SelectValue placeholder={typesLoading ? "正在加载文件类型…" : "文件类型"} /></SelectTrigger><SelectContent>{select.missingOption ? <SelectItem value={select.missingOption.value} disabled>{select.missingOption.label}</SelectItem> : null}{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>; })()}
        {capabilities.can_attach_restricted && <label className="flex items-center gap-2 text-sm"><Switch checked={restricted} onCheckedChange={setRestricted} />敏感资料</label>}
        {isTauriRuntime ? <Button type="button" onClick={() => void uploadNew()}><FileUp />上传附件</Button>
          : <label><Button asChild><span><FileUp />上传附件</span></Button><input type="file" className="hidden" onChange={uploadNew} /></label>}
      </div>}
      {items.length ? items.map((item) => <div key={item.id} className="border-b pb-3">
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.filename}</span><Badge variant="outline">v{item.version_no}</Badge><Badge variant={item.scan_status === "rejected" ? "destructive" : item.scan_status === "processing" ? "outline" : "secondary"}>{item.scan_status === "processing" ? (item.capabilities?.can_download ? "新版检查中 · 当前版可用" : "安全检查中") : item.scan_status === "rejected" ? (item.capabilities?.can_download ? "新版未通过 · 当前版可用" : "安全检查未通过") : "可用"}</Badge>{item.security_class === "restricted" && <Badge variant="secondary">敏感</Badge>}
          {showTrash && <><Badge variant={item.content_purged ? "destructive" : "outline"}>{item.content_purged ? "内容已清除" : `可恢复至 ${item.restore_until ? new Date(item.restore_until).toLocaleDateString() : "期限未知"}`}</Badge><Button size="icon-sm" variant="ghost" aria-label="恢复附件" onClick={() => restore(item)} disabled={!item.capabilities?.can_restore || item.content_purged}><RefreshCw /></Button></>}
          <Button size="icon-sm" variant="ghost" aria-label="下载附件" onClick={() => download(item)} disabled={!item.capabilities?.can_download}><Download /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="查看版本历史" onClick={() => showVersions(item)}><Clock3 /></Button>
          {item.capabilities?.can_detach && <Button size="icon-sm" variant="ghost" aria-label="解除附件关联" onClick={() => setConfirmDetach(item)}><Trash2 /></Button>}
        </div>
        {item.capabilities?.can_upload_version && (isTauriRuntime ? <Button type="button" variant="link" size="sm" onClick={() => void uploadVersion(item)}><FileUp className="size-3.5" />上传新版</Button>
          : <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary"><FileUp className="size-3.5" />上传新版<input type="file" className="hidden" onChange={(event) => uploadVersion(item, event)} /></label>)}
        {versionItems[item.id]?.map((version) => <div key={version.id} className="mt-2 flex items-center gap-2 pl-3 text-xs text-muted-foreground"><span className="flex-1 truncate">v{version.version_no} · {version.filename} · {version.scan_status === "processing" ? "检查中" : version.scan_status === "rejected" ? "未通过" : "可用"}</span><Button size="sm" variant="ghost" disabled={version.scan_status !== "ready"} onClick={() => download(item, version.id)}>下载</Button></div>)}
      </div>) : <p className="text-sm text-muted-foreground">{showTrash ? "回收站为空" : "暂无附件"}</p>}
      {isProduction && sourceItems.length > 0 && capabilities.can_attach && <div className="space-y-2 border-t pt-3"><p className="text-sm font-medium">从来源节目复制固定版本</p>{sourceItems.map((source) => <div key={source.id} className="space-y-1"><div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{source.filename} · v{source.version_no}</span><Button size="sm" variant="ghost" onClick={() => showVersions(source)}><Clock3 />历史版本</Button><Button size="sm" variant="outline" onClick={() => copy(source)} disabled={busy || !source.capabilities?.can_download}><Copy />复制当前版</Button></div>{versionItems[source.id]?.map((version) => <div key={version.id} className="flex items-center gap-2 pl-3 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">v{version.version_no} · {version.filename} · {version.scan_status === "ready" ? "可用" : version.scan_status === "processing" ? "检查中" : "未通过"}</span><Button size="sm" variant="outline" onClick={() => copy(source, version.id)} disabled={busy || version.scan_status !== "ready"}>复制此版本</Button></div>)}</div>)}</div>}
      {confirmDetach && <div role="alertdialog" aria-label="确认解除附件关联" className="space-y-2 rounded-md border p-3 text-sm"><p>解除“{confirmDetach.filename}”的关联？配额会立即释放，文件和全部历史版本仍保留 30 天供恢复。</p><div className="flex gap-2"><Button size="sm" variant="destructive" onClick={detach}>确认解除</Button><Button size="sm" variant="outline" onClick={() => setConfirmDetach(null)}>取消</Button></div></div>}
    </CardContent>
  </Card>;
}
