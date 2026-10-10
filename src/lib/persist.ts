// Zustand persistence backed by tauri-plugin-store (a JSON file in AppData),
// falling back to localStorage outside Tauri.
import { load, type Store } from "@tauri-apps/plugin-store";
import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { isTauri } from "./http";

let storePromise: Promise<Store> | null = null;
const getStore = () => (storePromise ??= load("d4c-state.json", { autoSave: 400, defaults: {} }));

const tauriStorage: StateStorage = {
  getItem: async (name) => {
    const v = await (await getStore()).get<string>(name);
    return v ?? null;
  },
  setItem: async (name, value) => {
    await (await getStore()).set(name, value);
  },
  removeItem: async (name) => {
    await (await getStore()).delete(name);
  },
};

const localStorageSafe: StateStorage = {
  getItem: (n) => {
    try {
      return localStorage.getItem(n);
    } catch {
      return null;
    }
  },
  setItem: (n, v) => {
    try {
      localStorage.setItem(n, v);
    } catch {
      /* quota / private mode */
    }
  },
  removeItem: (n) => {
    try {
      localStorage.removeItem(n);
    } catch {
      /* ignore */
    }
  },
};

export const persistStorage = createJSONStorage(() => (isTauri ? tauriStorage : localStorageSafe));
