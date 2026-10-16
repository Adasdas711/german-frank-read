import { render } from "preact";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "preact/hooks";
import {
  readBook,
  plain,
  sentences,
  addresses,
  locate,
  words as splitWords,
  download,
  slug,
  type Book,
  type Content,
  type Chunk,
} from "./core";
import * as store from "./storage";
import type { Progress, Settings, SavedWord } from "./storage";
import { Icon, Modal, Toggle, ProgressBar } from "./ui";
import { BookFlow, type ReadingFlow } from "./book-flow";
import { PagedReader } from "./paged-reader";
import { BookCover } from "./book-cover";
import { FocusReader } from "./focus-reader";
import { createTranslator, translateMessage, LocaleContext } from "./i18n";
import { speak, stop, unlockAudio } from "./voice";
import {
  exportBackup,
  parseBackup,
  importBackup,
  exportWords,
} from "./transfer";
import demos from "./demos.json";
import { ensureDemos } from "./demo-library";
import "./style.css";
import "./books.css";
const nav = [
  ["home", "Читаю сейчас", "book"],
  ["texts", "Тексты", "texts"],
  ["words", "Слова", "words"],
];
const href = (page: string) => "#/" + page;
function App() {
  const [startupError, setStartupError] = useState<string | null>(null);
  const [ready, setReady] = useState(false),
    [books, setBooks] = useState<Book[]>([]),
    [progress, setProgress] = useState<Progress[]>([]),
    [saved, setSaved] = useState<SavedWord[]>([]),
    [settings, setSettings] = useState<Settings>(() => {
      const cached = document.documentElement.dataset.theme;
      return {
        ...store.defaults,
        language: document.documentElement.lang === "de" ? "de" : "ru",
        theme: ["light", "dark", "system"].includes(cached) ? cached : "system",
      };
    }),
    [route, setRoute] = useState(location.hash.slice(2) || "home");
  const [message, setMessage] = useState<{
      text: string;
      error?: boolean;
    } | null>(null),
    [active, setActive] = useState<{
      manifest: Book["manifest"];
      content: Content;
      bytes: Uint8Array;
    } | null>(null),
    [selected, setSelected] = useState<{
      form: string;
      context: string;
      hint: string;
      at: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [focusMode, setFocusMode] = useState(false),
    [tocOpen, setTocOpen] = useState(false),
    [sizeOpen, setSizeOpen] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      text: string;
      action: () => Promise<void>;
      cancel?: () => void;
    } | null>(null),
    [query, setQuery] = useState(""),
    [wordTab, setWordTab] = useState("all"),
    [bookFilter, setBookFilter] = useState("all"),
    [onlyNew, setOnlyNew] = useState(true),
    [withBooks, setWithBooks] = useState(false),
    [usage, setUsage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null),
    backupRef = useRef<HTMLInputElement>(null),
    wordRef = useRef<HTMLElement>(null),
    focusEntryRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const commitProgress = async (value: Progress) => {
    progressRef.current = [
      ...progressRef.current.filter((p) => p.book !== value.book),
      value,
    ];
    setProgress(progressRef.current);
    await store.put("progress", value.book, value);
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const t = createTranslator(settings.language);
  const notify = (text: string, error = false) =>
    setMessage({ text: translateMessage(settings.language, text), error });
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const refresh = async () => {
    const [b, p, w, s] = await Promise.all([
      store.all<Book>("books"),
      store.all<Progress>("progress"),
      store.all<SavedWord>("words"),
      store.get<Settings>("settings", "app"),
    ]);
    setBooks(b);
    setProgress(p);
    setSaved(w);
    const preferences = store.checkedSettings(s || store.defaults);
    if (!s || s.readingDefaultsVersion !== 1 || s.bookStyleVersion !== 1)
      await store.put("settings", "app", preferences);
    setSettings(preferences);
  };
  useEffect(() => {
    void (async () => {
      await store.put("settings", "probe", true);
      await store.remove("settings", "probe");
      await ensureDemos(demos);
      await refresh();
      setReady(true);
      window.__frankaBoot?.finish();
      void navigator.storage?.persist?.().catch(() => {});
    })().catch((e) => {
      setStartupError(e instanceof Error ? e.message : String(e));
      window.__frankaBoot?.finish();
    });
    const change = () => {
      setRoute(location.hash.slice(2) || "home");
      setSelected(null);
      stop();
      if (
        !(
          location.hash.startsWith("#/read/") &&
          settingsRef.current.readingFlow === "continuous"
        )
      )
        window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = settings.language;
    document.title = t("Немецкий по Франку");
    try {
      localStorage.setItem("franka-language", settings.language);
    } catch {}
    root.dataset.theme = settings.theme;
    try {
      localStorage.setItem("franka-theme", settings.theme);
    } catch {
      /* IndexedDB remains the source of truth. */
    }
    const media = matchMedia("(prefers-color-scheme: dark)");
    const updateBrowserColor = () => {
      const meta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]',
      );
      if (meta) meta.content = getComputedStyle(root).backgroundColor;
    };
    updateBrowserColor();
    media.addEventListener("change", updateBrowserColor);
    root.style.setProperty("--size", settings.fontSize + "px");
    root.style.setProperty(
      "--reading",
      settings.font === "serif"
        ? "'Literata', Georgia, serif"
        : settings.font === "sans"
          ? "'Golos Text', sans-serif"
          : "system-ui, sans-serif",
    );
    return () => media.removeEventListener("change", updateBrowserColor);
  }, [settings]);
  const saveSettings = async (p: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...p };
    settingsRef.current = next;
    setSettings(next);
    await store.put("settings", "app", next);
  };
  const parts = route.split("/"),
    page = parts[0],
    bookId = parts[1],
    at = parts[2] || "1.1",
    mode = parts[3] || "frank";
  useEffect(() => {
    if (page !== "read") {
      setActive(null);
      return;
    }
    const b = books.find((b) => b.manifest.id === bookId);
    if (!b) {
      if (ready)
        notify(t("Книга не найдена. Загрузите её в разделе «Тексты»."), true);
      setActive(null);
      return;
    }
    void run(async () => {
      const data = readBook(b.bytes);
      setActive(data);
    });
  }, [page, bookId, books]);
  useEffect(() => {
    if (page !== "read" || !active || active.manifest.id !== bookId) return;
    const data = active;
    void run(async () => {
      if (!addresses(data.content).includes(at)) {
        location.hash = `/read/${bookId}/1.1/frank`;
        return;
      }
      if (
        !["frank", "clean", "parallel"].includes(mode) ||
        (mode === "parallel" && !data.content.t)
      ) {
        location.hash = `/read/${bookId}/${at}/frank`;
        return;
      }
      const index = addresses(data.content).indexOf(at),
        old = progressRef.current.find((p) => p.book === bookId),
        p = {
          book: bookId,
          at,
          ...(old?.at === at && Number.isFinite(old.offset)
            ? { offset: old.offset }
            : {}),
          percent:
            old?.at === at
              ? old.percent
              : Math.round((index / data.manifest.stats.fragments) * 100),
          mode,
          updatedAt: new Date().toISOString(),
        };
      await commitProgress(p);
      if (settingsRef.current.current !== bookId)
        await saveSettings({ current: bookId });
    });
  }, [page, bookId, at, mode, active]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), message.error ? 12000 : 5000);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    if (page !== "settings") return;
    void navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(((e.usage || 0) / 1024 / 1024).toFixed(1)))
      .catch(() => {});
  }, [page]);
  function go(book: Book) {
    const p = progress.find((p) => p.book === book.manifest.id);
    location.hash = `/read/${book.manifest.id}/${p?.at || "1.1"}/${p?.mode || "frank"}`;
  }
  async function importFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      try {
        if (file.size > 32 * 1024 * 1024)
          throw Error(t("Файл превышает 32 МБ."));
        const bytes = new Uint8Array(await file.arrayBuffer()),
          b = readBook(bytes),
          old = await store.get<Book>("books", b.manifest.id);
        if (old) {
          if (old.manifest.revision >= b.manifest.revision) {
            notify(t("Эта книга уже есть: ") + b.manifest.title);
            continue;
          }
          await new Promise<void>((resolve) =>
            setConfirm({
              title: t("Обновить книгу?"),
              cancel: resolve,
              text: t("{0}, версия {1}. Прогресс и слова сохранятся.", {
                0: b.manifest.title,
                1: b.manifest.revision,
              }),
              action: async () => {
                await store.put("books", b.manifest.id, {
                  manifest: b.manifest,
                  bytes,
                });
                await refresh();
                notify(t("Книга обновлена"));
                resolve();
              },
            }),
          );
        } else {
          await store.put("books", b.manifest.id, {
            manifest: b.manifest,
            bytes,
          });
          await refresh();
          notify(t("Книга добавлена: ") + b.manifest.title);
        }
      } catch (e) {
        notify(file.name + ": " + (e as Error).message, true);
      }
    }
  }
  useEffect(() => {
    const drag = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        void importFiles(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", drag);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", drag);
      document.removeEventListener("drop", drop);
    };
  }, [books]);
  const index = active ? addresses(active.content).indexOf(at) : 0,
    total = active?.manifest.stats.fragments || 0;
  const fragment = active ? locate(active.content, at) : null;
  useEffect(() => {
    if (page !== "read") setFocusMode(false);
  }, [page]);
  const enterFocus = () => {
    stop();
    setSelected(null);
    setMessage(null);
    setFocusMode(true);
    window.scrollTo(0, 0);
  };
  const exitFocus = () => {
    setFocusMode(false);
    setTimeout(() => focusEntryRef.current?.focus({ preventScroll: true }), 0);
  };
  const bookmarkScroll = (address: string) => {
    const next = `read/${bookId}/${address}/${mode}`;
    history.replaceState(null, "", "#/" + next);
    setRoute(next);
  };
  const changeFlow = (flow: ReadingFlow) => {
    setSelected(null);
    setFocusMode(false);
    void run(() => saveSettings({ readingFlow: flow }));
  };
  const navigate = (delta: number) => {
    if (!active) return;
    const list = addresses(active.content),
      next = list[index + delta];
    if (next) {
      setSelected(null);
      location.hash = `/read/${bookId}/${next}/${mode}`;
    } else if (delta > 0 && index + delta >= list.length) {
      void run(async () => {
        const p = {
          book: bookId,
          at: list[list.length - 1],
          percent: 100,
          mode,
          updatedAt: new Date().toISOString(),
        };
        await store.put("progress", bookId, p);
        setProgress((prev) => [...prev.filter((p) => p.book !== bookId), p]);
        notify(t("Книга прочитана. Можно вернуться к любому отрывку."));
        location.hash = "/home";
      });
    }
  };
  useLayoutEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        page !== "read" ||
        focusMode ||
        settings.readingFlow === "pages" ||
        confirm ||
        sizeOpen ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [active, at, mode, confirm, sizeOpen, focusMode, settings.readingFlow]);
  async function listen(text: string, ipa?: string) {
    unlockAudio();
    setBusy(true);
    try {
      await speak(text, ipa, settings);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function listenFragment() {
    if (!active || !fragment) return;
    const overrides = active.content.x?.[at] || {},
      text = plain(fragment.chunks);
    let ipa = "";
    for (const part of text.split(/([\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*)/gu)) {
      if (splitWords(part).length) {
        ipa += (overrides[part] || active.content.f[part]?.[0] || "") + " ";
      } else
        ipa += part
          .replace(/[,;:]/g, " | ")
          .replace(/[.!?]/g, " || ")
          .replace(/[^|\s]/g, " ");
    }
    await listen(text, ipa);
  }
  function cleanText(
    text: string,
    context: string,
    hint: string,
    address = at,
    baseOffset = 0,
  ) {
    let position = baseOffset;
    return text
      .split(/([\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*)/gu)
      .map((part, i) => {
        const offset = position;
        position += part.length;
        return splitWords(part).length ? (
          <button
            key={i}
            lang="de"
            class={"word" + (selected?.form === part ? " chosen" : "")}
            data-book-char={offset}
            onClick={() =>
              setSelected({ form: part, context, hint, at: address })
            }
          >
            {part}
          </button>
        ) : (
          part
        );
      });
  }

  function textBlock(
    chunks: Chunk[],
    hints = false,
    address = at,
    startOffset = 0,
  ) {
    let position = startOffset;
    return chunks.map((c) => {
      const offset = position;
      position += typeof c === "string" ? c.length : c[0].length;
      if (typeof c === "string")
        return cleanText(c, plain(chunks), "", address, offset);
      const hint =
        active!.content.g[c[1]] +
        (c[2] != null ? " = " + active!.content.g[c[2]] : "");
      return (
        <span class={c[3] === 1 ? "uncertain" : ""}>
          {cleanText(c[0], c[0], hint, address, offset)}
          {hints && (
            <>
              {" "}
              <span class="hint" lang="ru">
                ({hint})
              </span>
            </>
          )}
        </span>
      );
    });
  }
  const renderBookFragment = useCallback(
    (chunks, address) => {
      const [ci, fi] = address.split(".").map((n) => +n - 1);
      const sourceText = plain(chunks),
        lines = sentences(sourceText);
      let cursor = 0;
      const starts = lines.map((line) => {
        const start = sourceText.indexOf(line, cursor);
        cursor = start + line.length;
        return start;
      });
      return mode === "parallel" ? (
        <section class="reading-panel" aria-label={t("Параллельный перевод")}>
          {(active.content.t?.[ci]?.[fi] || []).map((translation, i) => (
            <div class="parallel-row">
              <p lang="de">
                {cleanText(
                  sentences(plain(chunks))[i] || "",
                  sentences(plain(chunks))[i] || "",
                  translation,
                  address,
                  starts[i] || 0,
                )}
              </p>
              <p class="translation" lang="ru">
                {translation}
              </p>
            </div>
          ))}
        </section>
      ) : (
        <div class="reading-columns">
          {mode === "frank" && (
            <section class="reading-panel" aria-label={t("С подсказками")}>
              {settings.showClean && (
                <div class="eyebrow">{t("С подсказками")}</div>
              )}
              <p lang="de">{textBlock(chunks, true, address)}</p>
            </section>
          )}
          {(mode === "clean" || settings.showClean) && (
            <section class="reading-panel" aria-label={t("Без подсказок")}>
              {mode === "frank" && (
                <div class="eyebrow">{t("Без подсказок")}</div>
              )}
              <p lang="de">
                {textBlock(
                  chunks,
                  false,
                  address,
                  mode === "frank" ? plain(chunks).length + 1 : 0,
                )}
              </p>
            </section>
          )}
        </div>
      );
    },
    [active, mode, settings.showClean, selected, settings.language],
  );
  const selForm = selected && active?.content.f[selected.form],
    lemma = selForm?.[1] != null ? active?.content.l[selForm[1]] : null,
    selIpa = selected
      ? active?.content.x?.[selected.at]?.[selected.form] || selForm?.[0] || ""
      : "";
  const selKey = selected
    ? [bookId, lemma?.[0] || selected.form, selected.at].join("|")
    : "";
  const isSaved = saved.some((w) => w.key === selKey);
  async function saveWord() {
    if (!selected) return;
    const w: SavedWord = {
      key: selKey,
      book: bookId,
      at: selected.at,
      lemma: lemma?.[0] || selected.form,
      ru:
        lemma?.[1] || selected.hint || t("Перевод отсутствует в словаре книги"),
      ipa: selIpa,
      context: selected.context,
      form: selected.form,
      savedAt: new Date().toISOString(),
      inAnki: false,
    };
    await store.put("words", w.key, w);
    setSaved((prev) => [...prev.filter((x) => x.key !== w.key), w]);
    notify(t("Слово сохранено"));
  }
  const current =
      books.find((b) => b.manifest.id === settings.current) || books[0],
    cp = current
      ? progress.find((p) => p.book === current.manifest.id)
      : undefined;
  const filteredWords = saved
    .filter(
      (w) =>
        (bookFilter === "all" || w.book === bookFilter) &&
        [w.lemma, w.ru, w.context]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const exportList = async (anki: boolean) => {
    const list = exportWords(filteredWords, books, anki, onlyNew);
    if (anki) {
      for (const w of list)
        await store.put("words", w.key, { ...w, inAnki: true });
      setSaved((prev) =>
        prev.map((w) =>
          list.some((x) => x.key === w.key) ? { ...w, inAnki: true } : w,
        ),
      );
    }
    notify(t("Файл скачан") + (anki ? t(". Слова отмечены «в Anki».") : ""));
  };
  function bookCard(b: Book) {
    const m = b.manifest,
      p = progress.find((p) => p.book === m.id);
    return (
      <article class="panel book-card" key={m.id}>
        <button
          class="cover-open"
          aria-label={t("Читать ") + m.title}
          onClick={() => go(b)}
        >
          <BookCover manifest={m} />
        </button>
        <div class="row between">
          <span class="badge">{m.level}</span>
          <span
            class={"tag " + (m.annotation === "verified" ? "verified" : "")}
          >
            <span class="dot" />
            {m.annotation === "verified" ? t("Проверено") : t("Автотекст")}
          </span>
        </div>
        <h3>{m.title}</h3>
        <p>
          {m.author}
          {m.titleRu ? " · " + m.titleRu : ""}
        </p>
        <div>
          <ProgressBar value={p?.percent || 0} />
          <div class="row between">
            <small class="muted">
              {p?.percent || 0}
              {t("% прочитано · ")}
              {m.stats.fragments} {t(" отр.")}
            </small>
          </div>
        </div>
        <div class="row">
          <button
            class="primary grow"
            aria-label={(p ? t("Продолжить ") : t("Читать ")) + m.title}
            onClick={() => go(b)}
          >
            {p ? t("Продолжить") : t("Читать")}
          </button>
          <button
            class="icon"
            aria-label={t("Скачать ") + m.title}
            onClick={() => download(b.bytes, slug(m.title) + ".fbook")}
          >
            <Icon name="download" />
          </button>
          <button
            class="icon"
            aria-label={t("Удалить ") + m.title}
            onClick={() =>
              setConfirm({
                title: t("Удалить книгу?"),
                text: t(
                  "Удалится только файл книги. Сохранённые слова и прогресс останутся.",
                ),
                action: async () => {
                  await store.remove("books", m.id);
                  await refresh();
                  notify(t("Книга удалена"));
                },
              })
            }
          >
            <Icon name="trash" />
          </button>
        </div>
      </article>
    );
  }
  const wordPanel = selected ? (
    <aside
      class="panel word-panel"
      ref={wordRef}
      aria-label={t("Подсказка к слову")}
    >
      <div class="row between">
        <div class="grow">
          <h2 lang="de">{lemma?.[0] || selected.form}</h2>
          <small class="muted">
            {t("В тексте: ")}
            {selected.form}
          </small>
        </div>
        <button
          class="icon close-word"
          aria-label={t("Закрыть подсказку")}
          onClick={() => setSelected(null)}
        >
          <Icon name="close" />
        </button>
      </div>
      <div class="row">
        <span class="ipa">[{selIpa}]</span>
        <button
          class="icon"
          aria-label={t("Произнести слово")}
          disabled={busy}
          onClick={() => void listen(selected.form, selIpa)}
        >
          <Icon name="sound" />
        </button>
      </div>
      <strong>{lemma?.[1] || t("Нет отдельного перевода")}</strong>
      <div class="context">
        <i lang="de">{selected.context}</i>
        {selected.hint && (
          <div style={{ color: "var(--teal)" }}>{selected.hint}</div>
        )}
      </div>
      <button
        class="primary"
        disabled={isSaved}
        onClick={() => void run(saveWord)}
      >
        {isSaved ? (
          <>
            <Icon name="check" />
            {t("Слово сохранено")}
          </>
        ) : (
          t("В мои слова")
        )}
      </button>
    </aside>
  ) : null;
  if (!ready)
    return (
      <>
        <main class="page">
          <h1>{t("Немецкий по Франку")}</h1>
          <p>
            {startupError
              ? t(
                  "Не удалось открыть хранилище браузера. Разрешите локальное хранение данных или откройте файл в Chrome / Edge.",
                )
              : t("Открываем библиотеку…")}
          </p>
          {startupError && (
            <>
              <div role="alert">
                {translateMessage(settings.language, startupError)}
              </div>
              <p>
                {t(
                  "Данные не удалены. Проверьте разрешение браузера на хранение данных.",
                )}
              </p>
              <button onClick={() => location.reload()}>
                {t("Повторить запуск")}
              </button>
            </>
          )}
        </main>
      </>
    );
  return (
    <LocaleContext.Provider value={settings.language}>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".fbook"
        multiple
        onChange={(e) => {
          if (e.currentTarget.files) void importFiles(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={backupRef}
        type="file"
        hidden
        accept=".json,.zip"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file)
            void run(async () => {
              if (file.size > 32 * 1024 * 1024)
                throw Error(t("Копия превышает 32 МБ."));
              const parsed = parseBackup(
                new Uint8Array(await file.arrayBuffer()),
              );
              setConfirm({
                title: t("Импорт данных"),
                text: t(
                  "Добавить слова ({0}) и прогресс ({1})? Более свежий прогресс сохранится.",
                  {
                    0: parsed.data.words.length,
                    1: parsed.data.progress.length,
                  },
                ),
                action: async () => {
                  const replace = window.confirm(
                    t(
                      "Заменить также настройки из резервной копии? «Отмена» сохранит текущие настройки.",
                    ),
                  );
                  await importBackup(parsed, replace);
                  await refresh();
                  notify(t("Резервная копия импортирована"));
                },
              });
            });
          e.currentTarget.value = "";
        }}
      />
      {page === "read" && active && fragment ? (
        settings.readingFlow === "pages" ? (
          <PagedReader
            manifest={active.manifest}
            content={active.content}
            settings={settings}
            mode={mode}
            at={at}
            offset={
              progress.find((p) => p.book === bookId && p.at === at)?.offset ||
              0
            }
            onPosition={(address, offset) => {
              const list = addresses(active.content),
                index = list.indexOf(address);
              void run(() =>
                commitProgress({
                  book: bookId,
                  at: address,
                  offset,
                  mode,
                  percent: Math.round(
                    ((index +
                      Math.min(
                        1,
                        offset /
                          Math.max(
                            1,
                            plain(locate(active.content, address).chunks)
                              .length,
                          ),
                      )) /
                      list.length) *
                      100,
                  ),
                  updatedAt: new Date().toISOString(),
                }),
              );
              bookmarkScroll(address);
            }}
            onSettings={(changes) => {
              if (changes.readingFlow) changeFlow(changes.readingFlow);
              else void run(() => saveSettings(changes));
            }}
            onMode={(next) => {
              setSelected(null);
              location.hash = `/read/${bookId}/${at}/${next}`;
            }}
            onJump={(address) => {
              setSelected(null);
              void run(() =>
                commitProgress({
                  book: bookId,
                  at: address,
                  offset: 0,
                  percent: Math.round(
                    (addresses(active.content).indexOf(address) / total) * 100,
                  ),
                  mode,
                  updatedAt: new Date().toISOString(),
                }),
              );
              location.hash = `/read/${bookId}/${address}/${mode}`;
            }}
            onComplete={() => navigate(total - index)}
            onListen={() => void listenFragment()}
            busy={busy}
            renderFragment={renderBookFragment}
            wordPanel={wordPanel}
            onDismissWord={() => setSelected(null)}
          />
        ) : focusMode ? (
          <FocusReader
            content={active.content}
            chapters={active.manifest.chapters.map((c) => c[0])}
            flow={settings.readingFlow}
            onPosition={bookmarkScroll}
            layoutKey={[
              mode,
              settings.showClean,
              settings.font,
              settings.fontSize,
            ].join("-")}
            at={at}
            mode={mode}
            showClean={settings.showClean}
            index={index}
            total={total}
            navigate={navigate}
            onExit={exitFocus}
          />
        ) : (
          <>
            <header class="app-header reader-header">
              <div class="header-inner">
                <a class="back btn" href={href("home")}>
                  <Icon name="back" />
                  {t("Назад")}
                </a>
                <div class="reader-title">
                  <h1>{active.manifest.title}</h1>
                  <small>
                    {active.manifest.author} · {active.manifest.level}{" "}
                    {t(" · отрывок")} {index + 1} {t(" из ")}
                    {total}
                  </small>
                </div>
                <div class="tabs" role="tablist" aria-label={t("Режим чтения")}>
                  {[
                    ["frank", t("Франк")],
                    ["parallel", t("Паралель")],
                    ["clean", t("Оригинал")],
                  ].map(([v, label]) => (
                    <button
                      role="tab"
                      aria-selected={mode === v}
                      disabled={v === "parallel" && !active.content.t}
                      title={
                        v === "parallel" && !active.content.t
                          ? t("В книге нет перевода")
                          : label
                      }
                      onClick={() =>
                        (location.hash = `/read/${bookId}/${at}/${v}`)
                      }
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
                <button
                  class="focus-entry"
                  ref={focusEntryRef}
                  aria-label={t("Режим чтения")}
                  title={t("Режим чтения — только текст")}
                  onClick={enterFocus}
                >
                  <Icon name="book" />
                  <span>{t("Только текст")}</span>
                </button>
                <button
                  class="icon serif"
                  aria-label={t("Размер шрифта")}
                  onClick={() => setSizeOpen(true)}
                >
                  Aa
                </button>
              </div>
              <div class="row reader-tools">
                <button
                  class="icon toc-toggle"
                  aria-controls="reader-fragments"
                  aria-expanded={tocOpen}
                  aria-label={
                    tocOpen ? t("Скрыть отрывки") : t("Показать отрывки")
                  }
                  title={tocOpen ? t("Скрыть отрывки") : t("Показать отрывки")}
                  onClick={() => setTocOpen((open) => !open)}
                >
                  <Icon name={tocOpen ? "back" : "next"} />
                </button>
                <div
                  class="flow-switch"
                  role="group"
                  aria-label={t("Вид чтения")}
                >
                  <button
                    aria-pressed={false}
                    onClick={() => changeFlow("pages")}
                  >
                    {t("Страницы")}
                  </button>
                  <button
                    aria-pressed={settings.readingFlow === "blocks"}
                    onClick={() => changeFlow("blocks")}
                  >
                    {t("По отрывкам")}
                  </button>
                  <button
                    aria-pressed={settings.readingFlow === "continuous"}
                    onClick={() => changeFlow("continuous")}
                  >
                    {t("Сплошной текст")}
                  </button>
                </div>
                {mode === "frank" ? (
                  <Toggle
                    checked={settings.showClean}
                    onChange={(v) =>
                      void run(() => saveSettings({ showClean: v }))
                    }
                  >
                    {t("Текст без подсказок")}
                  </Toggle>
                ) : null}
              </div>
            </header>
            <div class={"reader-layout" + (tocOpen ? "" : " toc-collapsed")}>
              <nav
                class="toc"
                id="reader-fragments"
                aria-label={t("Отрывки")}
                hidden={!tocOpen}
              >
                <div class="eyebrow">{t("Отрывки")}</div>
                {tocOpen &&
                  active.content.c.map((c, ci) => (
                    <div>
                      <p
                        class="muted"
                        style={{ padding: "0 12px", fontSize: 12 }}
                      >
                        {active.manifest.chapters[ci][0] ||
                          t("Глава ") + (ci + 1)}
                      </p>
                      {c.map((f, fi) => (
                        <button
                          class={at === `${ci + 1}.${fi + 1}` ? "active" : ""}
                          aria-current={
                            at === `${ci + 1}.${fi + 1}`
                              ? "location"
                              : undefined
                          }
                          onClick={() =>
                            (location.hash = `/read/${bookId}/${ci + 1}.${fi + 1}/${mode}`)
                          }
                        >
                          {fi + 1}. {plain(f).slice(0, 34)}…
                        </button>
                      ))}
                    </div>
                  ))}
              </nav>
              <main>
                <article class="book-page">
                  <div class="book-heading">
                    <div class="eyebrow">{active.manifest.author}</div>
                    <h2>{active.manifest.title}</h2>
                    {settings.readingFlow === "blocks" && (
                      <p class="muted">
                        {active.manifest.chapters[fragment.c][0] ||
                          t("Глава ") + (fragment.c + 1)}
                      </p>
                    )}
                  </div>
                  <BookFlow
                    content={active.content}
                    chapters={active.manifest.chapters.map((c) => c[0])}
                    at={at}
                    flow={settings.readingFlow}
                    layoutKey={[
                      mode,
                      settings.showClean,
                      settings.font,
                      settings.fontSize,
                      tocOpen,
                    ].join("-")}
                    onPosition={bookmarkScroll}
                  >
                    {renderBookFragment}
                  </BookFlow>
                </article>
                <div class="book-position">
                  <label for="book-position">
                    {t("Отрывок {0} из {1}", { 0: index + 1, 1: total })}
                  </label>
                  <input
                    id="book-position"
                    type="range"
                    min="0"
                    max={total - 1}
                    value={index}
                    aria-label={t("Место в книге")}
                    onInput={(event) => {
                      const address = addresses(active.content)[
                        +event.currentTarget.value
                      ];
                      if (address !== at)
                        location.hash = `/read/${bookId}/${address}/${mode}`;
                    }}
                  />
                  <span>{Math.round(((index + 1) / total) * 100)}%</span>
                </div>
                <div class="reader-actions">
                  <button
                    class="listen"
                    disabled={busy}
                    onClick={() => void listenFragment()}
                  >
                    <Icon name="sound" />
                    {busy ? t("Готовим звук…") : t("Прослушать отрывок")}
                  </button>
                  <button
                    class="primary"
                    onClick={() =>
                      navigate(
                        settings.readingFlow === "continuous"
                          ? total - index
                          : 1,
                      )
                    }
                  >
                    {settings.readingFlow === "continuous" ||
                    index === total - 1
                      ? t("Завершить чтение")
                      : t("Следующий отрывок")}
                    <Icon name="next" />
                  </button>
                </div>
                <div class="reader-info">
                  <span>{t("← → для перехода")}</span>
                  <span>·</span>
                  <span>{t("Место сохраняется автоматически")}</span>
                </div>
              </main>
              {wordPanel}
            </div>
          </>
        )
      ) : (
        <div class={"books-shell route-" + page}>
          <aside class="library-sidebar" aria-label={t("Библиотека")}>
            <a class="library-brand" href={href("home")}>
              <span class="library-logo">
                <Icon name="book" size={25} />
              </span>
              <span>
                {t("Немецкий")}
                <small>{t("по Франку")}</small>
              </span>
            </a>
            <label class="library-search">
              <Icon name="search" size={18} />
              <input
                aria-label={t("Поиск в библиотеке")}
                placeholder={t("Поиск")}
                value={page === "words" ? "" : query}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  if (page !== "texts") location.hash = "/texts";
                }}
              />
            </label>
            <div class="sidebar-label">{t("Библиотека")}</div>
            <nav class="nav" aria-label={t("Разделы")}>
              {nav.map(([value, label, icon]) => (
                <a
                  href={href(value)}
                  aria-current={page === value ? "page" : undefined}
                >
                  <Icon name={icon} />
                  <span>{t(label)}</span>
                </a>
              ))}
            </nav>
            <div class="sidebar-spacer" />
            <button
              class="sidebar-add"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="upload" />
              {t("Добавить книгу")}
            </button>
            <a
              class="settings-link"
              href={href("settings")}
              aria-label={t("Настройки")}
            >
              <Icon name="settings" />
              <span>{t("Настройки")}</span>
            </a>
          </aside>
          <main class="page">
            {page === "home" && (
              <>
                {current ? (
                  <section
                    class="hero library-home"
                    aria-label={t("Читаю сейчас")}
                  >
                    <div class="library-title-row">
                      <h1>{t("Читаю сейчас")}</h1>
                      <button
                        class="icon"
                        aria-label={t("Добавить книгу")}
                        onClick={() => fileRef.current?.click()}
                      >
                        <Icon name="upload" />
                      </button>
                    </div>
                    <h2>{t("Продолжить чтение")}</h2>
                    <div class="continue-shelf">
                      {[
                        current,
                        ...books
                          .filter((b) => b.manifest.id !== current.manifest.id)
                          .sort((a, b) =>
                            (
                              progress.find((p) => p.book === b.manifest.id)
                                ?.updatedAt || ""
                            ).localeCompare(
                              progress.find((p) => p.book === a.manifest.id)
                                ?.updatedAt || "",
                            ),
                          ),
                      ]
                        .slice(0, 2)
                        .map((book, i) => {
                          const p = progress.find(
                            (p) => p.book === book.manifest.id,
                          );
                          return (
                            <button
                              class="continue-card"
                              aria-label={
                                i === 0
                                  ? t("Читать дальше")
                                  : t("Читать ") + book.manifest.title
                              }
                              onClick={() => go(book)}
                            >
                              <BookCover manifest={book.manifest} small />
                              <span class="continue-copy">
                                <strong>{book.manifest.title}</strong>
                                <span>{book.manifest.author}</span>
                                <small>
                                  {book.manifest.level} · {p?.percent || 0}%
                                </small>
                                <span class="continue-action">
                                  {t("Читать дальше")}{" "}
                                  <Icon name="next" size={14} />
                                </span>
                              </span>
                            </button>
                          );
                        })}
                    </div>
                    <div class="library-section-title">
                      <h2>{t("Ваши книги")}</h2>
                      <a href={href("texts")}>
                        {t("Все книги")} <Icon name="next" size={16} />
                      </a>
                    </div>
                    <div class="book-grid">{books.map(bookCard)}</div>
                  </section>
                ) : (
                  <div class="panel empty">
                    <Icon name="book" size={40} />
                    <h2>{t("Ваша первая книга")}</h2>
                    <p>
                      {t(
                        "Добавьте .fbook и начните читать немецкий с подсказками.",
                      )}
                    </p>
                    <button
                      class="primary"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Icon name="upload" />
                      {t("Загрузить книгу")}
                    </button>
                  </div>
                )}
              </>
            )}
            {page === "texts" && (
              <>
                <div class="page-title">
                  <h1>{t("Тексты")}</h1>
                  <button
                    class="primary"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Icon name="upload" />
                    {t("Загрузить")}
                  </button>
                </div>
                <div
                  class="drop-zone"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add("over");
                  }}
                  onDragLeave={(e) => e.currentTarget.classList.remove("over")}
                  onDrop={(e) => e.currentTarget.classList.remove("over")}
                >
                  {t("Перетащите сюда файлы .fbook")}
                  <br />
                  <small>{t("Книги хранятся только на этом устройстве")}</small>
                </div>
                <div class="row between" style={{ marginBottom: 24 }}>
                  <input
                    class="text-input search"
                    placeholder={t("Найти книгу или автора")}
                    aria-label={t("Поиск книг")}
                    value={query}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                  <small class="muted">
                    {books.length} {t(" книг в библиотеке")}
                  </small>
                </div>
                <div class="stack">
                  {["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => {
                    const list = books.filter(
                      (b) =>
                        b.manifest.level === level &&
                        [
                          b.manifest.title,
                          b.manifest.titleRu,
                          b.manifest.author,
                        ]
                          .join(" ")
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    );
                    return list.length ? (
                      <section>
                        <h2
                          style={{
                            fontFamily: "inherit",
                            fontSize: 17,
                            marginBottom: 16,
                          }}
                        >
                          {t("Уровень ")}
                          {level} <span class="muted">· {list.length}</span>
                        </h2>
                        <div class="book-grid">{list.map(bookCard)}</div>
                      </section>
                    ) : null;
                  })}
                  {!books.length && (
                    <div class="empty">
                      <h2>{t("Библиотека пока пуста")}</h2>
                      <p>
                        {t("Загрузите .fbook или создайте книгу в сборщике.")}
                      </p>
                    </div>
                  )}
                </div>
                <p class="hint-note">
                  {t("«Автотекст» — разметка без полной ручной проверки.")}{" "}
                  <a href="fbook-builder.html">{t("Открыть сборщик книг →")}</a>
                </p>
              </>
            )}
            {page === "words" && (
              <>
                <div class="page-title">
                  <h1>
                    {t("Мои слова")}{" "}
                    <span
                      class="muted"
                      style={{ fontFamily: "inherit", fontSize: 18 }}
                    >
                      {saved.length}
                    </span>
                  </h1>
                  <div class="row">
                    <button
                      disabled={!filteredWords.length}
                      onClick={() => void run(() => exportList(false))}
                    >
                      <Icon name="download" />
                      CSV
                    </button>
                    <button
                      class="primary"
                      disabled={!filteredWords.length}
                      onClick={() => void run(() => exportList(true))}
                    >
                      {t("В Anki")}
                      <Icon name="next" />
                    </button>
                  </div>
                </div>
                <div class="row between" style={{ marginBottom: 24 }}>
                  <div
                    class="tabs"
                    role="tablist"
                    aria-label={t("Группировка слов")}
                  >
                    <button
                      role="tab"
                      aria-selected={wordTab === "all"}
                      onClick={() => {
                        setWordTab("all");
                        setBookFilter("all");
                      }}
                    >
                      {t("Все слова")}
                    </button>
                    <button
                      role="tab"
                      aria-selected={wordTab === "books"}
                      onClick={() => setWordTab("books")}
                    >
                      {t("По книгам")}
                    </button>
                  </div>
                  <input
                    class="text-input search"
                    placeholder={t("Найти слово")}
                    aria-label={t("Поиск слов")}
                    value={query}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </div>
                <div class="row between" style={{ marginBottom: 20 }}>
                  <small class="muted">
                    {t("Перевод, произношение и фраза из книги")}
                  </small>
                  <Toggle checked={onlyNew} onChange={setOnlyNew}>
                    {t("В Anki только новые")}
                  </Toggle>
                </div>
                <div class={wordTab === "books" ? "words-layout" : ""}>
                  {wordTab === "books" && (
                    <aside class="book-filter">
                      <button
                        class={bookFilter === "all" ? "active" : ""}
                        onClick={() => setBookFilter("all")}
                      >
                        {t("Все книги")}
                        <span>{saved.length}</span>
                      </button>
                      {[...new Set(saved.map((w) => w.book))].map((id) => (
                        <button
                          class={bookFilter === id ? "active" : ""}
                          onClick={() => setBookFilter(id)}
                        >
                          {books.find((b) => b.manifest.id === id)?.manifest
                            .title || t("Книга не загружена")}
                          <span>
                            {saved.filter((w) => w.book === id).length}
                          </span>
                        </button>
                      ))}
                    </aside>
                  )}
                  <div class="word-list">
                    {filteredWords.map((w) => (
                      <article class="panel word-entry">
                        <div>
                          <div class="row">
                            <h3 lang="de">{w.lemma}</h3>
                            <span class="ipa">[{w.ipa}]</span>
                          </div>
                          <div>{w.ru}</div>
                          <div class="context">
                            <i lang="de">{w.context}</i>
                          </div>
                          <div class="row between" style={{ marginTop: 12 }}>
                            <small class="muted">
                              {books.find((b) => b.manifest.id === w.book)
                                ?.manifest.title ||
                                t("Книга не загружена")}{" "}
                              · {w.at}
                            </small>
                            {w.inAnki && (
                              <span class="status">{t("✓ в Anki")}</span>
                            )}
                          </div>
                        </div>
                        <div class="stack" style={{ gap: 6 }}>
                          <button
                            class="icon"
                            aria-label={t("Озвучить ") + w.lemma}
                            disabled={busy}
                            onClick={() => void listen(w.form, w.ipa)}
                          >
                            <Icon name="sound" />
                          </button>
                          <button
                            class="icon"
                            aria-label={t("Удалить слово ") + w.lemma}
                            onClick={() =>
                              setConfirm({
                                title: t("Удалить слово?"),
                                text: w.lemma + " — " + w.ru,
                                action: async () => {
                                  await store.remove("words", w.key);
                                  setSaved((prev) =>
                                    prev.filter((x) => x.key !== w.key),
                                  );
                                },
                              })
                            }
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </article>
                    ))}
                    {!filteredWords.length && (
                      <div class="panel empty">
                        <Icon name="words" size={36} />
                        <h2>
                          {query
                            ? t("Слова не найдены")
                            : t("Здесь будут ваши слова")}
                        </h2>
                        <p>
                          {t(
                            "Нажмите на слово во время чтения и выберите «В мои слова».",
                          )}
                        </p>
                        <a class="btn" href={href("home")}>
                          {t("Перейти к чтению")}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                <p class="hint-note">
                  {t(
                    "Anki: «Файл → Импорт» → выберите скачанный .txt. Каждая книга попадёт в свою подколоду. Отметка «в Anki» означает, что слово было экспортировано.",
                  )}
                </p>
              </>
            )}
            {page === "settings" && (
              <>
                <div class="page-title">
                  <h1>{t("Настройки")}</h1>
                </div>
                <div class="settings-grid">
                  <section class="panel">
                    <h2>{t("Чтение")}</h2>
                    <div class="setting-row">
                      <label for="interface-language">
                        {t("Язык интерфейса")}
                      </label>
                      <select
                        id="interface-language"
                        value={settings.language}
                        onChange={(event) =>
                          void run(() =>
                            saveSettings({
                              language:
                                event.currentTarget.value === "de"
                                  ? "de"
                                  : "ru",
                            }),
                          )
                        }
                      >
                        <option value="ru">{t("Русский")}</option>
                        <option value="de">Deutsch</option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <label for="reading-flow">{t("Вид чтения")}</label>
                      <select
                        id="reading-flow"
                        value={settings.readingFlow}
                        onChange={(event) =>
                          changeFlow(event.currentTarget.value as ReadingFlow)
                        }
                      >
                        <option value="pages">{t("Страницы")}</option>
                        <option value="blocks">{t("По отрывкам")}</option>
                        <option value="continuous">
                          {t("Сплошной текст")}
                        </option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <label for="font">{t("Шрифт")}</label>
                      <select
                        id="font"
                        value={settings.font}
                        onChange={(e) =>
                          void run(() =>
                            saveSettings({ font: e.currentTarget.value }),
                          )
                        }
                      >
                        <option value="serif">Literata</option>
                        <option value="sans">Golos Text</option>
                        <option value="system">{t("Системный")}</option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <label for="size">
                        {t("Размер текста")}
                        <small>{settings.fontSize} px</small>
                      </label>
                      <input
                        id="size"
                        type="range"
                        min="14"
                        max="30"
                        value={settings.fontSize}
                        onInput={(e) =>
                          void run(() =>
                            saveSettings({ fontSize: +e.currentTarget.value }),
                          )
                        }
                      />
                    </div>
                    <div class="setting-row">
                      <label for="theme">{t("Тема")}</label>
                      <select
                        id="theme"
                        value={settings.theme}
                        onChange={(e) =>
                          void run(() =>
                            saveSettings({ theme: e.currentTarget.value }),
                          )
                        }
                      >
                        <option value="system">{t("Как в системе")}</option>
                        <option value="light">{t("Светлая")}</option>
                        <option value="dark">{t("Тёмная")}</option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <Toggle
                        checked={settings.showClean}
                        onChange={(v) =>
                          void run(() => saveSettings({ showClean: v }))
                        }
                      >
                        {t("Текст без подсказок")}
                        <small style={{ display: "block" }}>
                          {t("Повторять отрывок в режиме «Франк»")}
                        </small>
                      </Toggle>
                    </div>
                    <div class="preview" lang="de">
                      Und machte sich auf den Weg nach Bremen.
                      <br />
                      <span class="hint" lang="ru">
                        И отправился в путь в Бремен.
                      </span>
                    </div>
                  </section>
                  <section class="panel">
                    <h2>{t("Произношение")}</h2>
                    <div class="setting-row">
                      <label for="voice">{t("Голос")}</label>
                      <select
                        id="voice"
                        value={settings.voice}
                        onChange={(e) =>
                          void run(() =>
                            saveSettings({ voice: e.currentTarget.value }),
                          )
                        }
                      >
                        <option value="espeak">
                          {t("eSpeak NG · офлайн")}
                        </option>
                        <option value="system">{t("Системный голос")}</option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <label for="rate">
                        {t("Скорость")}
                        <small>{settings.rate.toFixed(1)}×</small>
                      </label>
                      <input
                        id="rate"
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.1"
                        value={settings.rate}
                        onInput={(e) =>
                          void run(() =>
                            saveSettings({ rate: +e.currentTarget.value }),
                          )
                        }
                      />
                    </div>
                    <p class="muted">
                      {t(
                        "eSpeak NG читает произношение из книги. Системный голос читает немецкий текст и зависит от голосов, установленных на устройстве.",
                      )}
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void listen("Guten Tag! Willkommen in Bremen.")
                      }
                    >
                      <Icon name="sound" />
                      {busy ? t("Готовим звук…") : t("Послушать пример")}
                    </button>
                  </section>
                  <section class="panel stack">
                    <h2>{t("Данные")}</h2>
                    <p class="muted" style={{ margin: 0 }}>
                      {t(
                        "Прогресс, слова и настройки хранятся в этом браузере. Сохраняйте резервную копию перед переносом файла или очисткой браузера.",
                      )}
                    </p>
                    <small class="muted">
                      {t("Занято в браузере: ")}
                      {usage ? usage + t(" МБ") : t("нет данных")}
                    </small>
                    <Toggle checked={withBooks} onChange={setWithBooks}>
                      {t("Вместе с книгами")}
                    </Toggle>
                    <div class="row">
                      <button
                        onClick={() =>
                          void run(async () => {
                            await exportBackup(withBooks);
                            notify(t("Резервная копия скачана"));
                          })
                        }
                      >
                        <Icon name="download" />
                        {t("Экспорт")}
                      </button>
                      <button onClick={() => backupRef.current?.click()}>
                        <Icon name="upload" />
                        {t("Импорт")}
                      </button>
                    </div>
                    <div class="line" />
                    <button
                      class="danger"
                      onClick={() =>
                        setConfirm({
                          title: t("Очистить все данные?"),
                          text: t(
                            "Удалятся книги, слова, прогресс и настройки. Это действие нельзя отменить. Сначала скачайте резервную копию.",
                          ),
                          action: async () => {
                            stop();
                            await store.clearAll();
                            await refresh();
                            notify(t("Данные удалены"));
                          },
                        })
                      }
                    >
                      <Icon name="trash" />
                      {t("Очистить данные")}
                    </button>
                  </section>
                  <section class="panel stack">
                    <h2>{t("О приложении")}</h2>
                    <p class="muted" style={{ margin: 0 }}>
                      {t(
                        "Немецкий по методу Ильи Франка: сначала читайте с подсказками, затем тот же отрывок без перевода.",
                      )}
                    </p>
                    <a class="btn" href="fbook-builder.html">
                      {t("Сборщик .fbook")}
                      <Icon name="next" />
                    </a>
                    <small class="muted">
                      {t("Версия 1.0 · формат .fbook 2")}
                      <br />
                      {t(
                        "Без сервера и аккаунтов. При открытии на другом устройстве данные нужно перенести резервной копией.",
                      )}
                    </small>
                  </section>
                </div>
              </>
            )}
            {!["home", "texts", "words", "settings"].includes(page) && (
              <div class="empty">
                <h1>{t("Страница не найдена")}</h1>
                <p>
                  <a href={href("home")}>{t("Вернуться к библиотеке")}</a>
                </p>
              </div>
            )}
          </main>
        </div>
      )}
      {sizeOpen && (
        <Modal title={t("Размер текста")} onClose={() => setSizeOpen(false)}>
          <div class="setting-row">
            <label for="reader-size">
              {t("Размер: ")}
              {settings.fontSize} px
            </label>
            <input
              id="reader-size"
              type="range"
              min="14"
              max="30"
              value={settings.fontSize}
              onInput={(e) =>
                void run(() =>
                  saveSettings({ fontSize: +e.currentTarget.value }),
                )
              }
            />
          </div>
          <div class="preview" lang="de">
            Da dachte der Herr daran…
          </div>
          <div class="row">
            <button class="primary" onClick={() => setSizeOpen(false)}>
              {t("Готово")}
            </button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm.title}
          onClose={() => {
            confirm.cancel?.();
            setConfirm(null);
          }}
        >
          <p>{confirm.text}</p>
          <div class="row">
            <button
              onClick={() => {
                confirm.cancel?.();
                setConfirm(null);
              }}
            >
              {t("Отмена")}
            </button>
            <button
              class="primary"
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void run(action);
              }}
            >
              {t("Подтвердить")}
            </button>
          </div>
        </Modal>
      )}
      {message && (!focusMode || message.error) && (
        <div
          class={"toast" + (message.error ? " error" : "")}
          role={message.error ? "alert" : "status"}
        >
          <span>{message.text}</span>
          <button
            aria-label={t("Закрыть сообщение")}
            onClick={() => setMessage(null)}
          >
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
