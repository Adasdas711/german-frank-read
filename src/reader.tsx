import { render } from "preact";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from "preact/hooks";
import {
  readBook,
  plain,
  addresses,
  download,
  slug,
  type Book,
  type Chunk,
} from "./core";
import * as store from "./storage";
import type { Settings, Progress, SavedWord } from "./storage";
import { LocaleContext, createTranslator, translateMessage } from "./i18n";
import { Icon, Modal, Toggle, ProgressBar, ContextMenu } from "./ui";
import { PagedReader, type PageEntry } from "./paged-reader";
import { BookText, type WordSelection } from "./book-text";
import { BookCover } from "./book-cover";
import {
  CollectionMenu,
  LevelMenu,
  FolderContextMenu,
  type FolderMenuTarget,
  CollectionStrip,
  CollectionEditor,
  MoveBookDialog,
  bookDrag,
} from "./collection-ui";
import {
  checkedCollections,
  moveCollection,
  moveBookToCollection,
  type BookCollection,
} from "./collections";
import { ThemesPanel } from "./themes-panel";
import {
  exportBackup,
  parseBackup,
  importBackup,
  exportWords,
} from "./transfer";
import { speak, stop, unlockAudio } from "./voice";
import { ensureDemos } from "./demo-library";
import {
  pageFor,
  searchText,
  highlightParts,
  positionKey,
} from "./library-model";
import demos from "./demos.json";
import immensee from "./immensee.json";
import "./style.css";
import "./books.css";
import "./pwa";

const navigation = [
  ["home", "Home", "home"],
  ["library", "Library", "book"],
  ["words", "Words", "words"],
  ["search", "Search", "search"],
];
const filterLabel = (v: string) =>
  ({ all: "All Books", reading: "Reading", finished: "Finished" })[v] || v;
type IndexCache = Record<string, { signature: string; pages: PageEntry[] }>;
function App() {
  const [settings, setSettings] = useState<Settings>(() => ({
    ...store.defaults,
    language: ["en", "ru", "de"].includes(document.documentElement.lang)
      ? (document.documentElement.lang as Settings["language"])
      : "en",
  }));
  const [books, setBooks] = useState<Book[]>([]),
    [progress, setProgress] = useState<Progress[]>([]),
    [saved, setSaved] = useState<SavedWord[]>([]);
  const [ready, setReady] = useState(false),
    [startupError, setStartupError] = useState("");
  const [route, setRoute] = useState(location.hash.slice(2) || "home");
  const searchReturn = useRef(route === "search" ? "home" : route);
  const [folderMenu, setFolderMenu] = useState<FolderMenuTarget | null>(null);
  const [bookMenu, setBookMenu] = useState<{
    book: Book;
    folder: string;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    if (route !== "search") searchReturn.current = route;
    setFolderMenu(null);
    setBookMenu(null);
  }, [route]);
  const [overlay, setOverlay] = useState(""),
    [details, setDetails] = useState<Book | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    action: () => Promise<void>;
  } | null>(null);
  const [pending, setPending] = useState<ReturnType<typeof readBook> | null>(
      null,
    ),
    [fileError, setFileError] = useState(""),
    [fileBusy, setFileBusy] = useState(false);
  const [word, setWord] = useState<WordSelection | null>(null),
    [busy, setBusy] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState("all");
  const [collections, setCollections] = useState<BookCollection[]>([]),
    [collectionFilter, setCollectionFilter] = useState("");
  const [editingCollection, setEditingCollection] =
      useState<BookCollection | null>(null),
    [collectionBook, setCollectionBook] = useState<Book | null>(null);
  const collectionsRef = useRef(collections);
  collectionsRef.current = collections;

  const [wordTab, setWordTab] = useState("all"),
    [wordBook, setWordBook] = useState("all"),
    [selecting, setSelecting] = useState(false),
    [selection, setSelection] = useState<Set<string>>(new Set());
  const wordDrag = useRef<{
    key: string;
    x: number;
    y: number;
    lastY: number;
    add: boolean;
    moved: boolean;
    visited: Set<string>;
  } | null>(null);
  const suppressWordClick = useRef(false);
  useEffect(() => {
    if (!selecting) return;
    const move = (event: PointerEvent) => {
      const drag = wordDrag.current;
      if (!drag || event.pointerType !== "mouse") return;
      if (!(event.buttons & 1)) {
        wordDrag.current = null;
        return;
      }
      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6
      )
        return;
      drag.moved = true;
      suppressWordClick.current = true;
      event.preventDefault();
      const keys = [drag.key];
      for (const row of document.querySelectorAll<HTMLElement>(
        ".word-row[data-word-key]",
      )) {
        const rect = row.getBoundingClientRect();
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          Math.max(drag.lastY, event.clientY) >= rect.top &&
          Math.min(drag.lastY, event.clientY) <= rect.bottom
        )
          keys.push(row.dataset.wordKey!);
      }
      drag.lastY = event.clientY;
      const fresh = keys.filter((key) => !drag.visited.has(key));
      fresh.forEach((key) => drag.visited.add(key));
      if (fresh.length)
        setSelection((previous) => {
          const next = new Set(previous);
          fresh.forEach((key) => (drag.add ? next.add(key) : next.delete(key)));
          return next;
        });
    };
    const end = () => {
      wordDrag.current = null;
    };
    const click = (event: MouseEvent) => {
      if (suppressWordClick.current && event.detail > 0) {
        event.preventDefault();
        event.stopPropagation();
        suppressWordClick.current = false;
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    document.addEventListener("click", click, true);
    window.addEventListener("blur", end);
    return () => {
      end();
      suppressWordClick.current = false;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      document.removeEventListener("click", click, true);
      window.removeEventListener("blur", end);
    };
  }, [selecting]);
  const [searchScope, setSearchScope] = useState("books"),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ankiScope, setAnkiScope] = useState("new"),
    [ankiBook, setAnkiBook] = useState("all"),
    [ankiIpa, setAnkiIpa] = useState(true),
    [ankiContext, setAnkiContext] = useState(true);
  const [indexCache, setIndexCache] = useState<IndexCache>({}),
    [viewportSize, setViewportSize] = useState(
      () => `${innerWidth}x${innerHeight}`,
    );
  const readingShelf = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null),
    backupRef = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const audioRunId = useRef(0);
  const settingsRef = useRef(settings),
    progressRef = useRef(progress),
    booksRef = useRef(books);
  settingsRef.current = settings;
  progressRef.current = progress;
  booksRef.current = books;
  const t = createTranslator(settings.language);
  const parts = route.split("/"),
    page = parts[0] === "texts" ? "library" : parts[0],
    bookId = parts[1],
    at = parts[2] || "1.1",
    mode = parts[3] || settings.defaultMode;
  const decoded = useMemo(
    () => new Map(books.map((b) => [b.manifest.id, readBook(b.bytes)])),
    [books],
  );
  const active = page === "read" ? decoded.get(bookId) : null;
  useEffect(() => {
    if (!ready) return;
    if (page === "settings") {
      setOverlay("settings");
      location.hash = "/home";
    } else if (page === "read" && !decoded.has(bookId)) {
      notify(t("Book not found"), true);
      location.hash = "/home";
    } else if (!["home", "library", "words", "search", "read"].includes(page)) {
      location.hash = "/home";
    }
  }, [ready, page, bookId, decoded]);
  useEffect(() => {
    const node = readingShelf.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.shiftKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      )
        return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 20
          : event.deltaMode === 2
            ? node.clientWidth
            : 1);
      if (
        (delta > 0 &&
          node.scrollLeft < node.scrollWidth - node.clientWidth - 1) ||
        (delta < 0 && node.scrollLeft > 1)
      ) {
        event.preventDefault();
        node.scrollBy({ left: delta });
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [page, ready]);
  const currentProgress = progress.find((p) => p.book === bookId);
  const notify = (text: string, error = false) =>
    setMessage({
      text: translateMessage(settingsRef.current.language, text),
      error,
    });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const saveSettings = useCallback(async (p: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...p };
    settingsRef.current = next;
    setSettings(next);
    await store.put("settings", "app", next);
  }, []);
  const saveCollections = useCallback(async (list: BookCollection[]) => {
    const checked = checkedCollections(list);
    collectionsRef.current = checked;
    setCollections(checked);
    await store.put("settings", "collections", checked);
  }, []);
  useEffect(() => {
    if (collectionFilter && !collections.some((c) => c.id === collectionFilter))
      setCollectionFilter("");
  }, [collections, collectionFilter]);
  const refresh = async () => {
    const [b, p, w, s, c] = await Promise.all([
      store.all<Book>("books"),
      store.all<Progress>("progress"),
      store.all<SavedWord>("words"),
      store.get<Settings>("settings", "app"),
      store.get<BookCollection[]>("settings", "collections"),
    ]);
    setBooks(b);
    setCollections(checkedCollections(c));
    setProgress(p);
    const prefs = store.checkedSettings(s);
    setSettings(prefs);
    settingsRef.current = prefs;
    setSaved(w);
    if (!s || s.designVersion !== 2) await store.put("settings", "app", prefs);
  };
  const commit = useCallback(async (p: Progress) => {
    const previous = progressRef.current.find((x) => x.book === p.book);
    const next = { ...previous, ...p };
    progressRef.current = [
      ...progressRef.current.filter((x) => x.book !== p.book),
      next,
    ];
    setProgress(progressRef.current);
    await store.put("progress", p.book, next);
  }, []);
  useEffect(() => {
    void (async () => {
      await ensureDemos(demos);
      await ensureDemos([immensee], "immensee-initialized");
      await refresh();
      setReady(true);
      window.__frankaBoot?.finish();
      void navigator.storage?.persist?.().catch(() => {});
    })().catch((e) => {
      setStartupError(String(e.message || e));
      window.__frankaBoot?.finish();
    });
    const change = () => {
      setRoute(location.hash.slice(2) || "home");
      setWord(null);
      stop();
      audioRunId.current++;
      setBusy(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = settings.language;
    document.documentElement.dataset.theme = settings.theme;
    document.title = t("German with Frank");
    try {
      localStorage.setItem("franka-language", settings.language);
      localStorage.setItem("franka-theme", settings.theme);
    } catch {}
  }, [settings.language, settings.theme]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), message.error ? 10000 : 4000);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const change = () => setSettings((s) => ({ ...s }));
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setViewportSize(`${innerWidth}x${innerHeight}`),
      );
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  }, []);
  useLayoutEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveSettings({
          sidebarCollapsed: !settingsRef.current.sidebarCollapsed,
        });
      }
      if (
        page === "words" &&
        selecting &&
        !overlay &&
        !confirm &&
        !bookMenu &&
        !folderMenu &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          setSelection(new Set(visibleWords.map((w) => w.key)));
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          requestDeleteWords();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    page,
    selecting,
    selection,
    wordBook,
    overlay,
    confirm,
    saved,
    bookMenu,
    folderMenu,
  ]);
  useEffect(() => {
    if (page !== "search" || !query.trim()) return;
    const id = setTimeout(() => {
      const value = query.trim();
      void saveSettings({
        recentSearches: [
          value,
          ...settingsRef.current.recentSearches.filter((x) => x !== value),
        ].slice(0, 8),
      });
    }, 800);
    return () => clearTimeout(id);
  }, [query, page]);
  const navigate = (dest: string) => {
    if (dest === "search") {
      if (page === "search") dest = searchReturn.current || "home";
      else searchReturn.current = route;
    }
    if (dest === "words") {
      setWordBook("all");
      setWordTab("all");
    }
    location.hash = "/" + dest;
    setOverlay("");
  };
  function go(b: Book, address?: string, offset?: number) {
    const p = progressRef.current.find((x) => x.book === b.manifest.id);
    const content = decoded.get(b.manifest.id)!.content;
    const keys = addresses(content);
    const requested = address || p?.at || "1.1";
    const target = keys.includes(requested) ? requested : "1.1";
    const [ci, fi] = target.split(".").map((n) => +n - 1);
    const length = plain(content.c[ci][fi]).length;
    const position = Math.max(0, offset || 0);
    const percent = Math.min(
      99,
      Math.round(
        ((keys.indexOf(target) +
          (position % (length + 1)) / Math.max(1, length)) /
          keys.length) *
          100,
      ),
    );
    const nextMode = p?.mode || settings.defaultMode;
    setWord(null);
    setOverlay("");
    if (address)
      void run(() =>
        commit({
          book: b.manifest.id,
          at: target,
          offset: position,
          mode: nextMode,
          percent: p?.percent === 100 ? 100 : percent,
          updatedAt: new Date().toISOString(),
        }),
      );
    location.hash = `/read/${b.manifest.id}/${target}/${nextMode}`;
  }
  useEffect(() => {
    if (!active) return;
    if (!addresses(active.content).includes(at)) {
      location.hash = `/read/${bookId}/1.1/${settings.defaultMode}`;
      return;
    }
    if (
      !["frank", "clean", "parallel"].includes(mode) ||
      (mode === "parallel" && !active.content.t)
    ) {
      location.hash = `/read/${bookId}/${at}/frank`;
      return;
    }
    if (settings.current !== bookId)
      void run(() => saveSettings({ current: bookId }));
    if (!currentProgress)
      void run(() =>
        commit({
          book: bookId,
          at,
          offset: 0,
          percent: 0,
          mode,
          updatedAt: new Date().toISOString(),
        }),
      );
  }, [bookId, active, at, mode]);
  const onWord = useCallback((w: WordSelection) => setWord(w), []);
  const renderFragment = useCallback(
    (chunks: Chunk[], address: string) =>
      active ? (
        <BookText
          chunks={chunks}
          address={address}
          content={active.content}
          manifest={active.manifest}
          mode={mode}
          repeat={settings.showClean}
          onWord={onWord}
        />
      ) : null,
    [active, mode, settings.showClean, onWord],
  );
  const onPosition = (address: string, offset: number) => {
    if (!active) return;
    const keys = addresses(active.content),
      i = keys.indexOf(address),
      [ci, fi] = address.split(".").map((n) => +n - 1);
    const fraction =
      (offset % (plain(active.content.c[ci][fi]).length + 1)) /
      Math.max(1, plain(active.content.c[ci][fi]).length);
    const previous = progressRef.current.find((p) => p.book === bookId);
    void run(() =>
      commit({
        book: bookId,
        at: address,
        offset,
        mode,
        percent:
          previous?.percent === 100
            ? 100
            : Math.min(99, Math.round(((i + fraction) / keys.length) * 100)),
        updatedAt: new Date().toISOString(),
      }),
    );
    const next = `read/${bookId}/${address}/${mode}`;
    history.replaceState(null, "", "#/" + next);
    setRoute(next);
  };
  const signature = useCallback(
    (id: string) => {
      const b = decoded.get(id),
        p = progress.find((x) => x.book === id);
      return JSON.stringify([
        viewportSize,
        b?.manifest.revision,
        page === "read" && id === bookId
          ? mode
          : p?.mode || settings.defaultMode,
        settings.font,
        settings.fontSize,
        settings.showClean,
        settings.pageTurn,
        settings.bold,
        settings.hintSize,
        settings.hintItalic,
        settings.customLayout,
        settings.lineSpacing,
        settings.letterSpacing,
        settings.wordSpacing,
        settings.margins,
        settings.columns,
        settings.justify,
      ]);
    },
    [decoded, progress, viewportSize, mode, settings, page, bookId],
  );
  const recordIndex = useCallback(
    (id: string, sig: string, pages: PageEntry[]) =>
      setIndexCache((cache) =>
        cache[id]?.signature === sig &&
        JSON.stringify(cache[id].pages) === JSON.stringify(pages)
          ? cache
          : { ...cache, [id]: { signature: sig, pages } },
      ),
    [],
  );
  const pageEntries = (id: string) =>
    indexCache[id]?.signature === signature(id)
      ? indexCache[id].pages
      : undefined;
  const measureBook =
    page !== "read"
      ? books.find((b) => !pageEntries(b.manifest.id))
      : undefined;
  const measured = measureBook ? decoded.get(measureBook.manifest.id) : null;
  const measureMode = measured
    ? progress.find((p) => p.book === measured.manifest.id)?.mode ||
      settings.defaultMode
    : "frank";
  const renderMeasure = useCallback(
    (chunks: Chunk[], address: string) =>
      measured ? (
        <BookText
          chunks={chunks}
          address={address}
          content={measured.content}
          manifest={measured.manifest}
          mode={measureMode}
          repeat={settings.showClean}
        />
      ) : null,
    [measured, measureMode, settings.showClean],
  );
  const status = (b: Book) => {
    const p = progress.find((x) => x.book === b.manifest.id);
    return p?.percent === 100 ? t("Finished") : p ? `${p.percent}%` : t("NEW");
  };
  const pageStatus = (b: Book) => {
    const p = progress.find((x) => x.book === b.manifest.id),
      entries = pageEntries(b.manifest.id);
    return entries
      ? t("Page {0} of {1}", {
          0: pageFor(entries, p?.at || "1.1", p?.offset || 0),
          1: entries.length,
        })
      : "…";
  };
  const showBookWords = (id: string) => {
    setWordBook(id);
    setWordTab("book");
    location.hash = "/words";
    setOverlay("");
  };
  function openAnki(id?: string, selected = false) {
    setAnkiBook(id || "all");
    setAnkiScope(selected ? "selected" : id ? "book" : "new");
    setOverlay("anki");
  }
  const newWords = saved.filter((w) => !w.inAnki);
  const visibleWords = saved
    .filter((w) => wordBook === "all" || w.book === wordBook)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const toggleWord = (key: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const selectAll = (list: SavedWord[]) =>
    setSelection((prev) => {
      const next = new Set(prev);
      const all = list.every((w) => next.has(w.key));
      for (const w of list) all ? next.delete(w.key) : next.add(w.key);
      return next;
    });
  function requestDeleteWords() {
    if (!selection.size) return;
    setConfirm({
      title: t("Delete selected words?"),
      text: t("This removes {0} saved words.", { 0: selection.size }),
      action: async () => {
        const keys = [...selection];
        await Promise.all(keys.map((k) => store.remove("words", k)));
        setSaved((prev) => prev.filter((w) => !keys.includes(w.key)));
        setSelection(new Set());
        setSelecting(false);
      },
    });
  }
  const chosenAnki = saved.filter((w) =>
    ankiScope === "selected"
      ? selection.has(w.key)
      : ankiScope === "book"
        ? w.book === ankiBook && !w.inAnki
        : ankiScope === "new"
          ? !w.inAnki
          : true,
  );
  const exportAnki = async () => {
    if (!chosenAnki.length) return;
    exportWords(chosenAnki, books, true, false, {
      ipa: ankiIpa,
      context: ankiContext,
      deck: settings.deck,
    });
    if (settings.markExported) {
      await Promise.all(
        chosenAnki.map((w) =>
          store.put("words", w.key, { ...w, inAnki: true }),
        ),
      );
      setSaved((prev) =>
        prev.map((w) =>
          chosenAnki.some((x) => x.key === w.key) ? { ...w, inAnki: true } : w,
        ),
      );
    }
    setOverlay("");
    notify(t("Anki export complete"));
  };
  const inspectFile = async (file: File) => {
    setOverlay("add");
    setFileBusy(true);
    setFileError("");
    setPending(null);
    try {
      if (!file.name.toLowerCase().endsWith(".fbook"))
        throw Error(t("Choose an .fbook file."));
      if (file.size > 32 * 1024 * 1024)
        throw Error(t("The file exceeds 32 MB."));
      const data = readBook(new Uint8Array(await file.arrayBuffer()));
      setPending(data);
    } catch (e) {
      setFileError(
        translateMessage(settingsRef.current.language, (e as Error).message),
      );
    } finally {
      setFileBusy(false);
    }
  };
  useEffect(() => {
    const drag = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        void inspectFile(e.dataTransfer.files[0]);
      }
    };
    window.addEventListener("dragover", drag);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", drag);
      window.removeEventListener("drop", drop);
    };
  }, [settings.language]);
  const addPending = async () => {
    if (
      !pending ||
      booksRef.current.some((b) => b.manifest.id === pending.manifest.id)
    )
      return;
    await store.put("books", pending.manifest.id, {
      manifest: pending.manifest,
      bytes: pending.bytes,
      addedAt: new Date().toISOString(),
    });
    await refresh();
    setOverlay("");
    setPending(null);
    notify(t("Book added"));
  };
  const removeBook = (b: Book) =>
    setConfirm({
      title: t("Remove book?"),
      text:
        b.manifest.title + ". " + t("Saved words will stay on this device."),
      action: async () => {
        await store.deleteBook(b.manifest.id);
        await refresh();
        setOverlay("");
        setDetails(null);
      },
    });
  const wordForm = word && active?.content.f[word.form],
    lemma = wordForm?.[1] != null ? active?.content.l[wordForm[1]] : undefined,
    ipa = word
      ? active?.content.x?.[word.at]?.[word.form] || wordForm?.[0] || ""
      : "";
  const wordKey = word
    ? [bookId, lemma?.[0] || word.form, word.at].join("|")
    : "";
  const listen = async (text: string, phonetic?: string, toggle = false) => {
    const id = ++audioRunId.current;
    if (busy && toggle) {
      stop();
      setBusy(false);
      return;
    }
    unlockAudio();
    setBusy(true);
    try {
      const duration = await speak(text, phonetic, settings, () => {
        if (id === audioRunId.current) setBusy(false);
      });
      if (duration === 0 && id === audioRunId.current) setBusy(false);
    } catch (e) {
      if (id === audioRunId.current) {
        setBusy(false);
        notify((e as Error).message, true);
      }
    }
  };
  const saveWord = async () => {
    if (!word) return;
    const w: SavedWord = {
      key: wordKey,
      book: bookId,
      at: word.at,
      lemma: lemma?.[0] || word.form,
      ru: lemma?.[1] || word.hint || "",
      ipa,
      context: word.context,
      contextTranslation: word.translation,
      partOfSpeech: lemma?.[2] || "",
      form: word.form,
      savedAt: new Date().toISOString(),
      inAnki: false,
    };
    await store.put("words", w.key, w);
    setSaved((prev) => [...prev.filter((x) => x.key !== w.key), w]);
  };
  const wordPanel =
    word && active ? (
      <aside class="word-panel" aria-label={t("Word details")}>
        <div class="row between">
          <h2 lang="de">{lemma?.[0] || word.form}</h2>
          <button
            class="round"
            aria-label={t("Close")}
            onClick={() => setWord(null)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div class="row between">
          <small class="muted">
            {lemma?.[2] || ""} · {t("In text: {0}", { 0: word.form })} · [{ipa}]
          </small>
          <button
            class="round"
            aria-label={t("Pronounce word")}
            onClick={() => void listen(word.form, ipa)}
          >
            <Icon name="sound" />
          </button>
        </div>
        <p>{lemma?.[1] || word.hint || t("No dictionary translation")}</p>
        <div class="word-context">
          <p lang="de">{word.context}</p>
          {word.translation && (
            <p lang={active.manifest.hintLang}>{word.translation}</p>
          )}
        </div>
        <button
          class="primary wide"
          disabled={saved.some((w) => w.key === wordKey)}
          onClick={() => void run(saveWord)}
        >
          <Icon
            name={saved.some((w) => w.key === wordKey) ? "check" : "bookmark"}
          />
          {t(
            saved.some((w) => w.key === wordKey) ? "Saved" : "Save to My Words",
          )}
        </button>
      </aside>
    ) : null;
  const bookmarkKey = positionKey(at, currentProgress?.offset || 0);
  const toggleBookmark = () => {
    const p = progressRef.current.find((x) => x.book === bookId);
    if (!p) return;
    const exists = p.bookmarks?.some(
      (b) => positionKey(b.at, b.offset) === bookmarkKey,
    );
    void run(() =>
      commit({
        ...p,
        bookmarks: exists
          ? p.bookmarks!.filter(
              (b) => positionKey(b.at, b.offset) !== bookmarkKey,
            )
          : [
              ...(p.bookmarks || []),
              {
                at,
                offset: p.offset || 0,
                createdAt: new Date().toISOString(),
              },
            ],
      }),
    );
  };
  const marked = (text: string) => (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.match ? <mark key={i}>{p.text}</mark> : p.text,
      )}
    </>
  );
  const createCollection = () => {
    if (collectionsRef.current.length >= 200) {
      notify(t("Collection limit reached"), true);
      return;
    }
    setEditingCollection(null);
    setCollectionBook(null);
    setOverlay("collection-editor");
  };
  const manageCollection = (c: BookCollection) => {
    setEditingCollection(c);
    setCollectionBook(null);
    setOverlay("collection-editor");
  };
  const selectCollection = (id: string) => {
    setCollectionFilter(id);
    setLibraryFilter("all");
    navigate("library");
  };
  const reorderCollection = (id: string, before: string | null) =>
    void run(() =>
      saveCollections(moveCollection(collectionsRef.current, id, before)),
    );
  const shiftCollection = (direction: number) => {
    if (!editingCollection) return;
    const list = collectionsRef.current,
      index = list.findIndex((c) => c.id === editingCollection.id);
    if (index + direction < 0 || index + direction >= list.length) return;
    const before =
      direction < 0 ? list[index - 1].id : list[index + 2]?.id || null;
    reorderCollection(editingCollection.id, before);
  };
  const saveCollection = async (name: string, bookIds: string[]) => {
    await run(async () => {
      if (!editingCollection && collectionsRef.current.length >= 200)
        throw Error("Collection limit reached");
      const now = new Date().toISOString(),
        old = editingCollection,
        id = old?.id || crypto.randomUUID();
      let list = old
        ? collectionsRef.current.map((c) =>
            c.id === id ? { ...c, name, bookIds, updatedAt: now } : c,
          )
        : [...collectionsRef.current, { id, name, bookIds, updatedAt: now }];
      if (!old && collectionBook)
        list = moveBookToCollection(list, collectionBook.manifest.id, id);
      await saveCollections(list);
      setCollectionFilter(id);
      setLibraryFilter("all");
      setOverlay(collectionBook ? "details" : "");
      if (!collectionBook) location.hash = "/library";
      notify(t(old ? "Collection updated" : "Collection created"));
    });
  };
  const moveBook = async (bookId: string, target: string | null) => {
    await saveCollections(
      moveBookToCollection(collectionsRef.current, bookId, target),
    );
    notify(t("Book moved"));
  };
  const visibleFilters = ["all", ...settings.levelOrder, "finished"].filter(
    (value) => !settings.hiddenLibraryFolders.includes(value),
  );
  const deleteLibraryFolder = (value: string) => {
    if (value === "all") return;
    setConfirm({
      title: t("Delete folder {0}?", { 0: t(filterLabel(value)) }),
      text: t("The books will stay in your library."),
      action: async () => {
        await saveSettings({
          hiddenLibraryFolders: [
            ...new Set([...settingsRef.current.hiddenLibraryFolders, value]),
          ],
        });
        if (libraryFilter === value) setLibraryFilter("all");
      },
    });
  };
  const openFolderMenu = (
    kind: FolderMenuTarget["kind"],
    id: string,
    name: string,
    event: MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setBookMenu(null);
    setFolderMenu({
      kind,
      id,
      name,
      x: event.clientX || rect.left + 20,
      y: event.clientY || rect.bottom,
    });
  };
  const reorderLevel = (id: string, before: string | null) => {
    if (id === before || !settingsRef.current.levelOrder.includes(id)) return;
    const order = settingsRef.current.levelOrder.filter(
      (value) => value !== id,
    );
    const index = before ? order.indexOf(before) : -1;
    order.splice(index < 0 ? order.length : index, 0, id);
    void run(() => saveSettings({ levelOrder: order }));
  };
  const deleteCollection = (collection = editingCollection) => {
    if (!collection) return;
    const id = collection.id;
    setConfirm({
      title: t("Delete collection {0}?", { 0: collection.name }),
      text: t("The books will stay in your library."),
      action: async () => {
        await saveCollections(
          collectionsRef.current.filter((c) => c.id !== id),
        );
        if (collectionFilter === id) setCollectionFilter("");
        setOverlay("");
      },
    });
  };
  const openBookMenu = (book: Book, event: MouseEvent, anchored = false) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setFolderMenu(null);
    setBookMenu({
      book,
      folder: page === "library" ? collectionFilter : "",
      x: anchored ? rect.left : event.clientX || rect.left,
      y: anchored ? rect.bottom : event.clientY || rect.bottom,
    });
  };
  const foldersForBook = (
    book: Book,
    folder = page === "library" ? collectionFilter : "",
  ) => {
    const memberships = collections.filter((c) =>
      c.bookIds.includes(book.manifest.id),
    );
    const current = memberships.find((c) => c.id === folder);
    return current ? [current] : memberships;
  };
  const removeFromFolder = async (book: Book, folder: string) => {
    await saveCollections(
      collectionsRef.current.map((c) =>
        c.id === folder
          ? {
              ...c,
              bookIds: c.bookIds.filter((id) => id !== book.manifest.id),
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    notify(t("Book removed from folder"));
  };
  const card = (b: Book) => (
    <article
      class="shelf-book"
      data-book={b.manifest.id}
      onContextMenu={(event) => openBookMenu(b, event)}
      key={b.manifest.id}
      draggable
      onDragStart={(e) => bookDrag(e, b.manifest.id)}
    >
      <button
        class="cover-open"
        aria-label={b.manifest.title}
        onClick={() => {
          setDetails(b);
          setOverlay("details");
        }}
      >
        <BookCover manifest={b.manifest} />
      </button>
      <div class="book-status">
        <span
          class={
            !progress.some((p) => p.book === b.manifest.id) ? "new-badge" : ""
          }
        >
          {status(b)}
        </span>
        {b.manifest.annotation === "auto" && (
          <span class="auto-badge">{t("Auto text")}</span>
        )}
        <button
          class="book-more"
          aria-label={t("Book options for {0}", { 0: b.manifest.title })}
          onClick={(event) => openBookMenu(b, event, true)}
        >
          ···
        </button>
      </div>
    </article>
  );
  const bookMini = (id: string) => {
    const b = books.find((b) => b.manifest.id === id);
    return b ? <BookCover manifest={b.manifest} small /> : <Icon name="book" />;
  };
  const wordRow = (w: SavedWord) => {
    const b = books.find((b) => b.manifest.id === w.book);
    return (
      <div
        class={
          "word-row" + (selection.has(w.key) && selecting ? " selected" : "")
        }
        role="row"
        data-word-key={w.key}
        onPointerDown={(event) => {
          suppressWordClick.current = false;
          if (!selecting || event.pointerType !== "mouse" || event.button !== 0)
            return;
          wordDrag.current = {
            key: w.key,
            x: event.clientX,
            y: event.clientY,
            lastY: event.clientY,
            add: !selection.has(w.key),
            moved: false,
            visited: new Set(),
          };
        }}
        onDragStart={(event) => {
          if (selecting) event.preventDefault();
        }}
        key={w.key}
      >
        {selecting && (
          <input
            type="checkbox"
            aria-label={t("Select word {0}", { 0: w.lemma })}
            checked={selection.has(w.key)}
            onChange={() => toggleWord(w.key)}
          />
        )}
        <button
          class="word-main"
          aria-pressed={selection.has(w.key) && selecting}
          onClick={() => {
            setSelecting(true);
            toggleWord(w.key);
          }}
        >
          <span lang="de">
            <strong>{w.lemma}</strong> <small class="ipa">[{w.ipa}]</small>
          </span>
          <span class="word-translation">{w.ru}</span>
          <span class="word-sentence" lang="de">
            {w.context}
          </span>
        </button>
        <button
          class="word-book"
          onContextMenu={(event) => {
            if (b) openBookMenu(b, event);
          }}
          aria-label={b?.manifest.title || t("Unknown book")}
          onClick={() => showBookWords(w.book)}
        >
          {bookMini(w.book)}
          <span>{b?.manifest.title || t("Unknown book")}</span>
        </button>
        {!w.inAnki && <span class="new-word-dot" title={t("New word")} />}
      </div>
    );
  };
  const ankiCount = chosenAnki.length;
  const title =
    page === "library"
      ? collectionFilter
        ? collections.find((c) => c.id === collectionFilter)?.name ||
          t("All Books")
        : t(libraryFilter === "all" ? "All Books" : filterLabel(libraryFilter))
      : page === "words"
        ? t(wordTab === "book" ? "Words by Book" : "All words")
        : t(page === "search" ? "Search" : "Home");
  const orderedReadingBooks = [...books]
    .sort((a, b) => {
      const pa = progress.find((p) => p.book === a.manifest.id),
        pb = progress.find((p) => p.book === b.manifest.id);
      return (
        Number(b.manifest.id === settings.current) -
          Number(a.manifest.id === settings.current) ||
        (pb?.updatedAt || "").localeCompare(pa?.updatedAt || "")
      );
    })
    .filter(
      (b) => progress.find((p) => p.book === b.manifest.id)?.percent !== 100,
    );
  const startedBooks = orderedReadingBooks.filter((b) =>
    progress.some((p) => p.book === b.manifest.id && p.percent < 100),
  );
  const runningBooks = startedBooks.length
    ? startedBooks
    : orderedReadingBooks.slice(0, 2);
  const recentBooks = [...books]
    .sort((a, b) =>
      ((b as any).addedAt || "").localeCompare((a as any).addedAt || ""),
    )
    .slice(0, 4);
  const filteredBooks = collectionFilter
    ? books.filter((b) =>
        collections
          .find((c) => c.id === collectionFilter)
          ?.bookIds.includes(b.manifest.id),
      )
    : books.filter(
        (b) =>
          libraryFilter === "all" ||
          libraryFilter === b.manifest.level ||
          (libraryFilter === "reading" &&
            progress.some(
              (p) => p.book === b.manifest.id && p.percent < 100,
            )) ||
          (libraryFilter === "finished" &&
            progress.some(
              (p) => p.book === b.manifest.id && p.percent === 100,
            )),
      );
  const foundBooks = books.filter((b) =>
    [b.manifest.title, b.manifest.author, b.manifest.level]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const foundWords = saved.filter((w) =>
    [w.lemma, w.form, w.ru, w.context]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const foundText = useMemo(
    () =>
      query.trim()
        ? books
            .map((b) => ({
              book: b,
              hits: searchText(
                decoded.get(b.manifest.id)!.content,
                query,
                indexCache[b.manifest.id]?.pages,
              ),
            }))
            .filter((x) => x.hits.length)
        : [],
    [books, query, indexCache, decoded],
  );
  if (!ready)
    return (
      <main class="startup">
        <h1>{t("German with Frank")}</h1>
        <p>
          {t(
            startupError ? "Could not open local storage" : "Opening library…",
          )}
        </p>
        {startupError && (
          <>
            <p role="alert">
              {translateMessage(settings.language, startupError)}
            </p>
            <button onClick={() => location.reload()}>{t("Try again")}</button>
          </>
        )}
      </main>
    );
  return (
    <LocaleContext.Provider value={settings.language}>
      <input
        hidden
        type="file"
        accept=".fbook"
        ref={fileRef}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void inspectFile(file);
          e.currentTarget.value = "";
        }}
      />
      <input
        hidden
        type="file"
        accept=".json,.zip"
        ref={backupRef}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file)
            void run(async () => {
              if (file.size > 32 * 1024 * 1024)
                throw Error(t("The file exceeds 32 MB."));
              const parsed = parseBackup(
                new Uint8Array(await file.arrayBuffer()),
              );
              setConfirm({
                title: t("Restore backup?"),
                text: t("Newer reading progress will be kept."),
                action: async () => {
                  await importBackup(parsed, true);
                  await refresh();
                  setIndexCache({});
                  setOverlay("");
                  notify(t("Restore complete"));
                },
              });
            });
        }}
      />
      {active ? (
        <PagedReader
          key={bookId}
          manifest={active.manifest}
          content={active.content}
          settings={settings}
          mode={mode}
          at={at}
          offset={currentProgress?.at === at ? currentProgress.offset || 0 : 0}
          onPosition={onPosition}
          onSettings={(p) => void run(() => saveSettings(p))}
          onMode={(value) => {
            setWord(null);
            location.hash = `/read/${bookId}/${at}/${value}`;
            const p = progressRef.current.find((x) => x.book === bookId);
            if (p) void run(() => commit({ ...p, mode: value }));
          }}
          onJump={(address) =>
            go(books.find((b) => b.manifest.id === bookId)!, address, 0)
          }
          onComplete={() =>
            void run(async () => {
              const p = progressRef.current.find((x) => x.book === bookId)!;
              await commit({
                ...p,
                percent: 100,
                updatedAt: new Date().toISOString(),
              });
              location.hash = "/home";
              notify(t("Book completed"));
            })
          }
          onListen={(text, ipa) =>
            void listen(text || plain(active.content.c[0][0]), ipa, true)
          }
          busy={busy}
          progressPercent={currentProgress?.percent || 0}
          renderFragment={renderFragment}
          wordPanel={wordPanel}
          onDismissWord={() => setWord(null)}
          onIndex={(entries) => recordIndex(bookId, signature(bookId), entries)}
          onBookmark={toggleBookmark}
          bookmarked={currentProgress?.bookmarks?.some(
            (b) => positionKey(b.at, b.offset) === bookmarkKey,
          )}
          bookmarks={currentProgress?.bookmarks}
          onWords={() => showBookWords(bookId)}
        />
      ) : (
        <div
          class={
            "books-shell" +
            (settings.sidebarCollapsed ? " sidebar-collapsed" : "")
          }
        >
          <aside class="library-sidebar glass">
            <div class="sidebar-brand">
              <span>{t("German with Frank")}</span>
              <button
                class="round"
                aria-label={t("Hide sidebar")}
                title="⌃⌘S"
                onClick={() =>
                  void run(() => saveSettings({ sidebarCollapsed: true }))
                }
              >
                <Icon name="sidebar" size={18} />
              </button>
            </div>
            <button
              class={"sidebar-item" + (page === "search" ? " active" : "")}
              onClick={() => navigate("search")}
            >
              <Icon name="search" />
              {t("Search")}
            </button>
            <button
              class={"sidebar-item" + (page === "home" ? " active" : "")}
              onClick={() => navigate("home")}
            >
              <Icon name="home" />
              {t("Home")}
            </button>
            <CollectionMenu
              collections={collections}
              books={books}
              active={page === "library" ? collectionFilter : ""}
              onSelect={selectCollection}
              onCreate={createCollection}
              onManage={manageCollection}
              onReorder={reorderCollection}
              onMoveBook={(id, target) => void run(() => moveBook(id, target))}
              onContextMenu={(c, event) =>
                openFolderMenu("collection", c.id, c.name, event)
              }
            >
              <button
                class={
                  "sidebar-item" +
                  (page === "library" &&
                  !collectionFilter &&
                  libraryFilter === "all"
                    ? " active"
                    : "")
                }
                onClick={() => {
                  setLibraryFilter("all");
                  setCollectionFilter("");
                  navigate("library");
                }}
              >
                <Icon name="book" size={17} />
                <span>{t("All Books")}</span>
              </button>
              {!settings.hiddenLibraryFolders.includes("finished") && (
                <button
                  data-folder-context
                  class={
                    "sidebar-item" +
                    (page === "library" &&
                    !collectionFilter &&
                    libraryFilter === "finished"
                      ? " active"
                      : "")
                  }
                  onContextMenu={(event) =>
                    openFolderMenu("finished", "finished", t("Finished"), event)
                  }
                  onClick={() => {
                    setLibraryFilter("finished");
                    setCollectionFilter("");
                    navigate("library");
                  }}
                >
                  <Icon name="check" size={17} />
                  <span>{t("Finished")}</span>
                </button>
              )}
            </CollectionMenu>
            <LevelMenu
              levels={settings.levelOrder.filter(
                (id) => !settings.hiddenLibraryFolders.includes(id),
              )}
              active={
                page === "library" && !collectionFilter ? libraryFilter : ""
              }
              onSelect={(id) => {
                setLibraryFilter(id);
                setCollectionFilter("");
                navigate("library");
              }}
              onReorder={reorderLevel}
              onContextMenu={(id, event) =>
                openFolderMenu("level", id, id, event)
              }
            />
            <h3>{t("Words")}</h3>
            <button
              class={
                "sidebar-item" +
                (page === "words" && wordTab === "all" ? " active" : "")
              }
              onClick={() => {
                setWordTab("all");
                setWordBook("all");
                location.hash = "/words";
              }}
            >
              <Icon name="words" size={17} />
              {t("All words")}
            </button>
            <button
              class={
                "sidebar-item" +
                (page === "words" && wordTab === "book" ? " active" : "")
              }
              onClick={() => {
                setWordTab("book");
                setWordBook("all");
                location.hash = "/words";
              }}
            >
              <Icon name="book" size={17} />
              {t("By Book")}
            </button>
            <button class="sidebar-item" onClick={() => openAnki()}>
              <Icon name="download" size={17} />
              {t("Export to Anki")}
            </button>
            <div class="sidebar-spacer" />
            <button
              class="sidebar-item"
              onClick={() => {
                setPending(null);
                setFileError("");
                setOverlay("add");
              }}
            >
              <Icon name="plus" size={17} />
              {t("Add .fbook")}
            </button>
            <button class="sidebar-item" onClick={() => setOverlay("settings")}>
              <Icon name="settings" size={17} />
              {t("Settings")}
            </button>
          </aside>
          <main class="library-main">
            <div class="collapsed-tools">
              <button
                class="round glass"
                aria-label={t("Show sidebar")}
                onClick={() =>
                  void run(() => saveSettings({ sidebarCollapsed: false }))
                }
              >
                <Icon name="sidebar" />
              </button>
              <button
                class="round glass"
                aria-label={t("Search")}
                onClick={() => navigate("search")}
              >
                <Icon name="search" />
              </button>
            </div>
            <header class="library-heading">
              <h1>{title}</h1>
              <div class="row">
                {page === "library" &&
                  !collectionFilter &&
                  libraryFilter !== "all" && (
                    <button
                      class="round glass delete-library-folder"
                      aria-label={t("Delete folder {0}", {
                        0: t(filterLabel(libraryFilter)),
                      })}
                      onClick={() => deleteLibraryFolder(libraryFilter)}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                {page === "library" && (
                  <button
                    class="pill glass"
                    onClick={() => {
                      setPending(null);
                      setFileError("");
                      setOverlay("add");
                    }}
                  >
                    <Icon name="plus" />
                    <span>{t("Add .fbook")}</span>
                  </button>
                )}
                {page === "words" && (
                  <>
                    <button
                      class="pill glass"
                      onClick={() =>
                        openAnki(wordBook === "all" ? undefined : wordBook)
                      }
                    >
                      <Icon name="download" />
                      <span>{t("To Anki")}</span>
                    </button>
                    <button
                      class="pill glass word-selection-toggle"
                      onClick={() => {
                        setSelecting(!selecting);
                        setSelection(new Set());
                      }}
                    >
                      {t(selecting ? "Done" : "Select")}
                    </button>
                  </>
                )}
                <button
                  class="round glass mobile-settings"
                  aria-label={t("Settings")}
                  onClick={() => setOverlay("settings")}
                >
                  <Icon name="settings" />
                </button>
              </div>
            </header>
            {page === "home" && (
              <>
                <section class="home-section">
                  <h2>{t("Reading")}</h2>
                  <div
                    class="continue-shelf"
                    ref={readingShelf}
                    tabIndex={0}
                    role="region"
                    aria-label={t("Reading")}
                    onKeyDown={(event) => {
                      if (
                        event.target !== event.currentTarget ||
                        !["ArrowLeft", "ArrowRight"].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      event.currentTarget.scrollBy({
                        left:
                          event.currentTarget.clientWidth *
                          0.8 *
                          (event.key === "ArrowRight" ? 1 : -1),
                        behavior: matchMedia("(prefers-reduced-motion: reduce)")
                          .matches
                          ? "instant"
                          : "smooth",
                      });
                    }}
                  >
                    {runningBooks.map((b, i) => (
                      <article
                        class="continue-card"
                        data-book={b.manifest.id}
                        onContextMenu={(event) => openBookMenu(b, event)}
                        key={b.manifest.id}
                        onClick={(e) => {
                          if (!(e.target as HTMLElement).closest("button"))
                            go(b);
                        }}
                      >
                        <BookCover manifest={b.manifest} small />
                        <div class="continue-copy">
                          <small>
                            {i === 0 ? t("Reading now") + " · " : ""}
                            {b.manifest.level}
                          </small>
                          <h3>{b.manifest.title}</h3>
                          <p>{b.manifest.author}</p>
                          <small>
                            {pageStatus(b)} ·{" "}
                            {progress.find((p) => p.book === b.manifest.id)
                              ?.percent || 0}
                            %
                            {b.manifest.annotation === "auto"
                              ? " · " + t("Auto text")
                              : ""}
                          </small>
                          <button class="primary" onClick={() => go(b)}>
                            {t("Continue")}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!books.length && (
                    <button onClick={() => setOverlay("add")}>
                      {t("Add your first book")}
                    </button>
                  )}
                </section>
                <section class="home-section">
                  <h2>{t("New Words")}</h2>
                  <div class="new-words-card glass-group">
                    <div class="new-words-icon">
                      <Icon name="words" />
                    </div>
                    <div>
                      <strong>
                        {t("{0} words not in Anki yet", { 0: newWords.length })}
                      </strong>
                      <p>
                        {newWords.length
                          ? newWords
                              .slice(0, 5)
                              .map((w) => w.lemma)
                              .join(", ")
                          : t("Tap a word while reading to save it here.")}
                      </p>
                    </div>
                    <button
                      class="pill glass"
                      disabled={!newWords.length}
                      onClick={() => openAnki()}
                    >
                      <Icon name="download" size={15} />
                      {t("To Anki")}
                    </button>
                  </div>
                </section>
                <section class="home-section">
                  <div class="row between">
                    <h2>{t("Recently Added")}</h2>
                    <button class="quiet" onClick={() => navigate("library")}>
                      <Icon name="next" />
                    </button>
                  </div>
                  <div class="book-grid recently-added">
                    {recentBooks.map(card)}
                  </div>
                </section>
              </>
            )}
            {page === "library" && (
              <>
                <div
                  class="filter-tabs"
                  role="tablist"
                  aria-label={t("Library")}
                >
                  {visibleFilters.map((value) => (
                    <button
                      role="tab"
                      onContextMenu={(event) => {
                        if (value !== "all")
                          openFolderMenu(
                            value === "finished" ? "finished" : "level",
                            value,
                            t(filterLabel(value)),
                            event,
                          );
                      }}
                      aria-selected={
                        !collectionFilter && value === libraryFilter
                      }
                      onClick={() => {
                        setCollectionFilter("");
                        setLibraryFilter(value);
                      }}
                    >
                      {t(value === "all" ? "All" : filterLabel(value))}
                    </button>
                  ))}
                </div>
                <CollectionStrip
                  collections={collections}
                  active={collectionFilter}
                  onSelect={selectCollection}
                  onCreate={createCollection}
                  onManage={manageCollection}
                  onContextMenu={(c, event) =>
                    openFolderMenu("collection", c.id, c.name, event)
                  }
                />
                <div class="book-grid">{filteredBooks.map(card)}</div>
                {!filteredBooks.length && (
                  <div class="empty-state">
                    <Icon name="book" size={36} />
                    <p>
                      {t(
                        collectionFilter
                          ? "This collection is empty"
                          : "No books match this filter",
                      )}
                    </p>
                    {collectionFilter && (
                      <>
                        <p>
                          {t(
                            "Choose books in the collection settings or move a book from its details.",
                          )}
                        </p>
                        <button
                          class="pill glass"
                          onClick={() =>
                            manageCollection(
                              collections.find(
                                (c) => c.id === collectionFilter,
                              )!,
                            )
                          }
                        >
                          {t("Manage Collection")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {page === "words" && (
              <>
                <div class="word-toolbar">
                  <div class="tabs">
                    <button
                      aria-pressed={wordTab === "all"}
                      onClick={() => setWordTab("all")}
                    >
                      {t("All")}
                    </button>
                    <button
                      aria-pressed={wordTab === "book"}
                      onClick={() => setWordTab("book")}
                    >
                      {t("By Book")}
                    </button>
                  </div>
                  {wordBook !== "all" && (
                    <button
                      class="pill glass"
                      onClick={() => setWordBook("all")}
                    >
                      {books.find((b) => b.manifest.id === wordBook)?.manifest
                        .title || t("Unknown book")}{" "}
                      <Icon name="close" size={14} />
                    </button>
                  )}
                  <small>
                    {selecting
                      ? t("{0} selected", { 0: selection.size })
                      : t("{0} words · {1} not in Anki yet", {
                          0: visibleWords.length,
                          1: visibleWords.filter((w) => !w.inAnki).length,
                        })}
                  </small>
                </div>
                {!visibleWords.length ? (
                  <div class="empty-state">
                    <Icon name="words" size={36} />
                    <h2>{t("No saved words yet")}</h2>
                    <p>{t("Tap a word while reading to save it here.")}</p>
                  </div>
                ) : wordTab === "all" ? (
                  <div
                    class={"word-table" + (selecting ? " is-selecting" : "")}
                    role="table"
                  >
                    <div class="word-table-head" role="row">
                      <span>{t("Word")}</span>
                      <span>{t("Translation")}</span>
                      <span>{t("Sentence from book")}</span>
                      <span>{t("Book")}</span>
                    </div>
                    {visibleWords.map(wordRow)}
                  </div>
                ) : (
                  <div class="word-groups">
                    {[...new Set(visibleWords.map((w) => w.book))].map((id) => {
                      const list = visibleWords.filter((w) => w.book === id),
                        b = books.find((b) => b.manifest.id === id);
                      return (
                        <section class="word-group glass-group">
                          <header>
                            <div class="mini-cover">{bookMini(id)}</div>
                            <div>
                              <h3>{b?.manifest.title || t("Unknown book")}</h3>
                              <small>
                                {selecting
                                  ? t("{0} of {1} selected", {
                                      0: list.filter((w) =>
                                        selection.has(w.key),
                                      ).length,
                                      1: list.length,
                                    })
                                  : t("{0} words · {1} new", {
                                      0: list.length,
                                      1: list.filter((w) => !w.inAnki).length,
                                    })}
                              </small>
                            </div>
                            {selecting ? (
                              <button
                                class="quiet accent"
                                aria-label={t("Select all from {0}", {
                                  0: b?.manifest.title || id,
                                })}
                                onClick={() => selectAll(list)}
                              >
                                {t("Select All")}
                              </button>
                            ) : (
                              <button
                                class="pill glass"
                                onClick={() => openAnki(id)}
                              >
                                {t("To Anki")}
                              </button>
                            )}
                          </header>
                          <div class={selecting ? "is-selecting" : ""}>
                            {list.map(wordRow)}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
                {selecting && (
                  <div class="selection-bar glass">
                    <button
                      class="quiet"
                      onClick={() => selectAll(visibleWords)}
                    >
                      {t(
                        visibleWords.every((w) => selection.has(w.key))
                          ? "Deselect All"
                          : "Select All",
                      )}
                    </button>
                    <button
                      class="pill glass"
                      disabled={!selection.size}
                      onClick={() => openAnki(undefined, true)}
                    >
                      <Icon name="download" />
                      {t("To Anki")}
                    </button>
                    <button
                      class="pill danger"
                      disabled={!selection.size}
                      onClick={requestDeleteWords}
                    >
                      <Icon name="trash" />
                      {t("Delete")} {selection.size || ""}
                    </button>
                  </div>
                )}
              </>
            )}
            {page === "search" && (
              <>
                <div class="search-controls">
                  <label class="search-field glass-group">
                    <Icon name="search" />
                    <input
                      ref={searchRef}
                      aria-label={t("Search your library")}
                      placeholder={t("Search your library")}
                      value={query}
                      onInput={(e) => {
                        setQuery(e.currentTarget.value);
                        setExpanded(new Set());
                      }}
                    />
                    {query && (
                      <button
                        class="round"
                        aria-label={t("Close")}
                        onClick={() => setQuery("")}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    )}
                  </label>
                  <div class="tabs" role="tablist" aria-label={t("Search")}>
                    {[
                      ["books", "Books"],
                      ["words", "Saved Words"],
                      ["text", "In Text"],
                    ].map(([value, label]) => (
                      <button
                        role="tab"
                        aria-selected={searchScope === value}
                        onClick={() => setSearchScope(value)}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>
                {!query.trim() ? (
                  <section class="recent-searches">
                    <div class="row between">
                      <h2>{t("Recent searches")}</h2>
                      {settings.recentSearches.length > 0 && (
                        <button
                          class="quiet"
                          aria-label={t("Clear recent searches")}
                          onClick={() =>
                            void run(() => saveSettings({ recentSearches: [] }))
                          }
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                    {settings.recentSearches.map((q) => (
                      <button onClick={() => setQuery(q)}>
                        <Icon name="search" size={18} />
                        {q}
                      </button>
                    ))}
                    <p class="muted">
                      {t(
                        "Search the German text of every book in your library.",
                      )}
                    </p>
                  </section>
                ) : searchScope === "books" ? (
                  <>
                    <p class="result-count">
                      {t("{0} books", { 0: foundBooks.length })}
                    </p>
                    <div class="search-result-list glass-group">
                      {foundBooks.map((b) => (
                        <button
                          class="book-result"
                          onContextMenu={(event) => openBookMenu(b, event)}
                          onClick={() => {
                            setDetails(b);
                            setOverlay("details");
                          }}
                        >
                          <BookCover manifest={b.manifest} small />
                          <span>
                            <strong>{marked(b.manifest.title)}</strong>
                            <small>
                              {marked(b.manifest.author)} · {b.manifest.level}
                            </small>
                          </span>
                          <small>{status(b)}</small>
                        </button>
                      ))}
                    </div>
                    {!foundBooks.length && (
                      <p class="muted">{t("No results")}</p>
                    )}
                  </>
                ) : searchScope === "words" ? (
                  <>
                    <p class="result-count">
                      {t("{0} saved words", { 0: foundWords.length })}
                    </p>
                    <div class="search-result-list glass-group">
                      {foundWords.map((w) => {
                        const b = books.find((b) => b.manifest.id === w.book);
                        return (
                          <button
                            class="saved-result"
                            onClick={() => b && go(b, w.at)}
                          >
                            <div class="mini-cover">{bookMini(w.book)}</div>
                            <span>
                              <strong>{marked(w.lemma)}</strong>{" "}
                              <small>[{w.ipa}]</small>
                              <p>{marked(w.ru)}</p>
                              <small>{marked(w.context)}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {!foundWords.length && (
                      <p class="muted">{t("No results")}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p class="result-count">
                      {t("{0} results in {1} books", {
                        0: foundText.reduce((n, x) => n + x.hits.length, 0),
                        1: foundText.length,
                      })}
                    </p>
                    {foundText.map(({ book: b, hits }) => (
                      <section class="text-results">
                        <div class="result-book-heading">
                          <BookCover manifest={b.manifest} small />
                          <div>
                            <h3>{b.manifest.title}</h3>
                            <small>
                              {t("{0} results", { 0: hits.length })}
                            </small>
                          </div>
                        </div>
                        <div class="glass-group">
                          {(expanded.has(b.manifest.id)
                            ? hits
                            : hits.slice(0, 3)
                          ).map((hit) => (
                            <button
                              class="text-hit"
                              onClick={() => go(b, hit.at, hit.offset)}
                            >
                              <span lang="de">{marked(hit.context)}</span>
                              <small>
                                {pageEntries(b.manifest.id)
                                  ? t("Page {0}", { 0: hit.page })
                                  : "…"}
                              </small>
                            </button>
                          ))}
                        </div>
                        {hits.length > 3 && !expanded.has(b.manifest.id) && (
                          <button
                            class="quiet accent"
                            onClick={() =>
                              setExpanded(
                                (prev) => new Set([...prev, b.manifest.id]),
                              )
                            }
                          >
                            {t("Show all {0} in this book", { 0: hits.length })}
                          </button>
                        )}
                      </section>
                    ))}
                    {!foundText.length && (
                      <p class="muted">{t("No results")}</p>
                    )}
                  </>
                )}
              </>
            )}
          </main>
          <nav class="bottom-nav glass" aria-label={t("Library")}>
            {navigation.map(([dest, label, icon]) => (
              <button
                class={page === dest ? "active" : ""}
                aria-current={page === dest ? "page" : undefined}
                onClick={() => navigate(dest)}
              >
                <Icon name={icon} />
                <span>{t(label)}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      {measured && (
        <PagedReader
          key={
            "measure-" +
            measured.manifest.id +
            "-" +
            signature(measured.manifest.id)
          }
          measureOnly
          manifest={measured.manifest}
          content={measured.content}
          settings={settings}
          mode={measureMode}
          at="1.1"
          offset={0}
          onPosition={() => {}}
          onSettings={() => {}}
          onMode={() => {}}
          onJump={() => {}}
          onComplete={() => {}}
          onListen={() => {}}
          busy={false}
          renderFragment={renderMeasure}
          wordPanel={null}
          onDismissWord={() => {}}
          onIndex={(entries) =>
            recordIndex(
              measured.manifest.id,
              signature(measured.manifest.id),
              entries,
            )
          }
        />
      )}
      {overlay === "collection-editor" && (
        <CollectionEditor
          collection={editingCollection}
          collections={collections}
          books={books}
          initialBooks={collectionBook ? [collectionBook.manifest.id] : []}
          onSave={saveCollection}
          onClose={() => setOverlay(collectionBook ? "move-collection" : "")}
          onReorder={shiftCollection}
          onDelete={() => deleteCollection()}
        />
      )}
      {overlay === "move-collection" && collectionBook && (
        <MoveBookDialog
          book={collectionBook}
          collections={collections}
          onClose={() => setOverlay("details")}
          onCreate={() => {
            setEditingCollection(null);
            setOverlay("collection-editor");
          }}
          onSave={async (target) => {
            await run(() => moveBook(collectionBook.manifest.id, target));
            setOverlay("details");
          }}
        />
      )}
      {overlay === "details" && details && (
        <Modal title={details.manifest.title} onClose={() => setOverlay("")}>
          <div class="book-details">
            <BookCover manifest={details.manifest} />
            <div>
              <small class="eyebrow">
                {details.manifest.level} ·{" "}
                {t(
                  details.manifest.annotation === "verified"
                    ? "Checked"
                    : "Auto text",
                )}{" "}
                ·{" "}
                {pageEntries(details.manifest.id)
                  ? t("{0} pages", {
                      0: pageEntries(details.manifest.id)!.length,
                    })
                  : "…"}
              </small>
              <h2>{details.manifest.title}</h2>
              <p>
                {details.manifest.author}
                {details.manifest.titleRu
                  ? " · " + details.manifest.titleRu
                  : ""}
              </p>
              <ProgressBar
                value={
                  progress.find((p) => p.book === details.manifest.id)
                    ?.percent || 0
                }
              />
              <small class="muted">
                {pageStatus(details)} ·{" "}
                {progress.find((p) => p.book === details.manifest.id)
                  ?.percent || 0}
                %
              </small>
              <div class="detail-actions">
                <button onClick={() => showBookWords(details.manifest.id)}>
                  {t("Words · {0}", {
                    0: saved.filter((w) => w.book === details.manifest.id)
                      .length,
                  })}
                </button>
                <button class="primary" onClick={() => go(details)}>
                  {t("Read")}
                </button>
              </div>
            </div>
          </div>
          <div class="group detail-more">
            <button
              onClick={() =>
                download(details.bytes, slug(details.manifest.title) + ".fbook")
              }
            >
              <Icon name="upload" />
              {t("Export .fbook file")}
            </button>
            <button onClick={() => openAnki(details.manifest.id)}>
              <Icon name="download" />
              {t("Book words to Anki")}
            </button>
            <button
              onClick={() => {
                setCollectionBook(details);
                setOverlay("move-collection");
              }}
            >
              <Icon name="collection" />
              {t("Move to Collection")}
            </button>
            {foldersForBook(details).map((folder) => (
              <button
                onClick={() =>
                  void run(() => removeFromFolder(details, folder.id))
                }
              >
                <Icon name="collection" />
                {t(
                  foldersForBook(details).length > 1
                    ? "Remove from folder {0}"
                    : "Remove from Folder",
                  { 0: folder.name },
                )}
              </button>
            ))}
            <button class="danger quiet" onClick={() => removeBook(details)}>
              {t("Remove from Library")}
            </button>
          </div>
        </Modal>
      )}
      {overlay === "add" && (
        <Modal title={t("Add Book")} onClose={() => setOverlay("")}>
          <div
            class="file-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const file = e.dataTransfer?.files[0];
              if (file) void inspectFile(file);
            }}
          >
            <div class="file-drop-icon">
              <Icon name="texts" size={26} />
            </div>
            <strong>{t("Drop an .fbook file here")}</strong>
            <small class="muted">{t("or choose it on disk")}</small>
            <button
              class="pill glass"
              disabled={fileBusy}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="plus" />
              {t("Choose File")}
            </button>
          </div>
          {fileError && (
            <p role="alert" class="error-text">
              {fileError}
            </p>
          )}
          {pending && (
            <>
              <h3 class="group-label">{t("File check")}</h3>
              <div class="import-preview group">
                <BookCover manifest={pending.manifest} small />
                <div>
                  <strong>{pending.manifest.title}</strong>
                  <small>
                    {pending.manifest.author} · {pending.manifest.level} ·{" "}
                    {t(
                      pending.manifest.annotation === "auto"
                        ? "Auto text"
                        : "Checked",
                    )}
                  </small>
                  {[
                    "This is an .fbook file",
                    "Archive intact, checksums match",
                    "Format version 2 — supported",
                  ].map((label) => (
                    <p>
                      <Icon name="check" size={15} />
                      {t(label)}
                    </p>
                  ))}
                  <p
                    class={
                      books.some((b) => b.manifest.id === pending.manifest.id)
                        ? "error-text"
                        : ""
                    }
                  >
                    <Icon
                      name={
                        books.some((b) => b.manifest.id === pending.manifest.id)
                          ? "close"
                          : "check"
                      }
                      size={15}
                    />
                    {t(
                      books.some((b) => b.manifest.id === pending.manifest.id)
                        ? "Already in your library"
                        : "Not in your library yet",
                    )}
                  </p>
                </div>
              </div>
              <button
                class="primary wide"
                disabled={
                  books.some((b) => b.manifest.id === pending.manifest.id) ||
                  fileBusy
                }
                onClick={() => void run(addPending)}
              >
                {t("Add to Library")}
              </button>
            </>
          )}
          <p class="footnote">
            {t(
              "Books are stored only on this device. Keep copies of your .fbook files too.",
            )}
          </p>
        </Modal>
      )}
      {overlay === "anki" && (
        <Modal title={t("Export to Anki")} onClose={() => setOverlay("")}>
          <h3 class="group-label">{t("Which words")}</h3>
          <div class="group anki-options">
            {[
              ["new", "New only", newWords.length],
              ["all", "All words", saved.length],
              ["book", "From one book", null],
              ...(selection.size
                ? [["selected", "Selected words", selection.size]]
                : []),
            ].map(([value, label, count]) => (
              <button
                aria-pressed={ankiScope === value}
                onClick={() => setAnkiScope(String(value))}
              >
                <span>{t(String(label))}</span>
                <small>{count}</small>
                {ankiScope === value && <Icon name="check" size={17} />}
              </button>
            ))}
            {ankiScope === "book" && (
              <label class="setting-row">
                {t("Book")}
                <select
                  value={ankiBook}
                  aria-label={t("Book")}
                  onChange={(e) => setAnkiBook(e.currentTarget.value)}
                >
                  <option value="all">—</option>
                  {[...new Set(saved.map((w) => w.book))].map((id) => (
                    <option value={id}>
                      {books.find((b) => b.manifest.id === id)?.manifest
                        .title || t("Unknown book")}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <h3 class="group-label">{t("Card")}</h3>
          <div class="group">
            <Toggle checked={ankiIpa} onChange={setAnkiIpa}>
              {t("IPA on the front")}
            </Toggle>
            <Toggle checked={ankiContext} onChange={setAnkiContext}>
              {t("Book sentence on the back")}
            </Toggle>
            <label class="setting-row">
              {t("Deck")}
              <input
                aria-label={t("Deck")}
                value={settings.deck}
                onInput={(e) =>
                  void run(() => saveSettings({ deck: e.currentTarget.value }))
                }
              />
            </label>
          </div>
          <p class="footnote">
            {t(
              "Import this text file in Anki with File → Import. Exported words are marked to avoid duplicates.",
            )}
          </p>
          <button
            class="primary wide"
            disabled={!ankiCount}
            onClick={() => void run(exportAnki)}
          >
            <Icon name="download" />
            {t("Download Anki file")} · {ankiCount}
          </button>
          {!ankiCount && <p class="footnote">{t("No words to export")}</p>}
        </Modal>
      )}
      {overlay === "settings" && (
        <Modal title={t("Settings")} onClose={() => setOverlay("")}>
          <h3 class="group-label">{t("General")}</h3>
          <div class="group">
            <button class="setting-row" onClick={() => setOverlay("language")}>
              <span>{t("Language")}</span>
              <span>
                {settings.language === "en"
                  ? "English"
                  : settings.language === "ru"
                    ? "Русский"
                    : "Deutsch"}{" "}
                <Icon name="next" size={15} />
              </span>
            </button>
          </div>
          <h3 class="group-label">{t("Reading")}</h3>
          <div class="group">
            <button
              class="setting-row"
              onClick={() => setOverlay("appearance")}
            >
              <span>{t("Themes & Voice")}</span>
              <span>
                Aa <Icon name="next" size={15} />
              </span>
            </button>
            <Toggle
              checked={settings.showClean}
              onChange={(showClean) =>
                void run(() => saveSettings({ showClean }))
              }
            >
              {t("Repeat without hints")}
            </Toggle>
            <label class="setting-row">
              {t("Default mode")}
              <select
                aria-label={t("Default mode")}
                value={settings.defaultMode}
                onChange={(e) =>
                  void run(() =>
                    saveSettings({
                      defaultMode: e.currentTarget
                        .value as Settings["defaultMode"],
                    }),
                  )
                }
              >
                {[
                  ["frank", "Frank"],
                  ["clean", "Clean"],
                  ["parallel", "Parallel"],
                ].map(([v, label]) => (
                  <option value={v}>{t(label)}</option>
                ))}
              </select>
            </label>
          </div>
          <h3 class="group-label">Anki</h3>
          <div class="group">
            <label class="setting-row">
              {t("Deck")}
              <input
                aria-label={t("Deck")}
                value={settings.deck}
                onInput={(e) =>
                  void run(() => saveSettings({ deck: e.currentTarget.value }))
                }
              />
            </label>
            <Toggle
              checked={settings.markExported}
              onChange={(markExported) =>
                void run(() => saveSettings({ markExported }))
              }
            >
              {t("Mark exported words")}
            </Toggle>
          </div>
          <h3 class="group-label">{t("Data")}</h3>
          <div class="group data-actions">
            <button onClick={() => void run(() => exportBackup(true))}>
              <Icon name="upload" />
              <span>
                {t("Back Up")}
                <small>
                  {t("Books, progress, words and settings in one file")}
                </small>
              </span>
            </button>
            <button onClick={() => backupRef.current?.click()}>
              <Icon name="download" />
              {t("Restore from Backup")}
            </button>
            <div class="setting-row">
              {t("Books on device")}
              <span class="muted">{books.length}</span>
            </div>
          </div>
          <button
            class="wide danger group"
            onClick={() =>
              setConfirm({
                title: t("Erase all local data?"),
                text: t(
                  "This removes your books, progress, saved words and settings. Download a backup first.",
                ),
                action: async () => {
                  await store.clearAll();
                  setBooks([]);
                  setCollections([]);
                  setCollectionFilter("");
                  setProgress([]);
                  setSaved([]);
                  setIndexCache({});
                  settingsRef.current = { ...store.defaults };
                  setSettings({ ...store.defaults });
                  setSelecting(false);
                  setSelection(new Set());
                  setOverlay("");
                  location.hash = "/home";
                },
              })
            }
          >
            {t("Erase All Data")}
          </button>
          <p class="footnote">
            {t("Books, progress and words stay on this device only.")}
          </p>
        </Modal>
      )}
      {overlay === "language" && (
        <Modal title={t("Language")} onClose={() => setOverlay("settings")}>
          <h3 class="group-label">{t("App language")}</h3>
          <div class="group language-options">
            {[
              ["en", "English", ""],
              ["ru", "Русский", "Russian"],
              ["de", "Deutsch", "German"],
            ].map(([value, label, desc]) => (
              <button
                aria-pressed={settings.language === value}
                onClick={() =>
                  void run(() =>
                    saveSettings({ language: value as Settings["language"] }),
                  )
                }
              >
                <span>
                  {label}
                  <small>{desc}</small>
                </span>
                {settings.language === value && <Icon name="check" />}
              </button>
            ))}
          </div>
          <p class="footnote">
            {t(
              "Menus switch at once. Hints and translations stay in the book’s language.",
            )}
          </p>
        </Modal>
      )}
      {overlay === "appearance" && (
        <Modal
          title={t("Themes & Voice")}
          onClose={() => setOverlay("settings")}
        >
          <ThemesPanel
            settings={settings}
            onChange={(p) => void run(() => saveSettings(p))}
            onClose={() => setOverlay("settings")}
          />
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.text}</p>
          <div class="row between">
            <button onClick={() => setConfirm(null)}>{t("Cancel")}</button>
            <button
              class="primary"
              onClick={() =>
                void run(async () => {
                  await confirm.action();
                  setConfirm(null);
                })
              }
            >
              {t("Done")}
            </button>
          </div>
        </Modal>
      )}
      {folderMenu && (
        <FolderContextMenu
          target={folderMenu}
          onClose={() => setFolderMenu(null)}
          onDelete={() => {
            const target = folderMenu;
            setFolderMenu(null);
            if (target.kind === "collection")
              deleteCollection(collections.find((c) => c.id === target.id));
            else deleteLibraryFolder(target.id);
          }}
        />
      )}
      {bookMenu && (
        <ContextMenu
          x={bookMenu.x}
          y={bookMenu.y}
          label={t("Book options")}
          className="book-context-menu"
          onClose={() => setBookMenu(null)}
        >
          <button
            role="menuitem"
            class="quiet"
            onClick={() => {
              const book = bookMenu.book;
              setBookMenu(null);
              go(book);
            }}
          >
            <Icon name="book" size={16} />
            {t("Read")}
          </button>
          <button
            role="menuitem"
            class="quiet"
            onClick={() => {
              const book = bookMenu.book;
              setBookMenu(null);
              showBookWords(book.manifest.id);
            }}
          >
            <Icon name="words" size={16} />
            {t("Words · {0}", {
              0: saved.filter((w) => w.book === bookMenu.book.manifest.id)
                .length,
            })}
          </button>
          <button
            role="menuitem"
            class="quiet"
            onClick={() => {
              download(
                bookMenu.book.bytes,
                slug(bookMenu.book.manifest.title) + ".fbook",
              );
              setBookMenu(null);
            }}
          >
            <Icon name="upload" size={16} />
            {t("Export .fbook file")}
          </button>
          <button
            role="menuitem"
            class="quiet"
            onClick={() => {
              openAnki(bookMenu.book.manifest.id);
              setBookMenu(null);
            }}
          >
            <Icon name="download" size={16} />
            {t("Book words to Anki")}
          </button>
          <button
            role="menuitem"
            class="quiet"
            onClick={() => {
              setDetails(bookMenu.book);
              setCollectionBook(bookMenu.book);
              setOverlay("move-collection");
              setBookMenu(null);
            }}
          >
            <Icon name="collection" size={16} />
            {t("Move to Collection")}
          </button>
          {foldersForBook(bookMenu.book, bookMenu.folder).map((folder) => (
            <button
              role="menuitem"
              class="quiet"
              onClick={() => {
                const book = bookMenu.book;
                setBookMenu(null);
                void run(() => removeFromFolder(book, folder.id));
              }}
            >
              <Icon name="collection" size={16} />
              {t(
                foldersForBook(bookMenu.book, bookMenu.folder).length > 1
                  ? "Remove from folder {0}"
                  : "Remove from Folder",
                { 0: folder.name },
              )}
            </button>
          ))}
          {!foldersForBook(bookMenu.book, bookMenu.folder).length && (
            <button role="menuitem" class="quiet" disabled>
              <Icon name="collection" size={16} />
              {t("Remove from Folder")}
            </button>
          )}
          <button
            role="menuitem"
            class="quiet danger"
            onClick={() => {
              removeBook(bookMenu.book);
              setBookMenu(null);
            }}
          >
            <Icon name="trash" size={16} />
            {t("Remove from Library")}
          </button>
        </ContextMenu>
      )}
      {message && (
        <div
          class={"toast" + (message.error ? " error" : "")}
          role={message.error ? "alert" : "status"}
        >
          <span>{message.text}</span>
          <button aria-label={t("Close")} onClick={() => setMessage(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </LocaleContext.Provider>
  );
}
const root = document.getElementById("app")!;
root.replaceChildren();
render(<App />, root);
