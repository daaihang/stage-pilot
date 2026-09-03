import { request } from "@/lib/auth";

const base = (workspaceId, suffix = "") => `/v1/workspaces/${workspaceId}/files${suffix}`;
export const listFiles = (workspaceId, productionId = "workspace") => request(`${base(workspaceId)}?production_id=${encodeURIComponent(productionId)}`);
export const createFileUpload = (workspaceId, payload) => request(base(workspaceId), { method: "POST", body: JSON.stringify(payload) });
export const completeFileUpload = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/complete`), { method: "POST" });
export const downloadFile = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}/download`));
export const deleteFile = (workspaceId, fileId) => request(base(workspaceId, `/${fileId}`), { method: "DELETE" });

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
