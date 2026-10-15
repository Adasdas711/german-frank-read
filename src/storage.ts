import type { Book } from "./core";
export type Progress = {
  book: string;
  at: string;
  percent: number;
  mode: string;
  updatedAt: string;
};
export type SavedWord = {
  key: string;
  book: string;
  at: string;
  lemma: string;
  ru: string;
  ipa: string;
  context: string;
  form: string;
  savedAt: string;
  inAnki: boolean;
};
export type Settings = {
  font: string;
  fontSize: number;
  theme: string;
  showClean: boolean;
  voice: string;
  rate: number;
  current?: string;
};
export const defaults: Settings = {
  font: "serif",
  fontSize: 19,
  theme: "system",
  showClean: true,
  voice: "espeak",
  rate: 1,
};
let dbPromise: Promise<IDBDatabase>;
export function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("franka-v2", 1);
    r.onupgradeneeded = () => {
      for (const name of ["books", "progress", "words", "settings", "drafts"])
        r.result.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(Error("Закройте другую вкладку приложения и попробуйте снова."));
  }));
}
export async function all<T>(store: string): Promise<T[]> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function get<T>(
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function put(store: string, key: IDBValidKey, value: any) {
  const d = await db();
  return new Promise<void>((res, rej) => {
    const t = d.transaction(store, "readwrite");
    t.objectStore(store).put(value, key);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export async function remove(store: string, key: IDBValidKey) {
  const d = await db();
  return new Promise<void>((res, rej) => {
    const t = d.transaction(store, "readwrite");
    t.objectStore(store).delete(key);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
export async function clearAll() {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const t = d.transaction(
      ["books", "progress", "words", "settings"],
      "readwrite",
    );
    for (const s of ["books", "progress", "words", "settings"])
      t.objectStore(s).clear();
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
export function checkedSettings(s: any): Settings {
  return {
    font: ["serif", "sans", "system"].includes(s?.font)
      ? s.font
      : defaults.font,
    fontSize: Number.isFinite(s?.fontSize)
      ? Math.max(14, Math.min(30, s.fontSize))
      : 19,
    theme: ["light", "dark", "system"].includes(s?.theme) ? s.theme : "system",
    showClean: typeof s?.showClean === "boolean" ? s.showClean : true,
    voice: ["espeak", "system"].includes(s?.voice) ? s.voice : "espeak",
    rate: Number.isFinite(s?.rate) ? Math.max(0.5, Math.min(1.5, s.rate)) : 1,
    ...(typeof s?.current === "string" ? { current: s.current } : {}),
  };
}
export async function backup(includeBooks = false) {
  return {
    backup: "franka",
    version: 2,
    exportedAt: new Date().toISOString(),
    progress: await all("progress"),
    words: await all("words"),
    settings: await get("settings", "app"),
  };
}
