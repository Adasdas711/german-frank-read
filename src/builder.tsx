import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { Icon, Toggle, Modal } from "./ui";
import { words, download, slug, IPA } from "./core";
import {
  checkSource,
  mergeSources,
  compileSource,
  sourceText,
  compareText,
  type Source,
} from "./builder-core";
import { voiceRequest, speak, toPhonemes, unlockAudio } from "./voice";
import * as store from "./storage";
import demoSources from "./demo-source.json";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?raw";
import "./style.css";
import {
  createTranslator,
  translateMessage,
  LocaleContext,
  type Language,
} from "./i18n";
const pdfURL = URL.createObjectURL(
  new Blob([pdfWorker], { type: "text/javascript" }),
);
pdfjs.GlobalWorkerOptions.workerSrc = pdfURL;
const steps = [
  "Исходник",
  "Сверка с PDF",
  "Произношение",
  "Проверка",
  "Скачать .fbook",
];
function Builder() {
  const [language, setLanguage] = useState<Language>(() =>
    document.documentElement.lang === "de" ? "de" : "ru",
  );
  const t = createTranslator(language);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t("Сборщик книг") + " · " + t("Немецкий по Франку");
    try {
      localStorage.setItem("franka-language", language);
    } catch {}
  }, [language]);
  async function saveLanguage(value: string) {
    const next = value === "de" ? "de" : "ru";
    setLanguage(next);
    const preferences = store.checkedSettings(
      await store.get("settings", "app"),
    );
    await store.put("settings", "app", { ...preferences, language: next });
  }

  const [startupError, setStartupError] = useState<string | null>(null);
  const [step, setStep] = useState(0),
    [source, setSource] = useState<Source | null>(null),
    [json, setJSON] = useState(""),
    [id, setId] = useState(crypto.randomUUID()),
    [revision, setRevision] = useState(0),
    [ipa, setIPA] = useState<Record<string, string>>({}),
    [origIPA, setOrigIPA] = useState<Record<string, string>>({}),
    [links, setLinks] = useState<Record<string, number>>({}),
    [dict, setDict] = useState<Record<string, string>>({}),
    [reviewed, setReviewed] = useState<string[]>([]),
    [checks, setChecks] = useState<boolean[]>([false, false, false, false]),
    [at, setAt] = useState("1.1"),
    [pdf, setPDF] = useState(""),
    [pdfSelection, setPDFSelection] = useState(""),
    [diff, setDiff] = useState<ReturnType<typeof compareText> | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [ipaFilter, setIPAFilter] = useState("all"),
    [history, setHistory] = useState<Source[]>([]),
    [undoState, setUndoState] = useState<any>(null),
    [fragmentJSON, setFragmentJSON] = useState(""),
    [ready, setReady] = useState(false),
    [summary, setSummary] = useState("");
  const file = useRef<HTMLInputElement>(null),
    pdfFile = useRef<HTMLInputElement>(null),
    draftFile = useRef<HTMLInputElement>(null),
    dictFile = useRef<HTMLInputElement>(null),
    pdfArea = useRef<HTMLTextAreaElement>(null);
  const notify = (s: string, err = false) => {
    setMessage(translateMessage(language, s));
    setError(err);
  };
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void (async () => {
      const preferences = store.checkedSettings(
        await store.get("settings", "app"),
      );
      setLanguage(preferences.language);
      const d: any = await store.get("drafts", "builder");
      if (d) {
        setSource(d.source);
        setJSON(d.json || "");
        setId(d.id);
        setRevision(d.revision || 0);
        setIPA(d.ipa || {});
        setOrigIPA(d.origIPA || {});
        setLinks(d.links || {});
        setReviewed(d.reviewed || []);
        setChecks(d.checks || [false, false, false, false]);
        setPDF(d.pdf || "");
        setStep(d.step || 0);
        notify(t("Черновик восстановлен"));
      }
      setDict((await store.get("drafts", "dictionary")) || {});
      setReady(true);
      window.__frankaBoot?.finish();
    })().catch((e) => {
      setStartupError(e instanceof Error ? e.message : String(e));
      window.__frankaBoot?.finish();
    });
  }, []);
  const draft = () => ({
    draft: "fbook",
    version: 2,
    source,
    json,
    id,
    revision,
    ipa,
    origIPA,
    links,
    reviewed,
    checks,
    pdf,
    step,
  });
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void store
        .put("drafts", "builder", draft())
        .catch((e) =>
          notify(t("Не удалось сохранить черновик: ") + e.message, true),
        );
    }, 400);
    return () => clearTimeout(timer);
  }, [
    source,
    json,
    id,
    revision,
    ipa,
    origIPA,
    links,
    reviewed,
    checks,
    pdf,
    step,
    ready,
  ]);
  const allFragments =
      source?.chapters.flatMap((c) =>
        c.fragments.map((f, i) => ({ at: `${c.n}.${i + 1}`, f })),
      ) || [],
    fragment = allFragments.find((f) => f.at === at)?.f,
    forms = source ? [...new Set(words(sourceText(source)))] : [];
  const uncertain = (f: any) =>
    f.chunks.some(
      (c: any) =>
        typeof c !== "string" &&
        (c[3] === 1 || c[1].includes("[?]") || c[2]?.includes("[?]")),
    );
  const canVerified =
    !!source &&
    reviewed.length === allFragments.length &&
    checks.every(Boolean) &&
    !allFragments.some(({ f }) => uncertain(f)) &&
    !!pdf.trim() &&
    diff !== null &&
    diff.every((d) => d.type === "same");
  function editSource(next: Source, affected = at) {
    setHistory((prev) => [...prev.slice(-19), structuredClone(source!)]);
    setUndoState({ reviewed, checks });
    setSource(next);
    setJSON(JSON.stringify(next, null, 2));
    setReviewed((prev) =>
      prev.filter((x) => affected !== "all" && x !== affected),
    );
    setChecks([false, false, false, false]);
    setDiff(null);
    setSummary("");
  }
  function load(s: Source) {
    checkSource(s);
    setSource(s);
    setJSON(JSON.stringify(s, null, 2));
    setId(crypto.randomUUID());
    setRevision(0);
    setIPA({});
    setOrigIPA({});
    setLinks({});
    setReviewed([]);
    setChecks([false, false, false, false]);
    setPDF("");
    setDiff(null);
    setAt("1.1");
    setHistory([]);
    setStep(0);
    notify(t("Исходник загружен. Черновик сохраняется автоматически."));
  }
  function parse() {
    try {
      const s = JSON.parse(json);
      if (source) {
        checkSource(s);
        editSource(s, "all");
      } else load(s);
      notify(t("Структура исходника корректна"));
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function files(files: FileList) {
    const parts = [];
    for (const f of files) {
      if (f.size > 16 * 1024 * 1024)
        throw Error(t("Исходник превышает 16 МБ."));
      parts.push(JSON.parse(await f.text()));
    }
    load(mergeSources(parts));
  }
  async function generateIPA() {
    if (!source) throw Error(t("Сначала загрузите исходник."));
    checkSource(source);
    const next = { ...ipa },
      base = { ...origIPA },
      link = { ...links };
    let rejected = 0;
    for (let i = 0; i < forms.length; i++) {
      const word = forms[i];
      notify(
        t("Произношение: {0} / {1} · {2}", {
          0: i + 1,
          1: forms.length,
          2: word,
        }),
      );
      if (!base[word]) base[word] = await voiceRequest("ipa", word);
      const ai = source.ipa?.[word];
      let accepted = ai;
      try {
        if (ai) {
          if (!IPA.test(ai)) throw Error();
          toPhonemes(ai);
        }
      } catch {
        accepted = undefined;
        rejected++;
      }
      next[word] = dict[word] || accepted || base[word];
      if (link[word] === undefined) {
        const li = source.lemmas.findIndex(
          (l) => l[0] === word || l[0].replace(/^(der|die|das) /, "") === word,
        );
        if (li >= 0) link[word] = li;
      }
    }
    setIPA(next);
    setOrigIPA(base);
    setLinks(link);
    setReviewed([]);
    setChecks([false, false, false, false]);
    notify(
      t("IPA готова: {0} форм.{1}", {
        0: forms.length,
        1: rejected
          ? " Отклонено вариантов ИИ: " + rejected + ". Использована eSpeak."
          : "",
      }),
    );
  }
  const changeChunk = (i: number, key: 1 | 2, value: string) => {
    if (!source || !fragment) return;
    const next = structuredClone(source),
      [c, f] = at.split(".").map((n) => +n - 1),
      chunk = next.chapters[c].fragments[f].chunks[i];
    if (typeof chunk !== "string") {
      chunk[key] = value;
      editSource(next);
    }
  };
  function preview(f: any) {
    return f.chunks.map((c: any) =>
      typeof c === "string" ? (
        c
      ) : (
        <span class={c[3] === 1 ? "uncertain" : ""}>
          {c[0]}{" "}
          <span class="hint">
            ({c[1]}
            {c[2] ? " = " + c[2] : ""})
          </span>
        </span>
      ),
    );
  }
  if (!ready)
    return (
      <main class="page">
        <h1>{t("Сборщик .fbook")}</h1>
        {startupError ? (
          <>
            <div role="alert">{translateMessage(language, startupError)}</div>
            <p>{t("Не удалось открыть хранилище. Данные не удалены.")}</p>
            <button onClick={() => location.reload()}>
              {t("Повторить запуск")}
            </button>
          </>
        ) : (
          <p>{t("Открываем черновик…")}</p>
        )}
      </main>
    );
  return (
    <LocaleContext.Provider value={language}>
      <header class="app-header">
        <div class="header-inner">
          <a class="brand" href="index.html">
            {t("Немецкий по Франку")}
          </a>
          <span class="muted grow">{t("Сборщик книг")}</span>
          <select
            id="interface-language"
            aria-label={t("Язык интерфейса")}
            value={language}
            disabled={busy}
            onChange={(event) =>
              void run(() => saveLanguage(event.currentTarget.value))
            }
          >
            <option value="ru">{t("Русский")}</option>
            <option value="de">Deutsch</option>
          </select>
          <a href="index.html" class="btn">
            <Icon name="back" />
            {t("К читалке")}
          </a>
        </div>
      </header>
      <main class="page builder-page">
        <div class="page-title">
          <div>
            <h1>{t("Сборщик .fbook")}</h1>
            <p class="muted" style={{ marginBottom: 0 }}>
              {t(
                "Из размеченного текста — в книгу. Всё остаётся на устройстве.",
              )}
            </p>
          </div>
        </div>
        <input
          type="file"
          ref={file}
          hidden
          accept=".json"
          multiple
          onChange={(e) => {
            if (e.currentTarget.files)
              void run(() => files(e.currentTarget.files!));
            e.currentTarget.value = "";
          }}
        />
        <input
          type="file"
          ref={pdfFile}
          hidden
          accept=".pdf"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f)
              void run(async () => {
                if (f.size > 64 * 1024 * 1024)
                  throw Error(t("PDF превышает 64 МБ."));
                const doc = await pdfjs.getDocument({
                  data: new Uint8Array(await f.arrayBuffer()),
                  useWasm: false,
                  isEvalSupported: false,
                  disableFontFace: true,
                  useSystemFonts: true,
                  verbosity: 0,
                }).promise;
                let text = "";
                for (let i = 1; i <= doc.numPages; i++) {
                  notify(
                    t("Читаем PDF: страница {0} / {1}", {
                      0: i,
                      1: doc.numPages,
                    }),
                  );
                  const page = await doc.getPage(i),
                    content = await page.getTextContent();
                  text +=
                    content.items
                      .map((x: any) => x.str + (x.hasEOL ? "\n" : " "))
                      .join("") + "\n";
                }
                await doc.destroy();
                setPDF(text);
                setDiff(null);
                setChecks([false, false, false, false]);
                notify(
                  text.trim()
                    ? t(
                        "PDF прочитан. Проверьте колонтитулы и выполните сверку.",
                      )
                    : t(
                        "У PDF нет текстового слоя. Возможна только ручная проверка; метка останется «Автотекст».",
                      ),
                );
              });
            e.currentTarget.value = "";
          }}
        />
        <input
          type="file"
          ref={draftFile}
          hidden
          accept=".json"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f)
              void run(async () => {
                const d = JSON.parse(await f.text());
                if (
                  d.draft !== "fbook" ||
                  d.version !== 2 ||
                  typeof d.id !== "string"
                )
                  throw Error(t("Неверный формат черновика."));
                if (d.source) checkSource(d.source);
                setSource(d.source);
                setJSON(d.json || JSON.stringify(d.source, null, 2));
                setId(d.id);
                setRevision(d.revision || 0);
                setIPA(d.ipa || {});
                setOrigIPA(d.origIPA || {});
                setLinks(d.links || {});
                setPDF(d.pdf || "");
                setReviewed([]);
                setChecks([false, false, false, false]);
                setStep(0);
                setDiff(null);
                notify(
                  t(
                    "Черновик импортирован. Перед меткой «Проверено» повторите проверки.",
                  ),
                );
              });
            e.currentTarget.value = "";
          }}
        />
        <input
          type="file"
          ref={dictFile}
          hidden
          accept=".json"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f)
              void run(async () => {
                const d = JSON.parse(await f.text());
                if (!d || Array.isArray(d) || typeof d !== "object")
                  throw Error(t("Нужен словарь «форма → IPA»."));
                for (const [k, v] of Object.entries(d)) {
                  if (typeof v !== "string" || !IPA.test(v))
                    throw Error(t("Неверная IPA: ") + k);
                  toPhonemes(v);
                }
                const next = { ...dict, ...d };
                setDict(next);
                await store.put("drafts", "dictionary", next);
                notify(t("Словарь импортирован"));
              });
            e.currentTarget.value = "";
          }}
        />
        <div class="row" style={{ marginBottom: 24 }}>
          <button onClick={() => file.current?.click()} disabled={busy}>
            <Icon name="upload" />
            {t("Загрузить исходники")}
          </button>
          <button onClick={() => draftFile.current?.click()} disabled={busy}>
            {t("Открыть черновик")}
          </button>
          <button
            onClick={() =>
              void run(async () => {
                await store.put("drafts", "builder", draft());
                download(
                  JSON.stringify(draft(), null, 2),
                  slug(source?.meta.title || "book") + ".fbook-draft.json",
                  "application/json",
                );
                notify(t("Черновик сохранён"));
              })
            }
          >
            <Icon name="download" />
            {t("Сохранить черновик")}
          </button>
          <small class="muted">{t("Автосохранение включено")}</small>
        </div>
        <div class="builder-grid">
          <nav class="builder-nav" aria-label={t("Этапы сборки")}>
            {steps.map((name, i) => (
              <button
                class={step === i ? "primary" : ""}
                disabled={(i > 0 && !source) || busy}
                onClick={() => setStep(i)}
              >
                {i + 1}. {t(name)}
              </button>
            ))}
          </nav>
          <div class="stack">
            {step === 0 && (
              <section class="panel stack">
                <div class="row between">
                  <h2>{t("Исходник книги")}</h2>
                  <button
                    onClick={() => {
                      if (
                        source &&
                        !window.confirm(
                          t(
                            "Заменить текущий черновик демонстрационным исходником?",
                          ),
                        )
                      )
                        return;
                      load(demoSources[0] as any);
                    }}
                  >
                    {t("Пример")}
                  </button>
                </div>
                <p class="muted" style={{ margin: 0 }}>
                  {t(
                    "Загрузите book.source.json из ответа ИИ. Части одной книги можно выбрать вместе. Либо вставьте JSON ниже и нажмите «Проверить».",
                  )}
                </p>
                <textarea
                  aria-label={t("Исходник JSON")}
                  spellcheck={false}
                  value={json}
                  placeholder='{"meta": {"title": "…", "author": "…", "level": "A2", "source": "…", "license": "public-domain"}, "chapters": […], "lemmas": […]}'
                  onInput={(e) => setJSON(e.currentTarget.value)}
                />
                <div class="row">
                  <button class="primary" onClick={parse} disabled={busy}>
                    {t("Проверить и применить JSON")}
                  </button>
                  <small class="muted">
                    {t("Немецкий текст и подсказки не отправляются в сеть")}
                  </small>
                </div>
                {source && (
                  <>
                    <div class="line" />
                    <h3>{t("Паспорт книги")}</h3>
                    <div class="field-grid">
                      {[
                        ["title", t("Название")],
                        ["titleRu", t("По-русски")],
                        ["author", t("Автор")],
                        ["source", t("Источник")],
                        ["license", t("Лицензия")],
                      ].map(([k, label]) => (
                        <label class="field">
                          {t(label)}
                          <input
                            class="text-input"
                            value={(source.meta as any)[k] || ""}
                            onChange={(e) => {
                              const next = structuredClone(source);
                              (next.meta as any)[k] = e.currentTarget.value;
                              editSource(next, "all");
                            }}
                          />
                        </label>
                      ))}
                      <label class="field">
                        {t("Уровень")}
                        <select
                          value={source.meta.level}
                          onChange={(e) => {
                            const next = structuredClone(source);
                            next.meta.level = e.currentTarget.value;
                            editSource(next, "all");
                          }}
                        >
                          {["A1", "A2", "B1", "B2", "C1", "C2"].map((x) => (
                            <option>{x}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div class="notice">
                      {source.chapters.length} {t(" глав · ")}
                      {allFragments.length} {t("отрывков · ")}
                      {words(sourceText(source)).length}{" "}
                      {t(
                        " слов. UUID сохраняется в черновике и не меняется при повторной сборке.",
                      )}
                    </div>
                    <button class="primary" onClick={() => setStep(1)}>
                      {t("Далее: сверка с PDF")}
                      <Icon name="next" />
                    </button>
                  </>
                )}
              </section>
            )}
            {step === 1 && source && (
              <section class="panel stack">
                <h2>{t("Сверка с оригиналом")}</h2>
                <p class="muted" style={{ margin: 0 }}>
                  {t(
                    "Загрузите тот же PDF, по которому подготовлен исходник. Красным показаны слова PDF, пропущенные в исходнике; зелёным — лишние слова исходника. Регистр и старая орфография учитываются. Удалите из поля повторяющиеся колонтитулы перед сверкой.",
                  )}
                </p>
                <div class="row">
                  <button
                    disabled={busy}
                    onClick={() => pdfFile.current?.click()}
                  >
                    <Icon name="upload" />
                    {t("Открыть PDF")}
                  </button>
                  <button
                    disabled={busy || !pdf.trim()}
                    class="primary"
                    onClick={() => {
                      const d = compareText(pdf, sourceText(source));
                      setDiff(d);
                      notify(
                        d.every((x) => x.type === "same")
                          ? t("Слова PDF и исходника совпадают.")
                          : t("Найдены расхождения: ") +
                              d.filter((x) => x.type !== "same").length +
                              t(" слов."),
                      );
                    }}
                  >
                    {t("Сверить текст")}
                  </button>
                </div>
                <textarea
                  ref={pdfArea}
                  aria-label={t("Текст PDF")}
                  value={pdf}
                  placeholder={t(
                    "Здесь появится текст PDF. Для текста без PDF можно вставить оригинал вручную; метка «Проверено» требует ручной сверки с источником.",
                  )}
                  onInput={(e) => {
                    setPDF(e.currentTarget.value);
                    setDiff(null);
                    setChecks([false, false, false, false]);
                  }}
                  onSelect={(e) =>
                    setPDFSelection(
                      e.currentTarget.value.slice(
                        e.currentTarget.selectionStart,
                        e.currentTarget.selectionEnd,
                      ),
                    )
                  }
                />
                {diff && (
                  <>
                    <h3>
                      {diff.every((x) => x.type === "same")
                        ? t("✓ Слова совпадают")
                        : t("Расхождения с оригиналом")}
                    </h3>
                    <div class="diff">
                      {diff.map((d) =>
                        d.type === "same" ? (
                          d.text + " "
                        ) : d.type === "missing" ? (
                          <del>{d.text} </del>
                        ) : (
                          <ins>{d.text} </ins>
                        ),
                      )}
                    </div>
                    <div class="notice">
                      {t(
                        "Сверка сравнивает последовательности слов, не пунктуацию. При проверке каждого отрывка сверьте также знаки препинания и смысл подсказок.",
                      )}
                    </div>
                  </>
                )}
                <button onClick={() => setStep(2)}>
                  {t("Далее: произношение")}
                  <Icon name="next" />
                </button>
              </section>
            )}
            {step === 2 && source && (
              <section class="panel stack">
                <div class="row between">
                  <h2>{t("Произношение")}</h2>
                  <button
                    class="primary"
                    disabled={busy}
                    onClick={() => void run(generateIPA)}
                  >
                    {t("Создать IPA · ")}
                    {forms.length} {t(" форм")}
                  </button>
                </div>
                <p class="muted" style={{ margin: 0 }}>
                  {t(
                    "Приоритет: ваш словарь → допустимая IPA из исходника → eSpeak NG. Словарную форму можно связать вручную: автоматическое распознавание склонений здесь не используется.",
                  )}
                </p>
                <div class="row">
                  <select
                    aria-label={t("Фильтр IPA")}
                    value={ipaFilter}
                    onChange={(e) => setIPAFilter(e.currentTarget.value)}
                  >
                    <option value="all">{t("Все формы")}</option>
                    <option value="diff">{t("ИИ ≠ eSpeak")}</option>
                    <option value="rejected">{t("Отклонено")}</option>
                    <option value="edited">{t("Исправлено")}</option>
                  </select>
                  <button onClick={() => dictFile.current?.click()}>
                    {t("Импорт словаря")}
                  </button>
                  <button
                    onClick={() =>
                      download(
                        JSON.stringify(dict, null, 2),
                        "franka-ipa-dictionary.json",
                        "application/json",
                      )
                    }
                  >
                    {t("Экспорт словаря")}
                  </button>
                </div>
                <div class="scroll-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Форма")}</th>
                        <th>{t("IPA · итог")}</th>
                        <th>{t("Лемма")}</th>
                        <th>{t("Источник / eSpeak")}</th>
                        <th>{t("Голос")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forms
                        .filter((word) => {
                          if (ipaFilter === "edited") return dict[word];
                          if (ipaFilter === "diff")
                            return (
                              source.ipa?.[word] &&
                              origIPA[word] &&
                              source.ipa[word] !== origIPA[word]
                            );
                          if (ipaFilter === "rejected") {
                            try {
                              if (source.ipa?.[word])
                                toPhonemes(source.ipa[word]);
                              return false;
                            } catch {
                              return true;
                            }
                          }
                          return true;
                        })
                        .map((word) => (
                          <tr>
                            <td lang="de">{word}</td>
                            <td>
                              <input
                                class="text-input"
                                aria-label={"IPA " + word}
                                value={ipa[word] || ""}
                                onChange={(e) => {
                                  const v = e.currentTarget.value;
                                  try {
                                    if (!v.trim() || !IPA.test(v))
                                      throw Error(t("Неверная IPA"));
                                    toPhonemes(v);
                                    const d = { ...dict, [word]: v };
                                    setDict(d);
                                    void store.put("drafts", "dictionary", d);
                                    setIPA((p) => ({ ...p, [word]: v }));
                                    setReviewed([]);
                                    setChecks([false, false, false, false]);
                                  } catch (err) {
                                    notify((err as Error).message, true);
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <select
                                aria-label={t("Лемма ") + word}
                                value={links[word] ?? -1}
                                onChange={(e) => {
                                  const next = { ...links };
                                  if (+e.currentTarget.value < 0)
                                    delete next[word];
                                  else next[word] = +e.currentTarget.value;
                                  setLinks(next);
                                  setReviewed([]);
                                }}
                              >
                                <option value={-1}>{t("Без леммы")}</option>
                                {source.lemmas.map((l, i) => (
                                  <option value={i}>
                                    {l[0]} — {l[1]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <small class="muted">
                                {dict[word]
                                  ? t("Человек")
                                  : source.ipa?.[word] === ipa[word]
                                    ? t("ИИ")
                                    : "eSpeak"}
                                <br />
                                {origIPA[word]}
                              </small>
                            </td>
                            <td>
                              <button
                                class="icon"
                                disabled={busy || !ipa[word]}
                                aria-label={t("Озвучить ") + word}
                                onClick={() => {
                                  unlockAudio();
                                  void run(async () => {
                                    await speak(word, ipa[word], {
                                      voice: "espeak",
                                      rate: 1,
                                    });
                                  });
                                }}
                              >
                                <Icon name="sound" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => setStep(3)}>
                  {t("Далее: ручная проверка")}
                  <Icon name="next" />
                </button>
              </section>
            )}
            {step === 3 && source && fragment && (
              <section class="panel stack">
                <div class="row between">
                  <h2>{t("Проверка отрывков")}</h2>
                  <small class="muted">
                    {reviewed.length} {t(" из ")}
                    {allFragments.length} {t(" проверено")}
                  </small>
                </div>
                <div class="row">
                  <select
                    aria-label={t("Отрывок для проверки")}
                    value={at}
                    onChange={(e) => {
                      setAt(e.currentTarget.value);
                      setFragmentJSON("");
                    }}
                  >
                    {allFragments.map((x) => (
                      <option value={x.at}>
                        {reviewed.includes(x.at)
                          ? "✓ "
                          : uncertain(x.f)
                            ? "⚠ "
                            : ""}
                        {x.at} ·{" "}
                        {x.f.chunks
                          .map((c) => (typeof c === "string" ? c : c[0]))
                          .join("")
                          .slice(0, 50)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!history.length}
                    onClick={() => {
                      setSource(history.at(-1)!);
                      setJSON(JSON.stringify(history.at(-1), null, 2));
                      setHistory(history.slice(0, -1));
                      setReviewed([]);
                      setChecks([false, false, false, false]);
                      setDiff(null);
                    }}
                  >
                    {t("Отменить правку")}
                  </button>
                </div>
                <div class="preview" style={{ marginTop: 0 }}>
                  {preview(fragment)}
                </div>
                {fragment.chunks.map((c, i) => (
                  <div class="builder-chunk">
                    {typeof c === "string" ? (
                      <div class="row">
                        <span lang="de">{c || t("Пробел")}</span>
                        <button
                          onClick={() => {
                            const next = structuredClone(source),
                              [ci, fi] = at.split(".").map((x) => +x - 1);
                            next.chapters[ci].fragments[fi].chunks[i] = [c, ""];
                            editSource(next);
                          }}
                        >
                          {t("Добавить подсказку")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <strong lang="de">{c[0]}</strong>
                        <input
                          class="text-input"
                          aria-label={t("Подсказка ") + (i + 1)}
                          value={c[1]}
                          placeholder={t("Дословная подсказка")}
                          onChange={(e) =>
                            changeChunk(i, 1, e.currentTarget.value)
                          }
                        />
                        <input
                          class="text-input"
                          aria-label={t("Смысл ") + (i + 1)}
                          value={c[2] || ""}
                          placeholder={t("Перевод по смыслу (необязательно)")}
                          onChange={(e) =>
                            changeChunk(i, 2, e.currentTarget.value)
                          }
                        />
                        <div class="row" style={{ marginTop: 10 }}>
                          <Toggle
                            checked={c[3] === 1}
                            onChange={(v) => {
                              const next = structuredClone(source),
                                [ci, fi] = at.split(".").map((x) => +x - 1),
                                chunk = next.chapters[ci].fragments[fi].chunks[
                                  i
                                ] as any;
                              if (v) {
                                chunk[2] ??= null;
                                chunk[3] = 1;
                              } else {
                                chunk.splice(3);
                                if (chunk[2] == null) chunk.splice(2);
                              }
                              editSource(next);
                            }}
                          >
                            {t("Не уверен")}
                          </Toggle>
                          <button
                            onClick={() => {
                              const next = structuredClone(source),
                                [ci, fi] = at.split(".").map((x) => +x - 1);
                              next.chapters[ci].fragments[fi].chunks[i] = c[0];
                              editSource(next);
                            }}
                          >
                            {t("Убрать подсказку")}
                          </button>
                          <button
                            disabled={i === fragment.chunks.length - 1}
                            onClick={() => {
                              const next = structuredClone(source),
                                [ci, fi] = at.split(".").map((x) => +x - 1),
                                chunks = next.chapters[ci].fragments[fi].chunks,
                                n = chunks[i + 1];
                              chunks.splice(i, 2, [
                                c[0] + (typeof n === "string" ? n : n[0]),
                                c[1],
                                c[2] || null,
                                1,
                              ] as any);
                              editSource(next);
                            }}
                          >
                            {t("Объединить со следующим")}
                          </button>
                          <button
                            onClick={() => {
                              const pos = window.prompt(
                                t(
                                  "После какого слова разделить? Укажите число слов первой части.",
                                ),
                              );
                              if (!pos) return;
                              const m = [
                                  ...c[0].matchAll(
                                    /[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*/gu,
                                  ),
                                ],
                                n = +pos;
                              if (
                                !Number.isInteger(n) ||
                                n < 1 ||
                                n >= m.length
                              ) {
                                notify(
                                  t("Нужно число от 1 до ") + (m.length - 1),
                                  true,
                                );
                                return;
                              }
                              const p = m[n].index!,
                                next = structuredClone(source),
                                [ci, fi] = at.split(".").map((x) => +x - 1);
                              next.chapters[ci].fragments[fi].chunks.splice(
                                i,
                                1,
                                [c[0].slice(0, p), "[?]", null, 1] as any,
                                [c[0].slice(p), "[?]", null, 1] as any,
                              );
                              editSource(next);
                            }}
                          >
                            {t("Разделить")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <label class="field">
                  {t("Перевод · одно предложение на строку")}
                  <textarea
                    style={{ minHeight: 100 }}
                    value={fragment.translation.join("\n")}
                    onChange={(e) => {
                      const next = structuredClone(source),
                        [ci, fi] = at.split(".").map((x) => +x - 1);
                      next.chapters[ci].fragments[fi].translation =
                        e.currentTarget.value
                          .split("\n")
                          .filter((x) => x.trim());
                      editSource(next);
                    }}
                  />
                </label>
                <details>
                  <summary>{t("Исправление по PDF и переразметка")}</summary>
                  <p class="muted">
                    {t(
                      "На шаге «Сверка» выделите в текстовом поле правильный отрывок PDF. «Взять из PDF» заменит текущий отрывок одной неподтверждённой подсказкой.",
                    )}
                  </p>
                  <button
                    disabled={!pdfSelection}
                    onClick={() => {
                      if (!pdfSelection.trim()) return;
                      const next = structuredClone(source),
                        [ci, fi] = at.split(".").map((x) => +x - 1);
                      next.chapters[ci].fragments[fi].chunks = [
                        [pdfSelection, "[?]", null, 1] as any,
                      ];
                      editSource(next);
                      setIPA({});
                      setOrigIPA({});
                      notify(t("Текст взят из PDF. Обновите подсказки и IPA."));
                    }}
                  >
                    {t("Взять из PDF")}
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        const text = fragment.chunks
                          .map((c) => (typeof c === "string" ? c : c[0]))
                          .join("");
                        const prompt =
                          'Разметь немецкий отрывок по методу Ильи Франка. Сохрани текст символ в символ, включая пунктуацию. Дай дословные русские подсказки после смысловых групп, идиомы — дословно и по смыслу. Сомнительное пометь 1. Верни только JSON {"chunks": ["строка" или ["немецкий", "подсказка", "смысл или null", 1]], "translation": ["перевод одного предложения"]}. Текст:\n' +
                          (pdfSelection || text);
                        try {
                          await navigator.clipboard.writeText(prompt);
                          notify(t("Запрос скопирован"));
                        } catch {
                          download(prompt, "fragment-prompt.txt", "text/plain");
                        }
                      })
                    }
                  >
                    {t("Скопировать запрос")}
                  </button>
                  <textarea
                    aria-label={t("Ответ ИИ для отрывка")}
                    value={fragmentJSON}
                    placeholder={t(
                      "Вставьте JSON отрывка с chunks и translation",
                    )}
                    onInput={(e) => setFragmentJSON(e.currentTarget.value)}
                  />
                  <button
                    onClick={() => {
                      try {
                        const f = JSON.parse(fragmentJSON),
                          next = structuredClone(source),
                          [ci, fi] = at.split(".").map((x) => +x - 1),
                          before = fragment.chunks
                            .map((c) => (typeof c === "string" ? c : c[0]))
                            .join(""),
                          after = f.chunks
                            .map((c: any) => (typeof c === "string" ? c : c[0]))
                            .join("");
                        if (before !== after)
                          throw Error(
                            t(
                              "Немецкий текст изменён. Сначала используйте «Взять из PDF».",
                            ),
                          );
                        next.chapters[ci].fragments[fi] = f;
                        checkSource(next);
                        editSource(next);
                        setFragmentJSON("");
                      } catch (e) {
                        notify((e as Error).message, true);
                      }
                    }}
                  >
                    {t("Применить ответ")}
                  </button>
                </details>
                <div class="row">
                  <button
                    class="primary"
                    disabled={uncertain(fragment)}
                    onClick={() => {
                      try {
                        checkSource(source);
                        setReviewed((prev) => [...new Set([...prev, at])]);
                        const i = allFragments.findIndex((x) => x.at === at);
                        if (i < allFragments.length - 1)
                          setAt(allFragments[i + 1].at);
                        notify(t("Отрывок отмечен проверенным"));
                      } catch (e) {
                        notify((e as Error).message, true);
                      }
                    }}
                  >
                    {t("Готово, дальше")}
                    <Icon name="check" />
                  </button>
                  <button
                    onClick={() => {
                      const next = allFragments.find(
                        (x) => uncertain(x.f) && x.at !== at,
                      );
                      if (next) setAt(next.at);
                      else notify(t("Других сомнительных отрывков нет"));
                    }}
                  >
                    {t("К следующему сомнению")}
                  </button>
                </div>
                <div class="notice">
                  {t(
                    "Отрывок с «не уверен» или [?] нельзя отметить проверенным. Ручную проверку смыслов и произношения выполняет человек.",
                  )}
                </div>
              </section>
            )}
            {step === 4 && source && (
              <section class="panel stack">
                <h2>{t("Готовая книга")}</h2>
                <div>
                  <h3>{source.meta.title}</h3>
                  <p class="muted">
                    {source.meta.author} · {source.meta.level} ·{" "}
                    {allFragments.length} {t(" отрывков")}
                  </p>
                  <span class="badge">
                    {canVerified ? t("Проверено") : t("Автотекст")}
                  </span>
                </div>
                <div class="checklist">
                  {[
                    t(
                      "Текст и пунктуация сверены с оригиналом; ничего не пропущено и не изменено.",
                    ),
                    t(
                      "Дословные подсказки и идиомы проверены, смысл соответствует контексту.",
                    ),
                    t(
                      "IPA и произношение, включая имена и омографы, прослушаны и проверены.",
                    ),
                    t(
                      "Источник, лицензия, леммы, переводы и уровень книги проверены.",
                    ),
                  ].map((label, i) => (
                    <label>
                      <input
                        type="checkbox"
                        checked={checks[i]}
                        onChange={(e) => {
                          const n = [...checks];
                          n[i] = e.currentTarget.checked;
                          setChecks(n);
                        }}
                      />
                      {t(label)}
                    </label>
                  ))}
                </div>
                <div class="notice">
                  {t(
                    "Для метки «Проверено» нужны: все отрывки проверены, нет [?], все пункты выше отмечены и последняя сверка с оригиналом без расхождений. Иначе файл собирается с честной меткой «Автотекст».",
                  )}
                </div>
                <button
                  class="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = compileSource(
                        source,
                        id,
                        revision + 1,
                        ipa,
                        links,
                        canVerified,
                      );
                      download(
                        result.bytes,
                        slug(source.meta.title) + ".fbook",
                      );
                      setRevision(revision + 1);
                      setSummary(
                        t(
                          "Версия {0} · {1} КБ · {2} форм с IPA · {3}. Архив проверен обратной распаковкой и CRC-32.",
                          {
                            0: revision + 1,
                            1: (result.bytes.length / 1024).toFixed(1),
                            2: Object.keys(result.content.f).length,
                            3: canVerified ? "Проверено" : "Автотекст",
                          },
                        ),
                      );
                      notify(t("Книга собрана и скачана"));
                    })
                  }
                >
                  <Icon name="download" />
                  {t("Собрать и скачать .fbook")}
                </button>
                {summary && <p role="status">{summary}</p>}
                <small class="muted">
                  {t(
                    "Повторная сборка сохраняет UUID и увеличивает revision. Храните черновик для последующих исправлений.",
                  )}
                </small>
              </section>
            )}
          </div>
        </div>
      </main>
      {message && (
        <div
          class={"toast" + (error ? " error" : "")}
          role={error ? "alert" : "status"}
        >
          <span>
            {busy ? "⏳ " : ""}
            {message}
          </span>
          <button
            aria-label={t("Закрыть сообщение")}
            onClick={() => setMessage("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </LocaleContext.Provider>
  );
}
const root = document.getElementById("app")!;
root.replaceChildren();
render(<Builder />, root);
