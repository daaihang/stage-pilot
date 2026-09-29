import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { appStore } from "@/lib/app-store";
import { notify } from "@/components/ui/sonner";
import {
  cancelUploadSession, completeUploadSession, createFileUpload, createProductionProgramAttachment,
  createProgramAttachment, clearUploadResume, downloadAttachment, downloadFile, downloadFileVersion, getUploadPartUrl,
  getUploadSessionStatus, listVerifiedUploadParts, startAttachmentVersion, startFileVersion,
  uploadToPresignedUrl,
} from "@/lib/file-api";

const TransferContext = createContext(null);
const native = isTauri();
const storageKey = (userId) => `transfer.tasks.${userId}.v1`;
const activeStatuses = new Set(["queued", "preparing", "transferring", "scanning"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function uploadLabel(intent) {
  switch (intent.kind) {
    case "library-create": return "文件上传";
    case "library-version": return "文件新版本";
    case "program-attachment": return "节目附件";
    case "production-program-attachment": return "活动节目附件";
    case "attachment-version": return "附件新版本";
    default: return "文件上传";
  }
}

function legacyResumeKey(intent, source) {
  let scope;
  switch (intent.kind) {
    case "library-create": scope = `workspace:${intent.workspaceId}:${intent.productionId || "workspace"}`; break;
    case "library-version": scope = `file-version:${intent.workspaceId}:${intent.fileId}`; break;
    case "program-attachment": scope = `program:${intent.workspaceId}:${intent.programId}`; break;
    case "production-program-attachment": scope = `production-program:${intent.productionId}:${intent.programId}`; break;
    case "attachment-version": scope = `attachment-version:${intent.attachmentId}`; break;
    default: return null;
  }
  try { return localStorage.getItem(`stagepilot.upload.resume.${scope}.${source.filename}:${source.size_bytes}:${source.modified_ms}`); }
  catch { return null; }
}

async function startUpload(intent, source, idempotencyKey) {
  const payload = {
    filename: source.filename, size_bytes: source.size_bytes, last_modified: source.modified_ms,
    content_type: source.content_type || "application/octet-stream",
  };
  switch (intent.kind) {
    case "library-create": return createFileUpload(intent.workspaceId, { ...payload, production_id: intent.productionId || null }, idempotencyKey);
    case "library-version": return startFileVersion(intent.workspaceId, intent.fileId, payload, idempotencyKey);
    case "program-attachment": return createProgramAttachment(intent.workspaceId, intent.programId, { ...payload, file_type_id: intent.fileTypeId || null, restricted: Boolean(intent.restricted) }, idempotencyKey);
    case "production-program-attachment": return createProductionProgramAttachment(intent.productionId, intent.programId, payload, idempotencyKey);
    case "attachment-version": return startAttachmentVersion(intent.attachmentId, payload, idempotencyKey);
    default: throw new Error("不支持的上传目标");
  }
}

async function describeDownload(intent, versionId) {
  if (intent.kind === "library") {
    return versionId ? downloadFileVersion(intent.workspaceId, intent.fileId, versionId) : downloadFile(intent.workspaceId, intent.fileId);
  }
  if (intent.kind === "attachment") return downloadAttachment(intent.attachmentId, versionId);
  throw new Error("不支持的下载目标");
}

function progressChannel(onProgress) {
  const channel = new Channel();
  channel.onmessage = ({ bytes, total }) => onProgress(Number(bytes) || 0, Number(total) || 0);
  return channel;
}

export function TransferProvider({ user, authStatus, children }) {
  const [tasks, setTasks] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const tasksRef = useRef([]);
  const activeRef = useRef(new Set());
  const browserFilesRef = useRef(new Map());
  const saveChainRef = useRef(Promise.resolve());
  const generationRef = useRef(0);
  const accountRef = useRef(null);
  const progressTimesRef = useRef(new Map());

  const checkpoint = useCallback((next, accountId = accountRef.current) => {
    if (!accountId) return Promise.resolve();
    tasksRef.current = next;
    setTasks(next);
    const snapshot = next.map(({ speedBps, ...task }) => task);
    saveChainRef.current = saveChainRef.current.catch(() => {}).then(async () => {
      await appStore.set(storageKey(accountId), snapshot);
      await appStore.save?.();
    });
    return saveChainRef.current;
  }, []);

  const update = useCallback((id, changes, durable = true) => {
    const next = tasksRef.current.map((task) => task.id === id ? { ...task, ...changes, updatedAt: Date.now() } : task);
    if (durable) return checkpoint(next);
    tasksRef.current = next;
    setTasks(next);
    return Promise.resolve();
  }, [checkpoint]);

  const reportProgress = useCallback((id, bytes, total) => {
    const now = Date.now();
    const previous = progressTimesRef.current.get(id);
    if (previous && now - previous.time < 250 && bytes < total) return;
    const speedBps = previous && now > previous.time && bytes >= previous.bytes
      ? Math.round((bytes - previous.bytes) * 1000 / (now - previous.time)) : 0;
    progressTimesRef.current.set(id, { bytes, time: now });
    void update(id, { transferredBytes: bytes, totalBytes: total, speedBps }, false);
  }, [update]);

  useEffect(() => {
    const accountId = authStatus === "authenticated" ? user?.id : null;
    generationRef.current += 1;
    for (const task of tasksRef.current) notify.dismiss(task.id);
    for (const id of activeRef.current) if (native) void invoke("transfer_abort", { taskId: id });
    activeRef.current.clear();
    browserFilesRef.current.clear();
    accountRef.current = accountId;
    tasksRef.current = [];
    setTasks([]);
    setHydrated(false);
    if (!accountId) return;
    const generation = generationRef.current;
    void (async () => {
      await appStore.init();
      const saved = await appStore.get(storageKey(accountId));
      if (generationRef.current !== generation) return;
      const restored = (Array.isArray(saved) ? saved : []).map((task) => {
        if (task.status === "preparing" || task.status === "transferring" || task.status === "queued") {
          return { ...task, status: native ? "queued" : "needs_file", speedBps: 0 };
        }
        return task;
      });
      tasksRef.current = restored;
      setTasks(restored);
      setHydrated(true);
    })().catch((error) => { if (generationRef.current === generation) { setHydrated(true); notify.error("无法恢复传输队列", { description: String(error) }); } });
  }, [authStatus, user?.id]);

  const enqueueUpload = useCallback(async (intent, { multiple = false, file } = {}) => {
    const accountId = accountRef.current;
    if (!accountId) throw new Error("请先登录");
    let sources;
    try {
      if (native) sources = await invoke("transfer_pick_files", { multiple });
      else sources = file ? [{ id: newId(), filename: file.name, size_bytes: file.size, modified_ms: file.lastModified, content_type: file.type }] : [];
      if (!sources.length) return;
      const added = sources.map((source) => {
        const id = newId();
        if (!native) browserFilesRef.current.set(id, file);
        return { id, ownerId: accountId, direction: "upload", intent, sourceId: source.id,
          filename: source.filename, sizeBytes: source.size_bytes, modifiedMs: source.modified_ms,
          contentType: source.content_type || "application/octet-stream", idempotencyKey: legacyResumeKey(intent, source) || newId(),
          status: "preparing", totalBytes: source.size_bytes, transferredBytes: 0, createdAt: Date.now() };
      });
      await checkpoint([...tasksRef.current, ...added], accountId);
      await checkpoint(tasksRef.current.map((task) => added.some((item) => item.id === task.id) ? { ...task, status: "queued" } : task), accountId);
      for (const item of added) notify.loading(`${uploadLabel(intent)}已加入传输队列`, { id: item.id, description: item.filename });
      return added.map((item) => item.id);
    } catch (error) {
      notify.error("无法开始上传", { description: error?.message || String(error) });
      return null;
    }
  }, [checkpoint]);

  const enqueueDownload = useCallback(async (intent) => {
    const accountId = accountRef.current;
    if (!accountId) throw new Error("请先登录");
    const toast = notify.loading("正在准备下载…");
    try {
      const descriptor = await describeDownload(intent, intent.versionId);
      if (!native) {
        window.open(descriptor.url, "_blank", "noopener,noreferrer");
        notify.info("已交给浏览器下载；桌面版支持进度与断点续传", { id: toast });
        return;
      }
      if (!descriptor.sha256 || !descriptor.version_id || !descriptor.size_bytes) throw new Error("服务端未提供可校验的文件版本");
      const destinationId = await invoke("transfer_pick_destination", { filename: descriptor.filename });
      if (!destinationId) { notify.dismiss(toast); return; }
      const item = { id: newId(), ownerId: accountId, direction: "download", intent,
        destinationId, versionId: descriptor.version_id, filename: descriptor.filename,
        sizeBytes: descriptor.size_bytes, sha256: descriptor.sha256, etag: descriptor.etag,
        status: "preparing", totalBytes: descriptor.size_bytes, transferredBytes: 0, createdAt: Date.now() };
      await checkpoint([...tasksRef.current, item], accountId);
      await update(item.id, { status: "queued" });
      notify.dismiss(toast);
      notify.loading("下载已加入传输队列", { id: item.id, description: item.filename });
      return item.id;
    } catch (error) {
      notify.error("无法开始下载", { id: toast, description: error?.message || String(error) });
      return null;
    }
  }, [checkpoint, update]);

  const monitorScan = useCallback(async (id, uploadId, generation) => {
    for (;;) {
      if (generationRef.current !== generation || tasksRef.current.find((task) => task.id === id)?.status !== "scanning") return;
      try {
        const result = await getUploadSessionStatus(uploadId);
        if (generationRef.current !== generation || tasksRef.current.find((task) => task.id === id)?.status !== "scanning") return;
        if (result.status === "ready") {
          await update(id, { status: "completed", transferredBytes: tasksRef.current.find((task) => task.id === id)?.totalBytes || 0 });
          const task = tasksRef.current.find((item) => item.id === id);
          if (native && task?.sourceId) void invoke("transfer_forget", { id: task.sourceId });
          clearUploadResume(task?.idempotencyKey);
          notify.success("安全检查通过，文件已可用", { id });
          window.dispatchEvent(new CustomEvent("stagepilot-transfer-finished", { detail: task?.intent }));
          return;
        }
        if (result.status === "rejected") {
          const reason = result.phase === "expired" ? "上传会话已过期" : "安全检查未通过";
          if (result.phase === "expired" || result.phase === "scan_rejected") clearUploadResume(tasksRef.current.find((task) => task.id === id)?.idempotencyKey);
          const rejectedTask = tasksRef.current.find((task) => task.id === id);
          if (result.phase === "scan_rejected" && native && rejectedTask?.sourceId) void invoke("transfer_forget", { id: rejectedTask.sourceId });
          await update(id, { status: result.phase === "expired" ? "expired" : "rejected", error: reason });
          notify.error("文件未能发布", { id, description: reason });
          return;
        }
      } catch (error) {
        if (error?.status === 401 || error?.status === 403 || error?.status === 404) {
          if (generationRef.current !== generation) return;
          await update(id, { status: "failed", error: error?.message || "无权查询上传状态" });
          notify.error("无法查询安全检查结果", { id, description: error?.message || String(error) });
          return;
        }
      }
      await sleep(3000);
    }
  }, [update]);

  const runUpload = useCallback(async (item, generation) => {
    await update(item.id, { status: "preparing", speedBps: 0 });
    const source = { filename: item.filename, size_bytes: item.sizeBytes, modified_ms: item.modifiedMs, content_type: item.contentType };
    if (native) {
      const digest = await invoke("transfer_hash_source", { sourceId: item.sourceId, onProgress: progressChannel(() => {}) });
      if (item.fingerprint && item.fingerprint !== digest.sha256) throw new Error("本地文件已改变，不能续传旧分段");
      if (digest.size_bytes !== item.sizeBytes || digest.modified_ms !== item.modifiedMs) throw new Error("本地文件已改变，不能续传旧分段");
      if (!item.fingerprint) await update(item.id, { fingerprint: digest.sha256 });
    }
    if (generationRef.current !== generation || tasksRef.current.find((task) => task.id === item.id)?.status !== "preparing") return;
    await update(item.id, { status: "transferring" });
    const created = await startUpload(item.intent, source, item.idempotencyKey);
    const upload = created.upload;
    const uploadId = upload.upload_id || upload.id;
    const currentStatus = tasksRef.current.find((task) => task.id === item.id)?.status;
    if (generationRef.current !== generation || currentStatus === "cancelled") {
      await cancelUploadSession(uploadId).catch(() => {});
      return;
    }
    await update(item.id, { uploadId, fileId: created.file?.id || item.fileId });
    if (currentStatus === "paused") return;
    if (upload.transport !== "completed") {
      if (native) {
        if (upload.transport === "post") {
          await invoke("transfer_send_post", { taskId: item.id, sourceId: item.sourceId, url: upload.url, fields: upload.fields,
            onProgress: progressChannel((bytes) => reportProgress(item.id, bytes, item.sizeBytes)) });
        } else if (upload.transport === "multipart") {
          const count = Number(upload.part_count) || Math.ceil(item.sizeBytes / Number(upload.part_size));
          const partSize = Number(upload.part_size);
          const prior = await listVerifiedUploadParts(uploadId);
          const verified = new Map((prior.items || []).map((part) => [part.part_number, part]));
          const inFlight = new Map();
          let confirmed = 0;
          let cursor = 0;
          const worker = async () => {
            while (cursor < count) {
              const index = cursor++;
              const number = index + 1;
              const offset = index * partSize;
              const length = Math.min(partSize, item.sizeBytes - offset);
              const sha256 = await invoke("transfer_hash_part", { sourceId: item.sourceId, offset, length });
              const old = verified.get(number);
              if (old?.sha256 === sha256 && old?.size_bytes === length) {
                confirmed += length;
                reportProgress(item.id, confirmed + [...inFlight.values()].reduce((a, b) => a + b, 0), item.sizeBytes);
                continue;
              }
              for (let attempt = 0; attempt < 4; attempt += 1) {
                if (generationRef.current !== generation || tasksRef.current.find((task) => task.id === item.id)?.status !== "transferring") throw new Error("传输已暂停");
                const signed = await getUploadPartUrl(uploadId, number, { sha256 });
                try {
                  await invoke("transfer_send_part", { taskId: item.id, sourceId: item.sourceId, url: signed.url,
                    headers: signed.headers, offset, length, checksum: sha256,
                    onProgress: progressChannel((bytes) => {
                      inFlight.set(number, bytes);
                      reportProgress(item.id, confirmed + [...inFlight.values()].reduce((a, b) => a + b, 0), item.sizeBytes);
                    }) });
                  break;
                } catch (error) {
                  inFlight.delete(number);
                  if (attempt === 3 || String(error).includes("暂停")) throw error;
                  await sleep((attempt + 1) * 1000);
                }
              }
              inFlight.delete(number);
              confirmed += length;
              reportProgress(item.id, confirmed + [...inFlight.values()].reduce((a, b) => a + b, 0), item.sizeBytes);
            }
          };
          try { await Promise.all([worker(), worker()]); }
          catch (error) { await invoke("transfer_abort", { taskId: item.id }); throw error; }
        } else throw new Error(`不支持的上传协议：${upload.transport}`);
      } else {
        const file = browserFilesRef.current.get(item.id);
        if (!file) throw new Error("请重新从原页面选择本地文件");
        await uploadToPresignedUrl(upload, file, (fraction) => reportProgress(item.id, item.sizeBytes * fraction, item.sizeBytes));
      }
      if (native) {
        const finalDigest = await invoke("transfer_hash_source", { sourceId: item.sourceId, onProgress: progressChannel(() => {}) });
        if (finalDigest.sha256 !== tasksRef.current.find((task) => task.id === item.id)?.fingerprint) throw new Error("本地文件在上传期间发生变化，不能发布");
      }
      if (tasksRef.current.find((task) => task.id === item.id)?.status !== "transferring") return;
      await completeUploadSession(uploadId);
    }
    if (generationRef.current !== generation || tasksRef.current.find((task) => task.id === item.id)?.status !== "transferring") return;
    await update(item.id, { status: "scanning", transferredBytes: item.sizeBytes, speedBps: 0 });
    notify.info("上传完成，正在安全检查", { id: item.id });
  }, [reportProgress, update]);

  const runDownload = useCallback(async (item, generation) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (generationRef.current !== generation || tasksRef.current.find((task) => task.id === item.id)?.status !== "transferring") return;
      try {
        const descriptor = await describeDownload(item.intent, item.versionId);
        if (descriptor.version_id !== item.versionId || descriptor.sha256 !== item.sha256 || descriptor.size_bytes !== item.sizeBytes) {
          throw new Error("服务端版本信息已变化，不能续传");
        }
        await invoke("transfer_download_range", { taskId: item.id, destinationId: item.destinationId, url: descriptor.url,
          expectedSize: item.sizeBytes, expectedEtag: item.etag || "",
          onProgress: progressChannel((bytes, total) => reportProgress(item.id, bytes, total)) });
        if (generationRef.current !== generation || tasksRef.current.find((task) => task.id === item.id)?.status !== "transferring") return;
        await invoke("transfer_finalize_download", { taskId: item.id, destinationId: item.destinationId,
          expectedSize: item.sizeBytes, expectedSha256: item.sha256 });
        if (generationRef.current !== generation) return;
        await invoke("transfer_forget", { id: item.destinationId });
        await update(item.id, { status: "completed", transferredBytes: item.sizeBytes, speedBps: 0 });
        notify.success("下载完成且校验通过", { id: item.id, description: item.filename });
        return;
      } catch (error) {
        if (String(error).includes("暂停") || error?.status === 403 || error?.status === 404 || String(error).includes("版本信息已变化") || String(error).includes("SHA-256")) throw error;
        if (attempt === 4) throw error;
        await sleep(Math.min(16000, 1000 * 2 ** attempt));
      }
    }
  }, [reportProgress, update]);

  useEffect(() => {
    if (!hydrated || !accountRef.current) return;
    const generation = generationRef.current;
    for (const task of tasks) {
      if (task.status === "scanning" && !activeRef.current.has(task.id) && task.uploadId) {
        activeRef.current.add(task.id);
        void monitorScan(task.id, task.uploadId, generation).finally(() => {
          activeRef.current.delete(task.id);
          if (generationRef.current === generation) setTasks([...tasksRef.current]);
        });
      }
    }
    const slots = 2 - [...activeRef.current].filter((id) => tasksRef.current.find((task) => task.id === id)?.status !== "scanning").length;
    if (slots <= 0) return;
    for (const task of tasks.filter((item) => item.status === "queued").slice(0, slots)) {
      if (activeRef.current.has(task.id)) continue;
      activeRef.current.add(task.id);
      void (async () => {
        try {
          if (native) await invoke("transfer_reset_abort", { taskId: task.id });
          await update(task.id, { status: task.direction === "upload" ? "preparing" : "transferring", error: null });
          if (task.direction === "upload") await runUpload(task, generation);
          else await runDownload(task, generation);
        } catch (error) {
          if (generationRef.current !== generation) return;
          const current = tasksRef.current.find((item) => item.id === task.id);
          if (current?.status === "paused" || current?.status === "cancelled") return;
          let expired = error?.code === "upload_session_expired" || error?.code === "upload_expired";
          if (!expired && error?.code === "upload_not_pending" && current?.uploadId) {
            try { expired = (await getUploadSessionStatus(current.uploadId)).phase === "expired"; } catch { /* retain original failure */ }
          }
          if (generationRef.current !== generation) return;
          if (expired) clearUploadResume(current?.idempotencyKey);
          const needsFile = task.direction === "upload" && (String(error).includes("本地文件已改变") || String(error).includes("无法读取本地文件") || String(error).includes("传输文件已失效"));
          await update(task.id, { status: expired ? "expired" : needsFile ? "needs_file" : "failed", error: error?.message || String(error), speedBps: 0 });
          notify.error(task.direction === "upload" ? "文件上传失败" : "文件下载失败", { id: task.id, description: error?.message || String(error) });
        } finally {
          if (native) await invoke("transfer_finish_task", { taskId: task.id }).catch(() => {});
          activeRef.current.delete(task.id);
          if (generationRef.current === generation) setTasks([...tasksRef.current]);
        }
      })();
    }
  }, [hydrated, tasks, monitorScan, runUpload, runDownload, update]);

  const pause = useCallback(async (id) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task || !["queued", "preparing", "transferring"].includes(task.status)) return;
    await update(id, { status: "paused", speedBps: 0 });
    if (native) await invoke("transfer_abort", { taskId: id });
    notify.info("传输已暂停；上传会话有效期仍在倒计时", { id });
  }, [update]);

  const resume = useCallback(async (id) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task || !["paused", "failed"].includes(task.status)) return;
    await update(id, { status: "queued", error: null });
    notify.loading("正在继续传输…", { id });
  }, [update]);

  const restart = useCallback(async (id) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task || task.direction !== "upload" || task.status !== "expired") return;
    clearUploadResume(task.idempotencyKey);
    await update(id, { status: "queued", idempotencyKey: newId(), uploadId: null, fileId: null,
      transferredBytes: 0, speedBps: 0, error: null });
    notify.loading("正在重新开始上传…", { id });
  }, [update]);

  const reselectSource = useCallback(async (id, file) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task || task.direction !== "upload" || task.status !== "needs_file") return;
    try {
      const picked = native ? (await invoke("transfer_pick_files", { multiple: false }))[0]
        : file && { id: newId(), filename: file.name, size_bytes: file.size, modified_ms: file.lastModified, content_type: file.type };
      if (!picked) return;
      if (picked.filename !== task.filename || picked.size_bytes !== task.sizeBytes) {
        if (native) await invoke("transfer_forget", { id: picked.id });
        throw new Error("请选择原始文件，文件名和大小必须一致");
      }
      if (native && task.fingerprint) {
        const digest = await invoke("transfer_hash_source", { sourceId: picked.id, onProgress: progressChannel(() => {}) });
        if (digest.sha256 !== task.fingerprint) {
          await invoke("transfer_forget", { id: picked.id });
          throw new Error("所选文件内容与原上传任务不一致");
        }
      } else if (!native && picked.modified_ms !== task.modifiedMs) {
        throw new Error("所选文件修改时间与原上传任务不一致");
      }
      if (native && task.sourceId) await invoke("transfer_forget", { id: task.sourceId });
      if (!native) browserFilesRef.current.set(id, file);
      await update(id, { sourceId: picked.id, modifiedMs: picked.modified_ms,
        contentType: picked.content_type || task.contentType, status: "queued", error: null });
      notify.loading("已重新选择原文件，继续上传中…", { id });
    } catch (error) {
      notify.error("无法继续上传", { id, description: error?.message || String(error) });
    }
  }, [update]);

  const cancel = useCallback(async (id) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task || ["completed", "cancelled", "scanning", "rejected"].includes(task.status)) return;
    await update(id, { status: "cancelled", speedBps: 0 });
    if (native) await invoke("transfer_abort", { taskId: id });
    try {
      if (task.direction === "upload" && task.uploadId && task.status !== "expired") {
        const result = await cancelUploadSession(task.uploadId);
        if (result.status === "completed") {
          await update(id, { status: "scanning" });
          notify.info("上传已提交，无法再取消；正在安全检查", { id });
          return;
        }
      }
      if (native && task.direction === "download" && task.destinationId) {
        for (let attempt = 0; activeRef.current.has(id) && attempt < 50; attempt += 1) await sleep(100);
        if (activeRef.current.has(id)) throw new Error("下载请求尚未停止，临时文件会保留待下次清理");
        await invoke("transfer_delete_partial", { destinationId: task.destinationId });
      }
      if (native && (task.sourceId || task.destinationId)) await invoke("transfer_forget", { id: task.sourceId || task.destinationId });
      if (task.direction === "upload") clearUploadResume(task.idempotencyKey);
      notify.info("传输已取消", { id });
    } catch (error) {
      await update(id, { status: "failed", error: `取消尚未同步到服务器：${error?.message || String(error)}` });
      notify.error("取消传输失败", { id, description: error?.message || String(error) });
    }
  }, [update]);

  const clearFinished = useCallback(async () => {
    const finished = tasksRef.current.filter((task) => ["completed", "cancelled", "rejected"].includes(task.status));
    if (native) await Promise.all(finished.flatMap((task) => [task.sourceId, task.destinationId]
      .filter(Boolean).map((id) => invoke("transfer_forget", { id }).catch(() => {}))));
    for (const task of finished) browserFilesRef.current.delete(task.id);
    await checkpoint(tasksRef.current.filter((task) => !["completed", "cancelled", "rejected"].includes(task.status)));
    notify.success("已清理完成的传输记录");
  }, [checkpoint]);

  const value = useMemo(() => ({ tasks, enqueueUpload, enqueueDownload, pause, resume, restart, reselectSource, cancel, clearFinished,
    activeCount: tasks.filter((task) => activeStatuses.has(task.status)).length }),
  [tasks, enqueueUpload, enqueueDownload, pause, resume, restart, reselectSource, cancel, clearFinished]);
  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
}

export function useTransferCenter() {
  const value = useContext(TransferContext);
  if (!value) throw new Error("TransferProvider is missing");
  return value;
}
