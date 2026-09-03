import { invoke, isTauri } from "@tauri-apps/api/core";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:18080";
const REFRESH_KEY = "auth.refresh_token";
const isTauriRuntime = isTauri();
let accessToken = null;
let refreshPromise = null;
const invalidationListeners = new Set();

const secureStore = {
  async get() {
    if (isTauriRuntime) return invoke("secure_get", { key: REFRESH_KEY });
    return window.localStorage.getItem(`stagepilot:${REFRESH_KEY}`);
  },
  async set(value) {
    if (isTauriRuntime) return invoke("secure_set", { key: REFRESH_KEY, value });
    window.localStorage.setItem(`stagepilot:${REFRESH_KEY}`, value);
  },
  async clear() {
    if (isTauriRuntime) return invoke("secure_delete", { key: REFRESH_KEY }).catch(() => {});
    window.localStorage.removeItem(`stagepilot:${REFRESH_KEY}`);
  },
};

function requestError(response, body) {
  const error = new Error(body.error?.message || "请求失败");
  error.status = response.status;
  error.code = body.error?.code;
  return error;
}

async function rawRequest(path, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw requestError(response, body);
  return body;
}

async function clearSession(reason) {
  accessToken = null;
  await secureStore.clear();
  for (const listener of invalidationListeners) listener({ reason });
}

export function onSessionInvalidated(listener) {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function getAccessToken() { return accessToken; }

export function adoptAccessToken(token) {
  if (!token) throw new Error("主窗口未提供有效的账号会话");
  accessToken = token;
}

async function refreshSession({ retryStoredToken = true } = {}) {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await secureStore.get();
      if (!refreshToken) throw new Error("没有可恢复的会话");
      try {
        const result = await rawRequest("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
        accessToken = result.access_token;
        await secureStore.set(result.refresh_token);
        return result.user;
      } catch (error) {
        const newerToken = retryStoredToken ? await secureStore.get() : null;
        if (newerToken && newerToken !== refreshToken) {
          try {
            const result = await rawRequest("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: newerToken }) });
            accessToken = result.access_token;
            await secureStore.set(result.refresh_token);
            return result.user;
          } catch (newerError) {
            await clearSession("refresh_failed");
            throw newerError;
          }
        }
        await clearSession("refresh_failed");
        throw error;
      }
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(path, options = {}) {
  try {
    return await rawRequest(path, options);
  } catch (error) {
    const canRecover = error?.status === 401 && accessToken && !path.startsWith("/auth/");
    if (!canRecover) throw error;
    await refreshSession();
    return rawRequest(path, options);
  }
}

export async function login(email, password) {
  const result = await rawRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  accessToken = result.access_token;
  await secureStore.set(result.refresh_token);
  return result.user;
}

export async function register(email, password) {
  const result = await rawRequest("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
  accessToken = result.access_token;
  await secureStore.set(result.refresh_token);
  return { user: result.user, debugToken: result.debug_token };
}

export async function restoreSession() {
  const refreshToken = await secureStore.get();
  if (!refreshToken) return null;
  try {
    return await refreshSession();
  } catch {
    return null;
  }
}

export async function logout() {
  const refreshToken = await secureStore.get();
  let remotelyRevoked = false;
  try {
    if (refreshToken) {
      await rawRequest("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
      remotelyRevoked = true;
    }
  } catch {
    // Local credential removal still prevents this device from restoring the session.
  } finally {
    await clearSession("logout");
  }
  return { remotelyRevoked };
}

export async function getMe() { return request("/me"); }
export async function updateMe(patch) { return request("/me", { method: "PATCH", body: JSON.stringify(patch) }); }
export async function getPreferences() { return request("/me/preferences"); }
export async function updatePreferences(patch) { return request("/me/preferences", { method: "PATCH", body: JSON.stringify(patch) }); }
export async function verifyEmail(token) { return rawRequest("/auth/email/verify", { method: "POST", body: JSON.stringify({ token }) }); }
export async function forgotPassword(email) { return rawRequest("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) }); }
export async function resetPassword(token, password) { return rawRequest("/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) }); }
export { API_BASE, request };
