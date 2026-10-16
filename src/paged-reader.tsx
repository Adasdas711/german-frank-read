import type { ComponentChildren } from "preact";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { plain, type Chunk, type Content, type Manifest } from "./core";
import type { Settings } from "./storage";
import { useT } from "./i18n";
import { Icon, Toggle } from "./ui";

type Props = {
  manifest: Manifest;
  content: Content;
  settings: Settings;
  mode: string;
  at: string;
  offset: number;
  onPosition(at: string, offset: number): void;
  onSettings(settings: Partial<Settings>): void;
  onMode(mode: string): void;
  onJump(at: string): void;
  onComplete(): void;
  onListen(): void;
  busy: boolean;
  renderFragment(chunks: Chunk[], at: string): ComponentChildren;
  wordPanel: ComponentChildren;
  onDismissWord(): void;
};
type Layout = {
  width: number;
  gap: number;
  columns: number;
  count: number;
  ready: boolean;
};
const roman = (n: number) =>
  n < 11
    ? ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n - 1]
    : String(n);

export function PagedReader(props: Props) {
  const {
    manifest,
    content,
    settings,
    mode,
    at,
    offset,
    renderFragment,
    wordPanel,
  } = props;
  const t = useT();
  const [controls, setControls] = useState(false),
    [panel, setPanel] = useState<"type" | "contents" | null>(null);
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState<Layout>({
    width: 0,
    gap: 0,
    columns: 1,
    count: 1,
    ready: false,
  });
  const viewport = useRef<HTMLDivElement>(null),
    text = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null);
  const state = useRef({ props, page, layout });
  state.current = { props, page, layout };
  const anchor = useRef({ at, offset });
  const lastReported = useRef<string | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null),
    swiped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lookupTimer = useRef<ReturnType<typeof setTimeout>>();
  const allowLookup = useRef(false),
    longPressed = useRef(false);
  const openWord = (word: HTMLElement) => {
    allowLookup.current = true;
    word.click();
    allowLookup.current = false;
    setControls(false);
    setPanel(null);
  };
  const hide = useCallback(() => {
    setControls(false);
    setPanel(null);
  }, []);
  const show = () => {
    setControls(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (
        !root.current?.contains(document.activeElement) ||
        document.activeElement === root.current
      )
        setControls(false);
    }, 3500);
  };
  useLayoutEffect(() => {
    document.documentElement.classList.add("reading-pages");
    root.current?.focus({ preventScroll: true });
    return () => {
      document.documentElement.classList.remove("reading-pages");
      clearTimeout(timer.current);
      clearTimeout(lookupTimer.current);
    };
  }, []);
  const pages = useMemo(
    () =>
      content.c.map((chapter, ci) => (
        <section class="folio-chapter" key={ci}>
          <h2 class="folio-chapter-title">
            <span>{roman(ci + 1)}</span>
            <small>{manifest.chapters[ci][0]}</small>
          </h2>
          {chapter.map((chunks, fi) => (
            <section
              key={fi}
              class="folio-fragment"
              data-reading-at={`${ci + 1}.${fi + 1}`}
            >
              {renderFragment(chunks, `${ci + 1}.${fi + 1}`)}
            </section>
          ))}
        </section>
      )),
    [content, manifest, renderFragment],
  );

  function columnOf(element: Element, geometry: Layout) {
    const box = element.getClientRects()[0] || element.getBoundingClientRect();
    const origin = text.current!.getBoundingClientRect().left;
    return Math.max(
      0,
      Math.floor(
        (box.left - origin + 1) /
          ((geometry.width + geometry.gap) / geometry.columns),
      ),
    );
  }
  const positionFor = (geometry: Layout) => {
    const bookmark = anchor.current;
    const fragment = text.current?.querySelector<HTMLElement>(
      `[data-reading-at="${bookmark.at}"]`,
    );
    if (!fragment) return 0;
    const words = [
      ...fragment.querySelectorAll<HTMLElement>("[data-book-char]"),
    ];
    const [ci, fi] = bookmark.at.split(".").map((n) => +n - 1);
    const length = plain(content.c[ci]?.[fi] || []).length;
    const sourceOffset =
      mode !== "frank" || !settings.showClean
        ? bookmark.offset % (length + 1)
        : bookmark.offset;
    const word =
      words.find((word) => Number(word.dataset.bookChar) >= sourceOffset) ||
      words.at(-1) ||
      fragment;
    return Math.min(
      geometry.count - 1,
      Math.floor(columnOf(word, geometry) / geometry.columns),
    );
  };
  // Measure columns after fonts/layout changes. The bookmark is a source-text offset,
  // so it survives a different font, window width or number of facing pages.
  useLayoutEffect(() => {
    let frame = 0,
      settle = 0,
      closed = false;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (closed || !viewport.current || !text.current) return;
        const width = viewport.current.clientWidth;
        const columns = width >= 940 ? 2 : 1;
        const gap =
          columns === 2 ? Math.min(100, Math.max(52, width * 0.075)) : 48;
        text.current.style.columnCount = String(columns);
        text.current.style.columnGap = gap + "px";
        const columnWidth = (width - gap * (columns - 1)) / columns;
        const count = Math.max(
          1,
          Math.ceil(
            (text.current.scrollWidth + gap - 0.5) /
              (columnWidth + gap) /
              columns,
          ),
        );
        const next = { width, gap, columns, count, ready: true };
        const restored = positionFor(next);
        text.current.style.transition = "none";
        setLayout(next);
        setPage(restored);
        cancelAnimationFrame(settle);
        settle = requestAnimationFrame(() => {
          if (text.current) text.current.style.transition = "";
        });
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current!);
    document.fonts.ready.then(() => {
      if (!closed) measure();
    });
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settle);
      observer.disconnect();
    };
  }, [
    content,
    mode,
    settings.font,
    settings.fontSize,
    settings.showClean,
    pages,
  ]);
  useLayoutEffect(() => {
    const key = at + ":" + offset;
    if (key === lastReported.current) return;
    anchor.current = { at, offset };
    if (!layout.ready) return;
    setPage(positionFor(layout));
  }, [at, offset]);
  // The transform is written every commit, including a reflow with the same page.
  useLayoutEffect(() => {
    if (text.current)
      text.current.style.transform = `translateX(${-page * (layout.width + layout.gap)}px)`;
    if (viewport.current) viewport.current.scrollLeft = 0;
  });

  function report(next: number) {
    const geometry = state.current.layout;
    const nodes = [
      ...text.current!.querySelectorAll<HTMLElement>("[data-book-char]"),
    ];
    const targetColumn = next * geometry.columns;
    let left = 0,
      right = nodes.length - 1,
      found = nodes.length;
    while (left <= right) {
      const middle = (left + right) >>> 1;
      if (columnOf(nodes[middle], geometry) >= targetColumn) {
        found = middle;
        right = middle - 1;
      } else left = middle + 1;
    }
    const word = nodes[found] || nodes.at(-1);
    const address =
      word?.closest<HTMLElement>("[data-reading-at]")?.dataset.readingAt ||
      "1.1";
    const char = Number(word?.dataset.bookChar) || 0;
    anchor.current = { at: address, offset: char };
    lastReported.current = address + ":" + char;
    state.current.props.onPosition(address, char);
  }
  const turn = (delta: number) => {
    if (!state.current.layout.ready) return;
    const next = Math.max(
      0,
      Math.min(state.current.layout.count - 1, state.current.page + delta),
    );
    if (next === state.current.page) return;
    report(next);
    setPage(next);
    hide();
    state.current.page = next;
    if (text.current)
      text.current.style.transform = `translateX(${-next * (state.current.layout.width + state.current.layout.gap)}px)`;
  };
  const jumpPage = (next: number) => {
    report(next);
    setPage(next);
    state.current.page = next;
    if (text.current)
      text.current.style.transform = `translateX(${-next * (state.current.layout.width + state.current.layout.gap)}px)`;
  };
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hide();
        state.current.props.onDismissWord();
        root.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Tab") {
        setControls(true);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      const target = event.target as HTMLElement;
      if (
        target.closest(".folio-popover,.word-panel") ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      )
        return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        turn(1);
      }
      if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        turn(-1);
      }
      if (event.key === "Home") {
        event.preventDefault();
        jumpPage(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        jumpPage(state.current.layout.count - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useLayoutEffect(() => {
    let distance = 0,
      last = 0;
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        (event.target as HTMLElement).closest(".folio-popover,.word-panel")
      )
        return;
      event.preventDefault();
      const amount =
        (Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY) * (event.deltaMode === 1 ? 16 : 1);
      if (Math.sign(distance) !== Math.sign(amount)) distance = 0;
      distance += amount;
      if (Math.abs(distance) > 45 && performance.now() - last > 380) {
        turn(distance > 0 ? 1 : -1);
        distance = 0;
        last = performance.now();
      }
    };
    root.current!.addEventListener("wheel", wheel, { passive: false });
    return () => root.current?.removeEventListener("wheel", wheel);
  }, []);
  const pageNumber = page * layout.columns + 1;
  return (
    <div
      class="books-reader"
      ref={root}
      tabIndex={-1}
      aria-label={t("Чтение книги")}
      data-ready={layout.ready}
      data-columns={layout.columns}
      onPointerDown={(event) => {
        swiped.current = false;
        longPressed.current = false;
        clearTimeout(lookupTimer.current);
        const word = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-book-char]",
        );
        if (word && event.pointerType === "touch")
          lookupTimer.current = setTimeout(() => {
            longPressed.current = true;
            openWord(word);
          }, 550);
        if (
          event.pointerType === "touch" &&
          !(event.target as HTMLElement).closest(
            ".folio-toolbar,.folio-popover,.folio-bottom,.word-panel",
          )
        )
          touch.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const start = touch.current;
        if (
          start &&
          (Math.abs(event.clientX - start.x) > 12 ||
            Math.abs(event.clientY - start.y) > 12)
        )
          clearTimeout(lookupTimer.current);
      }}
      onPointerCancel={() => {
        touch.current = null;
        clearTimeout(lookupTimer.current);
      }}
      onPointerUp={(event) => {
        clearTimeout(lookupTimer.current);
        const start = touch.current;
        touch.current = null;
        if (!start || window.getSelection()?.toString()) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiped.current = true;
          turn(dx < 0 ? 1 : -1);
        }
      }}
      onClickCapture={(event) => {
        if ((swiped.current || longPressed.current) && !allowLookup.current) {
          longPressed.current = false;
          event.preventDefault();
          event.stopPropagation();
          swiped.current = false;
        }
      }}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button,a,input,select,label,.folio-popover,.word-panel",
          )
        )
          return;
        if (window.getSelection()?.toString()) return;
        if (panel) {
          hide();
          return;
        }
        const fraction = event.clientX / innerWidth;
        if (fraction < 0.12) turn(-1);
        else if (fraction > 0.88) turn(1);
        else {
          if (controls) hide();
          else show();
        }
      }}
    >
      <div class="folio-running-title">{manifest.title}</div>
      <header
        class={"folio-toolbar" + (controls || panel ? " visible" : "")}
        onFocusCapture={() => setControls(true)}
      >
        <div class="folio-toolbar-start">
          <a
            class="folio-round"
            href="#/home"
            aria-label={t("Назад")}
            title={t("Назад")}
          >
            <Icon name="back" />
          </a>
          <button
            class="folio-round"
            aria-label={t("Оглавление")}
            aria-expanded={panel === "contents"}
            onClick={() => {
              setPanel(panel === "contents" ? null : "contents");
              setControls(true);
            }}
          >
            <Icon name="menu" />
          </button>
        </div>
        <span class="folio-toolbar-title">{manifest.title}</span>
        <div class="folio-toolbar-end">
          <button
            class="folio-round"
            aria-label={t("Прослушать отрывок")}
            disabled={props.busy}
            onClick={props.onListen}
          >
            <Icon name="sound" />
          </button>
          <button
            class="folio-round folio-aa"
            aria-label={t("Параметры чтения")}
            aria-expanded={panel === "type"}
            onClick={() => {
              setPanel(panel === "type" ? null : "type");
              setControls(true);
            }}
          >
            Aa
          </button>
        </div>
      </header>
      <div class="folio-viewport" ref={viewport}>
        <main
          class="folio-columns"
          ref={text}
          aria-label={t("Текст книги")}
          onClickCapture={(event) => {
            if (
              (event.target as HTMLElement).closest("[data-book-char]") &&
              !allowLookup.current &&
              event.detail > 0
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (controls) hide();
              else show();
            }
          }}
          onDblClick={(event) => {
            const word = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-book-char]",
            );
            if (word) {
              event.preventDefault();
              window.getSelection()?.removeAllRanges();
              openWord(word);
            }
          }}
          onContextMenu={(event) => {
            const word = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-book-char]",
            );
            if (word) {
              event.preventDefault();
              openWord(word);
            }
          }}
          style={{ visibility: layout.ready ? "visible" : "hidden" }}
          onFocusCapture={(event) => {
            const word = (event.target as HTMLElement).closest(
              "[data-book-char]",
            );
            if (viewport.current) viewport.current.scrollLeft = 0;
            if (word && layout.ready) {
              const target = Math.floor(
                columnOf(word, layout) / layout.columns,
              );
              if (target !== page) {
                jumpPage(target);
                setControls(true);
              }
            }
          }}
        >
          {pages}
        </main>
      </div>
      <div class="folio-page-number" aria-live="polite">
        {pageNumber}
        {layout.columns === 2
          ? " – " + Math.min(pageNumber + 1, layout.count * layout.columns)
          : ""}
      </div>
      <footer
        class={"folio-bottom" + (controls || panel ? " visible" : "")}
        onFocusCapture={() => setControls(true)}
      >
        <button
          class="folio-round"
          aria-label={t("Предыдущая страница")}
          disabled={page === 0}
          onClick={() => turn(-1)}
        >
          <Icon name="back" />
        </button>
        <label class="folio-slider">
          <span>
            {t("Страница {0} из {1}", {
              0: pageNumber,
              1: layout.count * layout.columns,
            })}
          </span>
          <input
            type="range"
            min="0"
            max={layout.count - 1}
            value={page}
            aria-label={t("Место в книге")}
            onInput={(event) => jumpPage(+event.currentTarget.value)}
          />
        </label>
        <button
          class="folio-round"
          aria-label={
            page === layout.count - 1
              ? t("Завершить чтение")
              : t("Следующая страница")
          }
          onClick={() => {
            if (page === layout.count - 1) props.onComplete();
            else turn(1);
          }}
        >
          <Icon name="next" />
        </button>
      </footer>
      {panel && (
        <section
          class={"folio-popover " + panel}
          role="dialog"
          aria-label={
            panel === "type" ? t("Параметры чтения") : t("Оглавление")
          }
        >
          <div class="row between">
            <h2>
              {panel === "type" ? t("Параметры чтения") : t("Оглавление")}
            </h2>
            <button
              class="folio-round"
              aria-label={t("Закрыть")}
              onClick={hide}
            >
              <Icon name="close" />
            </button>
          </div>
          {panel === "type" ? (
            <>
              <div class="tabs" role="tablist" aria-label={t("Режим чтения")}>
                {[
                  ["frank", "Франк"],
                  ["parallel", "Паралель"],
                  ["clean", "Оригинал"],
                ].map(([value, label]) => (
                  <button
                    role="tab"
                    aria-selected={mode === value}
                    disabled={value === "parallel" && !content.t}
                    onClick={() => props.onMode(value)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              <label class="folio-setting">
                {t("Размер текста")}
                <span>{settings.fontSize} px</span>
                <input
                  aria-label={t("Размер текста")}
                  type="range"
                  min="14"
                  max="30"
                  value={settings.fontSize}
                  onInput={(event) =>
                    props.onSettings({ fontSize: +event.currentTarget.value })
                  }
                />
              </label>
              <label class="folio-setting">
                {t("Шрифт")}
                <select
                  aria-label={t("Шрифт")}
                  value={settings.font}
                  onChange={(event) =>
                    props.onSettings({ font: event.currentTarget.value })
                  }
                >
                  <option value="serif">Literata</option>
                  <option value="sans">Golos Text</option>
                  <option value="system">{t("Системный")}</option>
                </select>
              </label>
              <label class="folio-setting">
                {t("Тема")}
                <select
                  aria-label={t("Тема")}
                  value={settings.theme}
                  onChange={(event) =>
                    props.onSettings({ theme: event.currentTarget.value })
                  }
                >
                  <option value="system">{t("Как в системе")}</option>
                  <option value="light">{t("Светлая")}</option>
                  <option value="dark">{t("Тёмная")}</option>
                </select>
              </label>
              <label class="folio-setting">
                {t("Вид чтения")}
                <select
                  aria-label={t("Вид чтения")}
                  value="pages"
                  onChange={(event) =>
                    props.onSettings({
                      readingFlow: event.currentTarget
                        .value as Settings["readingFlow"],
                    })
                  }
                >
                  <option value="pages">{t("Страницы")}</option>
                  <option value="continuous">{t("Сплошной текст")}</option>
                  <option value="blocks">{t("По отрывкам")}</option>
                </select>
              </label>
              <button
                class="folio-listen"
                disabled={props.busy}
                onClick={props.onListen}
              >
                <Icon name="sound" />
                {props.busy ? t("Готовим звук…") : t("Прослушать отрывок")}
              </button>
              {mode === "frank" && (
                <Toggle
                  checked={settings.showClean}
                  onChange={(showClean) => props.onSettings({ showClean })}
                >
                  {t("Текст без подсказок")}
                </Toggle>
              )}
            </>
          ) : (
            <nav aria-label={t("Отрывки")}>
              {content.c.map((chapter, ci) => (
                <section>
                  <h3>{manifest.chapters[ci][0]}</h3>
                  {chapter.map((_, fi) => (
                    <button
                      aria-current={
                        at === `${ci + 1}.${fi + 1}` ? "location" : undefined
                      }
                      onClick={() => {
                        props.onJump(`${ci + 1}.${fi + 1}`);
                        hide();
                      }}
                    >
                      {t("Отрывок {0}", { 0: fi + 1 })}
                    </button>
                  ))}
                </section>
              ))}
            </nav>
          )}
        </section>
      )}
      {wordPanel && <div class="folio-word-overlay">{wordPanel}</div>}
    </div>
  );
}
