import type { Book } from "./core";
import type { Language } from "./i18n";
import { checkedCollections, moveBookToCollection } from "./collections";
export type Progress = {
  book: string;
  at: string;
  offset?: number;
  percent: number;
  mode: string;
  updatedAt: string;
  bookmarks?: { at: string; offset: number; createdAt: string }[];
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
  contextTranslation?: string;
  partOfSpeech?: string;
};
export type Settings = {
  font: string;
  fontSize: number;
  theme: string;
  showClean: boolean;
  readingFlow: "pages";
  bookStyleVersion: 1;
  language: Language;
  readingDefaultsVersion: 1;
  voice: string;
  rate: number;
  current?: string;
  designVersion: 2;
  readingTheme: string;
  followSystem: boolean;
  pageTurn: "slide" | "curl" | "fade" | "scroll";
  defaultMode: "frank" | "clean" | "parallel";
  sidebarCollapsed: boolean;
  deck: string;
  markExported: boolean;
  bold: boolean;
  hintColor: string;
  hintSize: number;
  hintItalic: boolean;
  customLayout: boolean;
  lineSpacing: number;
  letterSpacing: number;
  wordSpacing: number;
  margins: number;
  columns: string;
  justify: boolean;
  recentSearches: string[];
};
export const defaults: Settings = {
  font: "Literata",
  fontSize: 19,
  theme: "dark",
  showClean: false,
  readingFlow: "pages",
  bookStyleVersion: 1,
  language: "en",
  readingDefaultsVersion: 1,
  voice: "espeak",
  rate: 1,
  designVersion: 2,
  readingTheme: "night",
  followSystem: false,
  pageTurn: "slide",
  defaultMode: "frank",
  sidebarCollapsed: false,
  deck: "German with Frank",
  markExported: true,
  bold: false,
  hintColor: "",
  hintSize: 0.86,
  hintItalic: false,
  customLayout: false,
  lineSpacing: 1.65,
  letterSpacing: 0,
  wordSpacing: 0,
  margins: 6,
  columns: "auto",
  justify: true,
  recentSearches: [],
};
let dbPromise: Promise<IDBDatabase> | undefined;
export function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () =>
        fail(
          Error(
            "Хранилище браузера не ответило за 10 секунд. Закройте другие вкладки приложения и повторите запуск.",
          ),
        ),
      10000,
    );
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
    let r: IDBOpenDBRequest;
    try {
      r = indexedDB.open("franka-v2", 1);
    } catch (e) {
      fail(e);
      return;
    }
    r.onupgradeneeded = () => {
      for (const name of ["books", "progress", "words", "settings", "drafts"])
        if (!r.result.objectStoreNames.contains(name))
          r.result.createObjectStore(name);
    };
    r.onsuccess = () => {
      if (settled) {
        r.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => fail(r.error || Error("Ошибка хранилища браузера."));
    r.onblocked = () =>
      fail(Error("Закройте другую вкладку приложения и повторите запуск."));
  }).catch((e) => {
    dbPromise = undefined;
    throw e;
  });
  return dbPromise;
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
      ["books", "progress", "words", "settings", "drafts"],
      "readwrite",
    );
    for (const s of ["books", "progress", "words", "settings", "drafts"])
      t.objectStore(s).clear();
    // Keep the empty-library marker and reset preferences atomically. A reload
    // during erasure must never re-install the demonstration books.
    t.objectStore("settings").put(true, "initialized");
    t.objectStore("settings").put(true, "immensee-initialized");
    t.objectStore("settings").put(defaults, "app");
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function deleteBook(bookId: string) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(["books", "progress", "settings"], "readwrite");
    tx.objectStore("books").delete(bookId);
    tx.objectStore("progress").delete(bookId);
    const settings = tx.objectStore("settings"),
      request = settings.get("collections");
    request.onsuccess = () => {
      try {
        settings.put(
          moveBookToCollection(
            checkedCollections(request.result),
            bookId,
            null,
          ),
          "collections",
        );
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export function checkedSettings(s: any): Settings {
  const num = (key: string, min: number, max: number) =>
    Number.isFinite(s?.[key])
      ? Math.max(min, Math.min(max, s[key]))
      : defaults[key];
  const bool = (key: string) =>
    typeof s?.[key] === "boolean" ? s[key] : defaults[key];
  const knownFonts = [
    "Literata",
    "Lora",
    "Merriweather",
    "PT Serif",
    "Source Serif 4",
    "Noto Serif",
    "Inter",
    "PT Sans",
    "Golos Text",
    "System",
  ];
  return {
    ...defaults,
    font: knownFonts.includes(s?.font)
      ? s.font
      : s?.font === "sans"
        ? "Golos Text"
        : s?.font === "system"
          ? "System"
          : "Literata",
    fontSize: num("fontSize", 14, 36),
    theme: ["light", "dark", "system"].includes(s?.theme)
      ? s.theme
      : defaults.theme,
    language: ["en", "ru", "de"].includes(s?.language) ? s.language : "en",
    showClean: typeof s?.showClean === "boolean" ? s.showClean : false,
    readingFlow: "pages",
    bookStyleVersion: 1,
    readingDefaultsVersion: 1,
    designVersion: 2,
    voice: ["espeak", "system"].includes(s?.voice) ? s.voice : "espeak",
    rate: num("rate", 0.5, 1.5),
    readingTheme: [
      "night",
      "dusk",
      "ink",
      "forest",
      "sepia",
      "sand",
      "paper",
      "mist",
    ].includes(s?.readingTheme)
      ? s.readingTheme
      : s?.theme === "light"
        ? "paper"
        : "night",
    pageTurn: ["slide", "curl", "fade", "scroll"].includes(s?.pageTurn)
      ? s.pageTurn
      : s?.readingFlow === "continuous"
        ? "scroll"
        : "slide",
    defaultMode: ["frank", "clean", "parallel"].includes(s?.defaultMode)
      ? s.defaultMode
      : "frank",
    sidebarCollapsed: bool("sidebarCollapsed"),
    followSystem: bool("followSystem"),
    markExported: bool("markExported"),
    deck:
      typeof s?.deck === "string" && s.deck.trim()
        ? s.deck.trim().slice(0, 160)
        : defaults.deck,
    bold: bool("bold"),
    hintItalic: bool("hintItalic"),
    customLayout: bool("customLayout"),
    justify: bool("justify"),
    hintColor: /^#[0-9a-f]{6}$/i.test(s?.hintColor) ? s.hintColor : "",
    hintSize: num("hintSize", 0.65, 1.2),
    lineSpacing: num("lineSpacing", 1.15, 2.3),
    letterSpacing: num("letterSpacing", 0, 0.12),
    wordSpacing: num("wordSpacing", 0, 0.6),
    margins: num("margins", 3, 14),
    columns: ["auto", "1", "2"].includes(s?.columns) ? s.columns : "auto",
    recentSearches: Array.isArray(s?.recentSearches)
      ? s.recentSearches.filter((x) => typeof x === "string").slice(0, 8)
      : [],
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
    collections: (await get("settings", "collections")) || [],
    settings: await get("settings", "app"),
  };
}
