import { useEffect, useState } from "react";
import { Download, FileUp, Trash2 } from "@/components/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { completeFileUpload, createFileUpload, deleteFile, downloadFile, listFiles, uploadToPresignedUrl } from "@/lib/file-api";
import { AppBackLink } from "@/components/app-back-link";
import { PageHeader, PageHeaderActions } from "@/components/page-header";

const size = (n) => n < 1024 ** 2 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
export function FilesPage({ workspace, productionId = "workspace", title = "文件资料", backTo, backLabel }) {
  const [items, setItems] = useState([]); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(null);
  const reload = async () => { try { setItems((await listFiles(workspace.id, productionId)).items || []); } catch (e) { notify.error("无法加载文件", { description: e?.message || String(e) }); } };
  useEffect(() => { reload(); }, [workspace.id, productionId]);
  const upload = async (event) => { const files = [...event.target.files]; event.target.value = ""; if (!files.length) return; setBusy(true); const toast = notify.loading("正在上传文件…"); try { for (const file of files) { setProgress({ name: file.name, value: 0 }); const created = await createFileUpload(workspace.id, { filename: file.name, content_type: file.type, size_bytes: file.size, production_id: productionId === "workspace" ? null : productionId }); await uploadToPresignedUrl(created.upload.url, file, (value) => setProgress({ name: file.name, value })); await completeFileUpload(workspace.id, created.file.id); } await reload(); notify.success("文件上传完成", { id: toast }); } catch (e) { notify.error("文件上传失败", { id: toast, description: e?.message || String(e) }); } finally { setBusy(false); setProgress(null); } };
  const remove = async (id) => { const toast = notify.loading("正在删除文件…"); try { await deleteFile(workspace.id, id); await reload(); notify.success("文件已删除", { id: toast }); } catch (e) { notify.error("删除失败", { id: toast, description: e?.message || String(e) }); } };
  const openDownload = async (id) => { try { const result = await downloadFile(workspace.id, id); await openUrl(result.url); } catch (e) { notify.error("无法下载文件", { description: e?.message || String(e) }); } };
  return <div className="space-y-5"><PageHeader back={backTo ? <AppBackLink to={backTo} label={backLabel || "返回"} /> : null} title={title} description={productionId === "workspace" ? "工作空间共享资料。" : "仅属于当前活动的文档和媒体文件。"} actions={<PageHeaderActions primary={<label className="block"><Button asChild disabled={busy}><span><FileUp />上传文件</span></Button><input className="hidden" type="file" multiple onChange={upload} /></label>} />} /><Card><CardContent className="space-y-3">{progress && <div className="border p-3 text-sm"><div className="flex justify-between"><span className="truncate">{progress.name}</span><span>{Math.round(progress.value * 100)}%</span></div><div className="mt-2 h-1 bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress.value * 100}%` }} /></div></div>}{items.length ? items.map((file) => <div key={file.id} className="flex items-center gap-3 border-b py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.filename}</p><p className="text-xs text-muted-foreground">{size(file.size_bytes)} · {file.content_type}</p></div><Badge variant={file.status === "uploaded" ? "secondary" : "outline"}>{file.status === "uploaded" ? "已上传" : "处理中"}</Badge><Button size="icon-sm" variant="ghost" onClick={() => openDownload(file.id)} disabled={file.status !== "uploaded"} aria-label="下载"><Download /></Button><Button size="icon-sm" variant="ghost" onClick={() => remove(file.id)} aria-label="删除"><Trash2 /></Button></div>) : <p className="py-12 text-center text-sm text-muted-foreground">暂无文件资料</p>}</CardContent></Card></div>;
}
