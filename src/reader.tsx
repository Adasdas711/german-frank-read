import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import {
  readBook,
  plain,
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
import { speak, stop, unlockAudio } from "./voice";
import {
  exportBackup,
  parseBackup,
  importBackup,
  exportWords,
} from "./transfer";
import demos from "./demos.json";
import "./style.css";
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
    [settings, setSettings] = useState<Settings>(store.defaults),
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
    } | null>(null),
    [busy, setBusy] = useState(false),
    [toc, setToc] = useState(false),
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
    wordRef = useRef<HTMLElement>(null);
  const notify = (text: string, error = false) => setMessage({ text, error });
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
    setSettings(store.checkedSettings(s || store.defaults));
  };
  useEffect(() => {
    void (async () => {
      await store.put("settings", "probe", true);
      await store.remove("settings", "probe");
      if (!(await store.get("settings", "initialized"))) {
        for (const d of demos) {
          const bytes = Uint8Array.from(atob(d), (c) => c.charCodeAt(0)),
            b = readBook(bytes);
          if (!(await store.get("books", b.manifest.id)))
            await store.put("books", b.manifest.id, {
              manifest: b.manifest,
              bytes,
            });
        }
        await store.put("settings", "initialized", true);
      }
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
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--size", settings.fontSize + "px");
    root.style.setProperty(
      "--reading",
      settings.font === "serif"
        ? "'Literata', Georgia, serif"
        : settings.font === "sans"
          ? "'Golos Text', sans-serif"
          : "system-ui, sans-serif",
    );
  }, [settings]);
  const saveSettings = async (p: Partial<Settings>) => {
    const next = { ...settings, ...p };
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
        notify("Книга не найдена. Загрузите её в разделе «Тексты».", true);
      setActive(null);
      return;
    }
    void run(async () => {
      const data = readBook(b.bytes);
      setActive(data);
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
        old = progress.find((p) => p.book === bookId),
        p = {
          book: bookId,
          at,
          percent:
            old?.at === at
              ? old.percent
              : Math.round((index / data.manifest.stats.fragments) * 100),
          mode,
          updatedAt: new Date().toISOString(),
        };
      await store.put("progress", bookId, p);
      setProgress((prev) => [...prev.filter((p) => p.book !== bookId), p]);
      await saveSettings({ current: bookId });
    });
  }, [page, bookId, at, mode, books]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), message.error ? 12000 : 5000);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    if (page !== "settings") return;
    void navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(((e.usage || 0) / 1024 / 1024).toFixed(1) + " МБ"))
      .catch(() => {});
  }, [page]);
  function go(book: Book) {
    const p = progress.find((p) => p.book === book.manifest.id);
    location.hash = `/read/${book.manifest.id}/${p?.at || "1.1"}/${p?.mode || "frank"}`;
  }
  async function importFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      try {
        if (file.size > 32 * 1024 * 1024) throw Error("Файл превышает 32 МБ.");
        const bytes = new Uint8Array(await file.arrayBuffer()),
          b = readBook(bytes),
          old = await store.get<Book>("books", b.manifest.id);
        if (old) {
          if (old.manifest.revision >= b.manifest.revision) {
            notify("Эта книга уже есть: " + b.manifest.title);
            continue;
          }
          await new Promise<void>((resolve) =>
            setConfirm({
              title: "Обновить книгу?",
              cancel: resolve,
              text: `${b.manifest.title}, версия ${b.manifest.revision}. Прогресс и слова сохранятся.`,
              action: async () => {
                await store.put("books", b.manifest.id, {
                  manifest: b.manifest,
                  bytes,
                });
                await refresh();
                notify("Книга обновлена");
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
          notify("Книга добавлена: " + b.manifest.title);
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
  const navigate = (delta: number) => {
    if (!active) return;
    const list = addresses(active.content),
      next = list[index + delta];
    if (next) {
      setSelected(null);
      location.hash = `/read/${bookId}/${next}/${mode}`;
    } else if (delta > 0 && index === list.length - 1) {
      void run(async () => {
        const p = {
          book: bookId,
          at,
          percent: 100,
          mode,
          updatedAt: new Date().toISOString(),
        };
        await store.put("progress", bookId, p);
        setProgress((prev) => [...prev.filter((p) => p.book !== bookId), p]);
        notify("Книга прочитана. Можно вернуться к любому отрывку.");
        location.hash = "/home";
      });
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        page !== "read" ||
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
  }, [active, at, mode, confirm, sizeOpen]);
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
  function cleanText(text: string, context: string, hint: string) {
    return text.split(/([\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*)/gu).map((t, i) =>
      splitWords(t).length ? (
        <button
          key={i}
          lang="de"
          class={"word" + (selected?.form === t ? " chosen" : "")}
          onClick={() => {
            setSelected({ form: t, context, hint });
            setTimeout(() => {
              if (innerWidth < 1190)
                wordRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                });
            }, 10);
          }}
        >
          {t}
        </button>
      ) : (
        t
      ),
    );
  }
  function textBlock(chunks: Chunk[], hints = false) {
    return chunks.map((c) => {
      if (typeof c === "string") return cleanText(c, plain(chunks), "");
      const hint =
        active!.content.g[c[1]] +
        (c[2] != null ? " = " + active!.content.g[c[2]] : "");
      return (
        <span class={c[3] === 1 ? "uncertain" : ""}>
          {cleanText(c[0], c[0], hint)}
          {hints && (
            <>
              {" "}
              <span class="hint">({hint})</span>
            </>
          )}
        </span>
      );
    });
  }
  const selForm = selected && active?.content.f[selected.form],
    lemma = selForm?.[1] != null ? active?.content.l[selForm[1]] : null,
    selIpa = selected
      ? active?.content.x?.[at]?.[selected.form] || selForm?.[0] || ""
      : "";
  const selKey = selected
    ? [bookId, lemma?.[0] || selected.form, at].join("|")
    : "";
  const isSaved = saved.some((w) => w.key === selKey);
  async function saveWord() {
    if (!selected) return;
    const w: SavedWord = {
      key: selKey,
      book: bookId,
      at,
      lemma: lemma?.[0] || selected.form,
      ru: lemma?.[1] || selected.hint || "Перевод отсутствует в словаре книги",
      ipa: selIpa,
      context: selected.context,
      form: selected.form,
      savedAt: new Date().toISOString(),
      inAnki: false,
    };
    await store.put("words", w.key, w);
    setSaved((prev) => [...prev.filter((x) => x.key !== w.key), w]);
    notify("Слово сохранено");
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
    notify("Файл скачан" + (anki ? ". Слова отмечены «в Anki»." : ""));
  };
  function bookCard(b: Book) {
    const m = b.manifest,
      p = progress.find((p) => p.book === m.id);
    return (
      <article class="panel book-card" key={m.id}>
        <div class="row between">
          <span class="badge">{m.level}</span>
          <span
            class={"tag " + (m.annotation === "verified" ? "verified" : "")}
          >
            <span class="dot" />
            {m.annotation === "verified" ? "Проверено" : "Автотекст"}
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
              {p?.percent || 0}% прочитано · {m.stats.fragments} отр.
            </small>
            <small class="muted">{(b.bytes.length / 1024).toFixed(1)} КБ</small>
          </div>
        </div>
        <div class="row">
          <button class="primary grow" onClick={() => go(b)}>
            {p ? "Продолжить" : "Читать"}
          </button>
          <button
            class="icon"
            aria-label={"Скачать " + m.title}
            onClick={() => download(b.bytes, slug(m.title) + ".fbook")}
          >
            <Icon name="download" />
          </button>
          <button
            class="icon"
            aria-label={"Удалить " + m.title}
            onClick={() =>
              setConfirm({
                title: "Удалить книгу?",
                text: "Удалится только файл книги. Сохранённые слова и прогресс останутся.",
                action: async () => {
                  await store.remove("books", m.id);
                  await refresh();
                  notify("Книга удалена");
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
  if (!ready)
    return (
      <>
        <main class="page">
          <h1>Немецкий по Франку</h1>
          <p>
            {startupError
              ? "Не удалось открыть хранилище браузера. Разрешите локальное хранение данных или откройте файл в Chrome / Edge."
              : "Открываем библиотеку…"}
          </p>
          {startupError && (
            <>
              <div role="alert">{startupError}</div>
              <p>
                Данные не удалены. Проверьте разрешение браузера на хранение
                данных.
              </p>
              <button onClick={() => location.reload()}>
                Повторить запуск
              </button>
            </>
          )}
        </main>
      </>
    );
  return (
    <>
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
                throw Error("Копия превышает 32 МБ.");
              const parsed = parseBackup(
                new Uint8Array(await file.arrayBuffer()),
              );
              setConfirm({
                title: "Импорт данных",
                text: `Добавить слова (${parsed.data.words.length}) и прогресс (${parsed.data.progress.length})? Более свежий прогресс сохранится.`,
                action: async () => {
                  const replace = window.confirm(
                    "Заменить также настройки из резервной копии? «Отмена» сохранит текущие настройки.",
                  );
                  await importBackup(parsed, replace);
                  await refresh();
                  notify("Резервная копия импортирована");
                },
              });
            });
          e.currentTarget.value = "";
        }}
      />
      {page === "read" && active && fragment ? (
        <>
          <header class="app-header reader-header">
            <div class="header-inner">
              <a class="back btn" href={href("home")}>
                <Icon name="back" />
                Назад
              </a>
              <div class="reader-title">
                <h1>{active.manifest.title}</h1>
                <small>
                  {active.manifest.author} · {active.manifest.level} · отрывок{" "}
                  {index + 1} из {total}
                </small>
              </div>
              <div class="tabs" role="tablist" aria-label="Режим чтения">
                {[
                  ["frank", "Франк"],
                  ["clean", "Чистый"],
                  ["parallel", "Параллель"],
                ].map(([v, label]) => (
                  <button
                    role="tab"
                    aria-selected={mode === v}
                    disabled={v === "parallel" && !active.content.t}
                    title={
                      v === "parallel" && !active.content.t
                        ? "В книге нет перевода"
                        : label
                    }
                    onClick={() =>
                      (location.hash = `/read/${bookId}/${at}/${v}`)
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                class="icon serif"
                aria-label="Размер шрифта"
                onClick={() => setSizeOpen(true)}
              >
                Aa
              </button>
            </div>
          </header>
          <div class="reader-layout">
            <nav class={"toc" + (toc ? " open" : "")} aria-label="Отрывки">
              <div class="eyebrow">Отрывки</div>
              {active.content.c.map((c, ci) => (
                <div>
                  <p class="muted" style={{ padding: "0 12px", fontSize: 12 }}>
                    {active.manifest.chapters[ci][0] || "Глава " + (ci + 1)}
                  </p>
                  {c.map((f, fi) => (
                    <button
                      class={at === `${ci + 1}.${fi + 1}` ? "active" : ""}
                      aria-current={
                        at === `${ci + 1}.${fi + 1}` ? "location" : undefined
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
              <div class="row reader-tools">
                <button
                  class="icon"
                  aria-label="Оглавление"
                  onClick={() => setToc(!toc)}
                >
                  <Icon name="menu" />
                </button>
                {mode === "frank" ? (
                  <Toggle
                    checked={settings.showClean}
                    onChange={(v) =>
                      void run(() => saveSettings({ showClean: v }))
                    }
                  >
                    Текст без подсказок
                  </Toggle>
                ) : (
                  <small class="muted">
                    Нажмите на слово, чтобы увидеть подсказку
                  </small>
                )}
              </div>
              {mode === "parallel" ? (
                <section
                  class="reading-panel"
                  aria-label="Параллельный перевод"
                >
                  <div class="eyebrow">Немецкий · Русский</div>
                  {(active.content.t?.[fragment.c]?.[fragment.f] || []).map(
                    (t, i) => {
                      const text =
                        plain(fragment.chunks).match(
                          /[^.!?]+[.!?]+[»”"']*|[^.!?]+$/g,
                        )?.[i] || "";
                      return (
                        <div class="parallel-row">
                          <p lang="de">{cleanText(text, text, t)}</p>
                          <p class="translation">{t}</p>
                        </div>
                      );
                    },
                  )}
                </section>
              ) : (
                <div class="reading-columns">
                  {mode === "frank" && (
                    <section class="reading-panel" aria-label="С подсказками">
                      <div class="eyebrow">С подсказками</div>
                      <p lang="de">{textBlock(fragment.chunks, true)}</p>
                    </section>
                  )}
                  {(mode === "clean" || settings.showClean) && (
                    <section class="reading-panel" aria-label="Без подсказок">
                      <div class="eyebrow">Без подсказок</div>
                      <p lang="de">{textBlock(fragment.chunks)}</p>
                    </section>
                  )}
                </div>
              )}
              <div class="reader-actions">
                <button
                  class="listen"
                  disabled={busy}
                  onClick={() => void listenFragment()}
                >
                  <Icon name="sound" />
                  {busy ? "Готовим звук…" : "Прослушать отрывок"}
                </button>
                <button
                  class="icon"
                  aria-label="Остановить воспроизведение"
                  onClick={stop}
                >
                  <Icon name="stop" />
                </button>
                <button
                  disabled={index === 0}
                  class="icon"
                  aria-label="Предыдущий отрывок"
                  onClick={() => navigate(-1)}
                >
                  <Icon name="back" />
                </button>
                <button class="primary" onClick={() => navigate(1)}>
                  {index === total - 1
                    ? "Завершить чтение"
                    : "Следующий отрывок"}
                  <Icon name="next" />
                </button>
              </div>
              <div class="reader-info">
                <span>← → для перехода</span>
                <span>·</span>
                <span>Место сохраняется автоматически</span>
              </div>
            </main>
            {selected ? (
              <aside
                class="panel word-panel"
                ref={wordRef}
                aria-label="Подсказка к слову"
              >
                <div class="row between">
                  <div class="grow">
                    <h2 lang="de">{lemma?.[0] || selected.form}</h2>
                    <small class="muted">В тексте: {selected.form}</small>
                  </div>
                  <button
                    class="icon close-word"
                    aria-label="Закрыть подсказку"
                    onClick={() => setSelected(null)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <div class="row">
                  <span class="ipa">[{selIpa}]</span>
                  <button
                    class="icon"
                    aria-label="Произнести слово"
                    disabled={busy}
                    onClick={() => void listen(selected.form, selIpa)}
                  >
                    <Icon name="sound" />
                  </button>
                </div>
                <strong>{lemma?.[1] || "Нет отдельного перевода"}</strong>
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
                      Слово сохранено
                    </>
                  ) : (
                    "В мои слова"
                  )}
                </button>
              </aside>
            ) : (
              <aside class="panel word-panel">
                <div class="eyebrow">Слово за словом</div>
                <p class="muted" style={{ margin: 0 }}>
                  Нажмите на немецкое слово — здесь появятся произношение,
                  перевод и контекст.
                </p>
              </aside>
            )}
          </div>
        </>
      ) : (
        <>
          <header class="app-header">
            <div class="header-inner">
              <a class="brand" href={href("home")}>
                Немецкий по Франку
              </a>
              <nav class="nav" aria-label="Разделы">
                {nav.map(([v, label, icon]) => (
                  <a
                    href={href(v)}
                    aria-current={page === v ? "page" : undefined}
                  >
                    <Icon name={icon} />
                    {label}
                  </a>
                ))}
              </nav>
              <a
                class="settings-link icon"
                href={href("settings")}
                aria-label="Настройки"
              >
                <Icon name="settings" />
              </a>
            </div>
          </header>
          <main class="page">
            {page === "home" && (
              <>
                {current ? (
                  (() => {
                    const data = readBook(current.bytes),
                      p = locate(data.content, cp?.at || "1.1"),
                      idx = addresses(data.content).indexOf(cp?.at || "1.1");
                    return (
                      <>
                        <section class="hero" aria-label="Читаю сейчас">
                          <div class="hero-copy">
                            <div class="row">
                              <span class="eyebrow">Читаю сейчас</span>
                              <span class="badge">
                                Уровень {current.manifest.level}
                              </span>
                            </div>
                            <h2>{current.manifest.title}</h2>
                            <div class="muted">
                              {current.manifest.author} ·{" "}
                              {current.manifest.titleRu}
                            </div>
                            <div>
                              <ProgressBar value={cp?.percent || 0} />
                              <small class="muted">
                                Отрывок {idx + 1} из{" "}
                                {current.manifest.stats.fragments}
                                {cp?.percent === 100 ? " · Прочитано" : ""}
                              </small>
                            </div>
                            <blockquote>
                              „{plain(p.chunks).slice(0, 175)}…“
                            </blockquote>
                          </div>
                          <button class="btn teal" onClick={() => go(current)}>
                            Читать дальше
                            <Icon name="next" />
                          </button>
                        </section>
                        <p class="hint-note">
                          Встроены короткие демонстрационные отрывки. Полные
                          книги можно добавить в разделе «Тексты».
                        </p>
                      </>
                    );
                  })()
                ) : (
                  <div class="panel empty">
                    <Icon name="book" size={40} />
                    <h2>Ваша первая книга</h2>
                    <p>
                      Добавьте .fbook и начните читать немецкий с подсказками.
                    </p>
                    <button
                      class="primary"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Icon name="upload" />
                      Загрузить книгу
                    </button>
                  </div>
                )}
                <p class="bottom-note">
                  Чтение в своём темпе. Без аккаунтов и интернета.
                </p>
              </>
            )}
            {page === "texts" && (
              <>
                <div class="page-title">
                  <h1>Тексты</h1>
                  <button
                    class="primary"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Icon name="upload" />
                    Загрузить
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
                  Перетащите сюда файлы .fbook
                  <br />
                  <small>Книги хранятся только на этом устройстве</small>
                </div>
                <div class="row between" style={{ marginBottom: 24 }}>
                  <input
                    class="text-input search"
                    placeholder="Найти книгу или автора"
                    aria-label="Поиск книг"
                    value={query}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                  <small class="muted">{books.length} книг в библиотеке</small>
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
                          Уровень {level}{" "}
                          <span class="muted">· {list.length}</span>
                        </h2>
                        <div class="book-grid">{list.map(bookCard)}</div>
                      </section>
                    ) : null;
                  })}
                  {!books.length && (
                    <div class="empty">
                      <h2>Библиотека пока пуста</h2>
                      <p>Загрузите .fbook или создайте книгу в сборщике.</p>
                    </div>
                  )}
                </div>
                <p class="hint-note">
                  «Автотекст» — разметка без полной ручной проверки.{" "}
                  <a href="fbook-builder.html">Открыть сборщик книг →</a>
                </p>
              </>
            )}
            {page === "words" && (
              <>
                <div class="page-title">
                  <h1>
                    Мои слова{" "}
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
                      В Anki
                      <Icon name="next" />
                    </button>
                  </div>
                </div>
                <div class="row between" style={{ marginBottom: 24 }}>
                  <div
                    class="tabs"
                    role="tablist"
                    aria-label="Группировка слов"
                  >
                    <button
                      role="tab"
                      aria-selected={wordTab === "all"}
                      onClick={() => {
                        setWordTab("all");
                        setBookFilter("all");
                      }}
                    >
                      Все слова
                    </button>
                    <button
                      role="tab"
                      aria-selected={wordTab === "books"}
                      onClick={() => setWordTab("books")}
                    >
                      По книгам
                    </button>
                  </div>
                  <input
                    class="text-input search"
                    placeholder="Найти слово"
                    aria-label="Поиск слов"
                    value={query}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </div>
                <div class="row between" style={{ marginBottom: 20 }}>
                  <small class="muted">
                    Перевод, произношение и фраза из книги
                  </small>
                  <Toggle checked={onlyNew} onChange={setOnlyNew}>
                    В Anki только новые
                  </Toggle>
                </div>
                <div class={wordTab === "books" ? "words-layout" : ""}>
                  {wordTab === "books" && (
                    <aside class="book-filter">
                      <button
                        class={bookFilter === "all" ? "active" : ""}
                        onClick={() => setBookFilter("all")}
                      >
                        Все книги<span>{saved.length}</span>
                      </button>
                      {[...new Set(saved.map((w) => w.book))].map((id) => (
                        <button
                          class={bookFilter === id ? "active" : ""}
                          onClick={() => setBookFilter(id)}
                        >
                          {books.find((b) => b.manifest.id === id)?.manifest
                            .title || "Книга не загружена"}
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
                                ?.manifest.title || "Книга не загружена"}{" "}
                              · {w.at}
                            </small>
                            {w.inAnki && <span class="status">✓ в Anki</span>}
                          </div>
                        </div>
                        <div class="stack" style={{ gap: 6 }}>
                          <button
                            class="icon"
                            aria-label={"Озвучить " + w.lemma}
                            disabled={busy}
                            onClick={() => void listen(w.form, w.ipa)}
                          >
                            <Icon name="sound" />
                          </button>
                          <button
                            class="icon"
                            aria-label={"Удалить слово " + w.lemma}
                            onClick={() =>
                              setConfirm({
                                title: "Удалить слово?",
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
                            ? "Слова не найдены"
                            : "Здесь будут ваши слова"}
                        </h2>
                        <p>
                          Нажмите на слово во время чтения и выберите «В мои
                          слова».
                        </p>
                        <a class="btn" href={href("home")}>
                          Перейти к чтению
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                <p class="hint-note">
                  Anki: «Файл → Импорт» → выберите скачанный .txt. Каждая книга
                  попадёт в свою подколоду. Отметка «в Anki» означает, что слово
                  было экспортировано.
                </p>
              </>
            )}
            {page === "settings" && (
              <>
                <div class="page-title">
                  <h1>Настройки</h1>
                </div>
                <div class="settings-grid">
                  <section class="panel">
                    <h2>Чтение</h2>
                    <div class="setting-row">
                      <label for="font">Шрифт</label>
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
                        <option value="system">Системный</option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <label for="size">
                        Размер текста<small>{settings.fontSize} px</small>
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
                      <label for="theme">Тема</label>
                      <select
                        id="theme"
                        value={settings.theme}
                        onChange={(e) =>
                          void run(() =>
                            saveSettings({ theme: e.currentTarget.value }),
                          )
                        }
                      >
                        <option value="system">Как в системе</option>
                        <option value="light">Светлая</option>
                        <option value="dark">Тёмная</option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <Toggle
                        checked={settings.showClean}
                        onChange={(v) =>
                          void run(() => saveSettings({ showClean: v }))
                        }
                      >
                        Текст без подсказок
                        <small style={{ display: "block" }}>
                          Повторять отрывок в режиме «Франк»
                        </small>
                      </Toggle>
                    </div>
                    <div class="preview" lang="de">
                      Und machte sich auf den Weg nach Bremen.
                      <br />
                      <span class="hint">И отправился в путь в Бремен.</span>
                    </div>
                  </section>
                  <section class="panel">
                    <h2>Произношение</h2>
                    <div class="setting-row">
                      <label for="voice">Голос</label>
                      <select
                        id="voice"
                        value={settings.voice}
                        onChange={(e) =>
                          void run(() =>
                            saveSettings({ voice: e.currentTarget.value }),
                          )
                        }
                      >
                        <option value="espeak">eSpeak NG · офлайн</option>
                        <option value="system">Системный голос</option>
                      </select>
                    </div>
                    <div class="setting-row">
                      <label for="rate">
                        Скорость<small>{settings.rate.toFixed(1)}×</small>
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
                      eSpeak NG читает произношение из книги. Системный голос
                      читает немецкий текст и зависит от голосов, установленных
                      на устройстве.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void listen("Guten Tag! Willkommen in Bremen.")
                      }
                    >
                      <Icon name="sound" />
                      {busy ? "Готовим звук…" : "Послушать пример"}
                    </button>
                  </section>
                  <section class="panel stack">
                    <h2>Данные</h2>
                    <p class="muted" style={{ margin: 0 }}>
                      Прогресс, слова и настройки хранятся в этом браузере.
                      Сохраняйте резервную копию перед переносом файла или
                      очисткой браузера.
                    </p>
                    <small class="muted">
                      Занято в браузере: {usage || "нет данных"}
                    </small>
                    <Toggle checked={withBooks} onChange={setWithBooks}>
                      Вместе с книгами
                    </Toggle>
                    <div class="row">
                      <button
                        onClick={() =>
                          void run(async () => {
                            await exportBackup(withBooks);
                            notify("Резервная копия скачана");
                          })
                        }
                      >
                        <Icon name="download" />
                        Экспорт
                      </button>
                      <button onClick={() => backupRef.current?.click()}>
                        <Icon name="upload" />
                        Импорт
                      </button>
                    </div>
                    <div class="line" />
                    <button
                      class="danger"
                      onClick={() =>
                        setConfirm({
                          title: "Очистить все данные?",
                          text: "Удалятся книги, слова, прогресс и настройки. Это действие нельзя отменить. Сначала скачайте резервную копию.",
                          action: async () => {
                            stop();
                            await store.clearAll();
                            await refresh();
                            notify("Данные удалены");
                          },
                        })
                      }
                    >
                      <Icon name="trash" />
                      Очистить данные
                    </button>
                  </section>
                  <section class="panel stack">
                    <h2>О приложении</h2>
                    <p class="muted" style={{ margin: 0 }}>
                      Немецкий по методу Ильи Франка: сначала читайте с
                      подсказками, затем тот же отрывок без перевода.
                    </p>
                    <a class="btn" href="fbook-builder.html">
                      Сборщик .fbook
                      <Icon name="next" />
                    </a>
                    <small class="muted">
                      Версия 1.0 · формат .fbook 2<br />
                      Без сервера и аккаунтов. При открытии на другом устройстве
                      данные нужно перенести резервной копией.
                    </small>
                  </section>
                </div>
              </>
            )}
            {!["home", "texts", "words", "settings"].includes(page) && (
              <div class="empty">
                <h1>Страница не найдена</h1>
                <p>
                  <a href={href("home")}>Вернуться к библиотеке</a>
                </p>
              </div>
            )}
          </main>
        </>
      )}
      {sizeOpen && (
        <Modal title="Размер текста" onClose={() => setSizeOpen(false)}>
          <div class="setting-row">
            <label for="reader-size">Размер: {settings.fontSize} px</label>
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
              Готово
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
              Отмена
            </button>
            <button
              class="primary"
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void run(action);
              }}
            >
              Подтвердить
            </button>
          </div>
        </Modal>
      )}
      {message && (
        <div
          class={"toast" + (message.error ? " error" : "")}
          role={message.error ? "alert" : "status"}
        >
          <span>{message.text}</span>
          <button
            aria-label="Закрыть сообщение"
            onClick={() => setMessage(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </>
  );
}
const root = document.getElementById("app")!;
root.replaceChildren();
render(<App />, root);
