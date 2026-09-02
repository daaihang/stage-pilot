import { invoke } from "@tauri-apps/api/core";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:18080";
const REFRESH_KEY = "auth.refresh_token";
let accessToken = null;

const secureStore = {
  async get() {
    if (window.__TAURI_INTERNALS__) return invoke("secure_get", { key: REFRESH_KEY });
    return window.localStorage.getItem(`stagepilot:${REFRESH_KEY}`);
  },
  async set(value) {
    if (window.__TAURI_INTERNALS__) return invoke("secure_set", { key: REFRESH_KEY, value });
    window.localStorage.setItem(`stagepilot:${REFRESH_KEY}`, value);
  },
  async clear() {
    if (window.__TAURI_INTERNALS__) return invoke("secure_delete", { key: REFRESH_KEY }).catch(() => {});
    window.localStorage.removeItem(`stagepilot:${REFRESH_KEY}`);
  },
};

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || "请求失败");
  return body;
}

export async function login(email, password) {
  const result = await request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  accessToken = result.access_token;
  await secureStore.set(result.refresh_token);
  return result.user;
}

export async function register(email, password) {
  const result = await request("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
  accessToken = result.access_token;
  await secureStore.set(result.refresh_token);
  return { user: result.user, debugToken: result.debug_token };
}

export async function restoreSession() {
  const refreshToken = await secureStore.get();
  if (!refreshToken) return null;
  try {
    const result = await request("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
    accessToken = result.access_token;
    await secureStore.set(result.refresh_token);
    return result.user;
  } catch {
    accessToken = null;
    await secureStore.clear();
    return null;
  }
}

export async function logout() {
  try { if (accessToken) await request("/auth/logout", { method: "POST" }); } finally { accessToken = null; await secureStore.clear(); }
}

export async function getMe() { return request("/me"); }
export async function updateMe(patch) { return request("/me", { method: "PATCH", body: JSON.stringify(patch) }); }
export async function getPreferences() { return request("/me/preferences"); }
export async function updatePreferences(patch) { return request("/me/preferences", { method: "PATCH", body: JSON.stringify(patch) }); }
export async function verifyEmail(token) { return request("/auth/email/verify", { method: "POST", body: JSON.stringify({ token }) }); }
export { API_BASE };
