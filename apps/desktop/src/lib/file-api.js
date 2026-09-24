import { request } from "@/lib/auth";

const base = (workspaceId, suffix = "") => `/v1/workspaces/${workspaceId}/files${suffix}`;
export const listFiles = (workspaceId, productionId = "workspace") => request(`${base(workspaceId)}?production_id=${encodeURIComponent(productionId)}`);
export const createFileUpload = (workspaceId, payload) => request(base(workspaceId), { method: "POST", body: JSON.stringify(payload) });
export const completeFileUpload = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/complete`), { method: "POST" });
export const downloadFile = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/download`));
export const deleteFile = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}`), { method: "DELETE" });

const programAttachments = (workspaceId, programId) => `/v1/workspaces/${workspaceId}/programs/${programId}/attachments`;
const productionProgramAttachments = (productionId, programId) => `/v1/productions/${productionId}/programs/${programId}/attachments`;
const attachmentBase = (attachmentId) => `/v1/attachments/${attachmentId}`;
export const listProgramAttachments = (workspaceId, programId) => request(programAttachments(workspaceId, programId));
export const createProgramAttachment = (workspaceId, programId, payload) => request(programAttachments(workspaceId, programId), { method: "POST", body: JSON.stringify(payload) });
export const listProductionProgramAttachments = (productionId, programId) => request(productionProgramAttachments(productionId, programId));
export const createProductionProgramAttachment = (productionId, programId, payload) => request(productionProgramAttachments(productionId, programId), { method: "POST", body: JSON.stringify(payload) });
export const copyProductionProgramAttachment = (productionId, programId, payload) => request(`${productionProgramAttachments(productionId, programId)}/copy`, { method: "POST", body: JSON.stringify(payload) });
export const listAttachmentVersions = (attachmentId) => request(`${attachmentBase(attachmentId)}/versions`);
export const startAttachmentVersion = (attachmentId, payload) => request(`${attachmentBase(attachmentId)}/versions`, { method: "POST", body: JSON.stringify(payload) });
export const completeUploadSession = (uploadId) => request(`/v1/file-upload-sessions/${uploadId}/complete`, { method: "POST" });
export const downloadAttachment = (attachmentId, versionId) => request(`${attachmentBase(attachmentId)}/download${versionId ? `?version_id=${encodeURIComponent(versionId)}` : ""}`);
export const detachAttachment = (attachmentId) => request(attachmentBase(attachmentId), { method: "DELETE" });
export const listFileVersions = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/versions`));
export const startFileVersion = (workspaceId, fileId, payload) => request(base(workspaceId, `/${fileId}/versions`), { method: "POST", body: JSON.stringify(payload) });
export const downloadFileVersion = (workspaceId, fileId, versionId) => request(base(workspaceId, `/${fileId}/versions/${versionId}/download`));

export function uploadToPresignedUrl(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`对象存储返回 HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("无法连接对象存储"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(file);
  });
}
