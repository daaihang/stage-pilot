import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Clock3, Copy, Download, FileUp, Trash2 } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/sonner";
import { listFileTypes } from "@/lib/resource-api";
import {
  completeUploadSession, copyProductionProgramAttachment, createProductionProgramAttachment,
  createProgramAttachment, detachAttachment, downloadAttachment, listAttachmentVersions,
  listProductionProgramAttachments, listProgramAttachments, startAttachmentVersion, uploadToPresignedUrl,
} from "@/lib/file-api";

export function FileAttachmentsSection({ workspace, production, programId, sourceProgramId }) {
  const isProduction = Boolean(production);
  const [items, setItems] = useState([]);
  const [capabilities, setCapabilities] = useState({});
  const [sourceItems, setSourceItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [selectedType, setSelectedType] = useState("none");
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versionItems, setVersionItems] = useState({});
  const [confirmDetach, setConfirmDetach] = useState(null);

  const reload = useCallback(async () => {
    const result = isProduction
      ? await listProductionProgramAttachments(production.id, programId)
      : await listProgramAttachments(workspace.id, programId);
    setItems(result.items || []);
    setCapabilities(result.capabilities || {});
  }, [isProduction, production?.id, programId, workspace.id]);

  useEffect(() => {
    reload().catch((error) => notify.error("无法加载附件", { description: error?.message || String(error) }));
  }, [reload]);
  useEffect(() => {
    if (isProduction || !workspace?.id) return;
    listFileTypes(workspace.id, { scope: "program" })
      .then((result) => setTypes((result.items || []).filter((item) => item.is_active)))
      .catch((error) => notify.error("无法加载文件类型", { description: error?.message || String(error) }));
  }, [isProduction, workspace?.id]);
  useEffect(() => {
    if (!isProduction || !sourceProgramId || !workspace?.role) return;
    listProgramAttachments(workspace.id, sourceProgramId)
      .then((result) => setSourceItems(result.items || []))
      .catch((error) => notify.error("无法加载来源节目附件", { description: error?.message || String(error) }));
  }, [isProduction, sourceProgramId, workspace?.id, workspace?.role]);

  const executeUpload = async (file, start) => {
    if (!file) return;
    setBusy(true);
    const toast = notify.loading("正在上传附件…");
    try {
      const result = await start({ filename: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size });
      await uploadToPresignedUrl(result.upload.url, file);
      await completeUploadSession(result.upload.upload_id);
      await reload();
      notify.success("附件上传完成", { id: toast });
    } catch (error) {
      notify.error("附件上传失败", { id: toast, description: error?.message || String(error) });
    } finally { setBusy(false); }
  };

  const uploadNew = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const payload = { filename: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size,
      file_type_id: isProduction || selectedType === "none" ? null : selectedType,
      restricted: restricted || types.find((type) => type.id === selectedType)?.template_key === "program.rights" };
    void executeUpload(file, (upload) => isProduction
      ? createProductionProgramAttachment(production.id, programId, { ...payload, ...upload })
      : createProgramAttachment(workspace.id, programId, { ...payload, ...upload }));
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
    try {
      const result = await downloadAttachment(item.id, versionId);
      await openUrl(result.url);
      notify.success("已打开附件下载");
    } catch (error) { notify.error("无法下载附件", { description: error?.message || String(error) }); }
  };

  const detach = async () => {
    if (!confirmDetach) return;
    const toast = notify.loading("正在解除附件关联…");
    try {
      await detachAttachment(confirmDetach.id);
      setConfirmDetach(null);
      await reload();
      notify.success("已解除关联，文件版本已保留", { id: toast });
    } catch (error) { notify.error("解除关联失败", { id: toast, description: error?.message || String(error) }); }
  };

  const copy = async (source, versionId = source.version_id) => {
    const toast = notify.loading("正在复制固定版本到活动…");
    try {
      await copyProductionProgramAttachment(production.id, programId, { attachment_id: source.id, version_id: versionId });
      await reload();
      notify.success("已复制到本活动，来源后续版本不会自动同步", { id: toast });
    } catch (error) { notify.error("复制附件失败", { id: toast, description: error?.message || String(error) }); }
  };

  return <Card variant="flush">
    <CardHeader className="border-b"><CardTitle>附件与版本</CardTitle><CardDescription>附件按所属节目授权；历史版本可单独下载。</CardDescription></CardHeader>
    <CardContent className="space-y-4 p-4">
      {capabilities.can_attach && <div className="flex flex-wrap items-center gap-3">
        {!isProduction && <Select value={selectedType} onValueChange={setSelectedType}><SelectTrigger className="w-48"><SelectValue placeholder="文件类型" /></SelectTrigger><SelectContent><SelectItem value="none">未分类</SelectItem>{types.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select>}
        {capabilities.can_attach_restricted && <label className="flex items-center gap-2 text-sm"><Switch checked={restricted} onCheckedChange={setRestricted} />敏感资料</label>}
        <label><Button asChild disabled={busy}><span><FileUp />上传附件</span></Button><input type="file" className="hidden" onChange={uploadNew} disabled={busy} /></label>
      </div>}
      {items.length ? items.map((item) => <div key={item.id} className="border-b pb-3">
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.filename}</span><Badge variant="outline">v{item.version_no}</Badge>{item.security_class === "restricted" && <Badge variant="secondary">敏感</Badge>}
          <Button size="icon-sm" variant="ghost" aria-label="下载附件" onClick={() => download(item)}><Download /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="查看版本历史" onClick={() => showVersions(item)}><Clock3 /></Button>
          {item.capabilities?.can_detach && <Button size="icon-sm" variant="ghost" aria-label="解除附件关联" onClick={() => setConfirmDetach(item)}><Trash2 /></Button>}
        </div>
        {item.capabilities?.can_upload_version && <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary"><FileUp className="size-3.5" />上传新版<input type="file" className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void executeUpload(file, (payload) => startAttachmentVersion(item.id, payload)); }} /></label>}
        {versionItems[item.id]?.map((version) => <div key={version.id} className="mt-2 flex items-center gap-2 pl-3 text-xs text-muted-foreground"><span className="flex-1 truncate">v{version.version_no} · {version.filename}</span><Button size="sm" variant="ghost" onClick={() => download(item, version.id)}>下载</Button></div>)}
      </div>) : <p className="text-sm text-muted-foreground">暂无附件</p>}
      {isProduction && sourceItems.length > 0 && capabilities.can_attach && <div className="space-y-2 border-t pt-3"><p className="text-sm font-medium">从来源节目复制固定版本</p>{sourceItems.map((source) => <div key={source.id} className="space-y-1"><div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{source.filename} · v{source.version_no}</span><Button size="sm" variant="ghost" onClick={() => showVersions(source)}><Clock3 />历史版本</Button><Button size="sm" variant="outline" onClick={() => copy(source)} disabled={busy}><Copy />复制当前版</Button></div>{versionItems[source.id]?.map((version) => <div key={version.id} className="flex items-center gap-2 pl-3 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">v{version.version_no} · {version.filename}</span><Button size="sm" variant="outline" onClick={() => copy(source, version.id)} disabled={busy}>复制此版本</Button></div>)}</div>)}</div>}
      {confirmDetach && <div role="alertdialog" aria-label="确认解除附件关联" className="space-y-2 rounded-md border p-3 text-sm"><p>解除“{confirmDetach.filename}”的关联？文件和历史版本仍会保留。</p><div className="flex gap-2"><Button size="sm" variant="destructive" onClick={detach}>确认解除</Button><Button size="sm" variant="outline" onClick={() => setConfirmDetach(null)}>取消</Button></div></div>}
    </CardContent>
  </Card>;
}
