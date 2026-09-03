import { isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

export const isTauriRuntime = isTauri();

const browserStore = {
  async init() {},
  async get(key) {
    try {
      const value = window.localStorage.getItem(`stagepilot:${key}`);
      return value === null ? undefined : JSON.parse(value);
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    try { window.localStorage.setItem(`stagepilot:${key}`, JSON.stringify(value)); } catch {}
  },
};

export const appStore = isTauriRuntime ? new LazyStore("stagepilot.json", { autoSave: 150 }) : browserStore;
