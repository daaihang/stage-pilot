import { request } from "@/lib/auth";

const base = (workspaceId, suffix = "") => `/v1/workspaces/${workspaceId}/files${suffix}`;
const withPage = (url, page = {}) => {
  const params = new URLSearchParams();
  if (page.limit) params.set("limit", String(page.limit));
  if (page.cursor) params.set("cursor", page.cursor);
  const query = params.toString();
  return query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
};
const fallbackKey = () => `${Date.now()}-${Math.random()}-${Math.random()}`;
function uploadKey(scope, payload) {
  const identity = [payload.filename || "", payload.size_bytes || 0, payload.last_modified || 0].join(":");
  const storageKey = `stagepilot.upload.resume.${scope}.${identity}`;
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() || fallbackKey();
    localStorage.setItem(storageKey, created);
    return created;
  } catch { return globalThis.crypto?.randomUUID?.() || fallbackKey(); }
}
function clearUploadResume(key) {
  if (!key) return;
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = localStorage.key(index);
      if (storageKey?.startsWith("stagepilot.upload.resume.") && localStorage.getItem(storageKey) === key) localStorage.removeItem(storageKey);
    }
  } catch { /* keep the server session safe for a later retry */ }
}
async function requestIdempotently(path, options, scope, payload, idempotencyKey) {
  const key = idempotencyKey || uploadKey(scope, payload);
  const result = await request(path, { ...options, headers: { ...(options.headers || {}), "Idempotency-Key": key } });
  return { ...result, _resumeKey: key };
}
export const listFiles = (workspaceId, productionId = "workspace", page = {}) => request(withPage(`${base(workspaceId)}?production_id=${encodeURIComponent(productionId)}`, page));
export const listDeletedFiles = (workspaceId, productionId = "workspace", page = {}) => request(withPage(`${base(workspaceId, "/trash")}?production_id=${encodeURIComponent(productionId)}`, page));
export const restoreFile = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/restore`), { method: "POST" });
export const getMyWorkspaceStorage = () => request("/v1/me/workspace-storage");
export const createFileUpload = (workspaceId, payload, idempotencyKey) => requestIdempotently(base(workspaceId), { method: "POST", body: JSON.stringify(payload) }, `workspace:${workspaceId}:${payload.production_id || "workspace"}`, payload, idempotencyKey);
export const completeFileUpload = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/complete`), { method: "POST" });
export const downloadFile = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/download`));
export const deleteFile = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}`), { method: "DELETE" });

const programAttachments = (workspaceId, programId) => `/v1/workspaces/${workspaceId}/programs/${programId}/attachments`;
const productionProgramAttachments = (productionId, programId) => `/v1/productions/${productionId}/programs/${programId}/attachments`;
const attachmentBase = (attachmentId) => `/v1/attachments/${attachmentId}`;
export const listProgramAttachments = (workspaceId, programId, trash = false, page = {}) => request(withPage(`${programAttachments(workspaceId, programId)}${trash ? "?trash=true" : ""}`, page));
export const createProgramAttachment = (workspaceId, programId, payload, idempotencyKey) => requestIdempotently(programAttachments(workspaceId, programId), { method: "POST", body: JSON.stringify(payload) }, `program:${workspaceId}:${programId}`, payload, idempotencyKey);
export const listProductionProgramAttachments = (productionId, programId, trash = false, page = {}) => request(withPage(`${productionProgramAttachments(productionId, programId)}${trash ? "?trash=true" : ""}`, page));
export const createProductionProgramAttachment = (productionId, programId, payload, idempotencyKey) => requestIdempotently(productionProgramAttachments(productionId, programId), { method: "POST", body: JSON.stringify(payload) }, `production-program:${productionId}:${programId}`, payload, idempotencyKey);
export const copyProductionProgramAttachment = (productionId, programId, payload) => requestIdempotently(`${productionProgramAttachments(productionId, programId)}/copy`, { method: "POST", body: JSON.stringify(payload) }, `production-copy:${productionId}:${programId}:${payload.attachment_id}:${payload.version_id || "current"}`, payload);
export const listAttachmentVersions = (attachmentId, page = {}) => request(withPage(`${attachmentBase(attachmentId)}/versions`, page));
export const startAttachmentVersion = (attachmentId, payload, idempotencyKey) => requestIdempotently(`${attachmentBase(attachmentId)}/versions`, { method: "POST", body: JSON.stringify(payload) }, `attachment-version:${attachmentId}`, payload, idempotencyKey);
export const completeUploadSession = (uploadId) => request(`/v1/file-upload-sessions/${uploadId}/complete`, { method: "POST" });
export const cancelUploadSession = (uploadId) => request(`/v1/file-upload-sessions/${uploadId}`, { method: "DELETE" });
export const getUploadPartUrl = (uploadId, partNumber, payload) => request(`/v1/file-upload-sessions/${uploadId}/parts/${partNumber}/url`, { method: "POST", body: JSON.stringify(payload) });
export const listVerifiedUploadParts = (uploadId) => request(`/v1/file-upload-sessions/${uploadId}/parts`);
export { clearUploadResume };
export const getUploadSessionStatus = (uploadId) => request(`/v1/file-upload-sessions/${uploadId}`);
export async function waitForUploadSession(uploadId, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let status = { status: "processing" };
  while (Date.now() < deadline) {
    status = await getUploadSessionStatus(uploadId);
    if (status.status !== "processing") return status;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return status;
}
export const downloadAttachment = (attachmentId, versionId) => request(`${attachmentBase(attachmentId)}/download${versionId ? `?version_id=${encodeURIComponent(versionId)}` : ""}`);
export const detachAttachment = (attachmentId) => request(attachmentBase(attachmentId), { method: "DELETE" });
export const restoreAttachment = (attachmentId) => request(`${attachmentBase(attachmentId)}/restore`, { method: "POST" });
export const listFileVersions = (workspaceId, fileId, page = {}) => request(withPage(base(workspaceId, `/${fileId}/versions`), page));
export const startFileVersion = (workspaceId, fileId, payload, idempotencyKey) => requestIdempotently(base(workspaceId, `/${fileId}/versions`), { method: "POST", body: JSON.stringify(payload) }, `file-version:${workspaceId}:${fileId}`, payload, idempotencyKey);
export const downloadFileVersion = (workspaceId, fileId, versionId) => request(base(workspaceId, `/${fileId}/versions/${versionId}/download`));

function putToSignedUrl(url, file, headers = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`对象存储返回 HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("无法连接对象存储"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(file);
  });
}

function postToSignedUrl(upload, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", upload.url);
    const form = new FormData();
    Object.entries(upload.fields || {}).forEach(([name, value]) => form.append(name, value));
    form.append("file", file, file.name);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`对象存储返回 HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("无法连接对象存储"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(form);
  });
}

async function sha256Base64(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export async function uploadToPresignedUrl(uploadOrUrl, file, onProgress) {
  const upload = typeof uploadOrUrl === "string" ? { transport: "legacy_put", url: uploadOrUrl } : uploadOrUrl;
  if (upload.transport === "post") return postToSignedUrl(upload, file, onProgress);
  if (upload.transport === "multipart") {
    const partSize = Number(upload.part_size) || (64 * 1024 * 1024);
    const count = Math.ceil(file.size / partSize);
    let sentBefore = 0;
    const priorParts = await listVerifiedUploadParts(upload.upload_id || upload.id);
    const verified = new Map((priorParts.items || []).map((part) => [part.part_number, part]));
    for (let index = 0; index < count; index += 1) {
      const partNumber = index + 1;
      const start = index * partSize;
      const chunk = file.slice(start, Math.min(file.size, start + partSize));
      const sha256 = await sha256Base64(chunk);
      const prior = verified.get(partNumber);
      if (prior && prior.size_bytes === chunk.size && prior.sha256 === sha256) {
        sentBefore += chunk.size;
        onProgress?.(sentBefore / file.size);
        continue;
      }
      const signed = await getUploadPartUrl(upload.upload_id || upload.id, partNumber, { sha256 });
      await putToSignedUrl(signed.url, chunk, signed.headers, (fraction) => {
        onProgress?.((sentBefore + chunk.size * fraction) / file.size);
      });
      sentBefore += chunk.size;
      onProgress?.(sentBefore / file.size);
    }
    return;
  }
  return putToSignedUrl(upload.url || uploadOrUrl, file, { "Content-Type": file.type || "application/octet-stream" }, onProgress);
}
