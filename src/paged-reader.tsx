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
import { Icon } from "./ui";
import { ThemesPanel } from "./themes-panel";
import { appearanceStyle } from "./appearance";
export type PageEntry = { at: string; offset: number; preview: string };

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
  onListen(text?: string, ipa?: string): void;
  onIndex?(pages: PageEntry[]): void;
  onBookmark?(): void;
  bookmarked?: boolean;
  bookmarks?: { at: string; offset: number }[];
  onWords?(): void;
  measureOnly?: boolean;
  busy: boolean;
  progressPercent?: number;
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
  leaves?: number;
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
  const scrolling = settings.pageTurn === "scroll";
  const [bookQuery, setBookQuery] = useState(""),
    [menu, setMenu] = useState(false),
    [bookmarkView, setBookmarkView] = useState(false);
  const [pageIndex, setPageIndex] = useState<PageEntry[]>([]);
  const [pageSources, setPageSources] = useState<string[]>([]);
  const emittedIndex = useRef("");
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
    setMenu(false);
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
    if (props.measureOnly) return;
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
    if (scrolling)
      return Math.max(
        0,
        Math.floor(
          (box.top - text.current!.getBoundingClientRect().top + 1) /
            viewport.current!.clientHeight,
        ),
      );
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
        const width = viewport.current.getBoundingClientRect().width;
        const columns =
          scrolling || mode === "parallel"
            ? 1
            : settings.columns === "1"
              ? 1
              : settings.columns === "2" && width >= 600
                ? 2
                : width >= 940
                  ? 2
                  : 1;
        const gap =
          columns === 2 ? Math.min(100, Math.max(52, width * 0.075)) : 48;
        text.current.style.columnCount = scrolling ? "auto" : String(columns);
        text.current.style.columnGap = gap + "px";
        const columnWidth = (width - gap * (columns - 1)) / columns;
        const count = scrolling
          ? Math.max(
              1,
              Math.ceil(
                text.current.scrollHeight / viewport.current.clientHeight,
              ),
            )
          : Math.max(
              1,
              Math.ceil(
                (text.current.scrollWidth + gap - 0.5) /
                  (columnWidth + gap) /
                  columns,
              ),
            );
        const next = {
          width,
          gap,
          columns,
          count,
          ready: true,
          leaves: count * columns,
        };
        const nodes = [
          ...text.current.querySelectorAll<HTMLElement>("[data-book-char]"),
        ];
        const entries: PageEntry[] = [];
        const sourceGroups: {
          key: string;
          source: string;
          start: number;
          end: number;
        }[][] = [];
        for (const node of nodes) {
          const leaf = columnOf(node, next);
          const address =
            node.closest<HTMLElement>("[data-reading-at]")!.dataset.readingAt!;
          const [chapter, fragment] = address.split(".").map((n) => +n - 1);
          const sourceText = plain(content.c[chapter][fragment]);
          const char = Number(node.dataset.bookChar) || 0;
          const copy = Math.floor(char / (sourceText.length + 1));
          const start = char % (sourceText.length + 1),
            end = start + (node.textContent?.length || 0);
          const groups = (sourceGroups[leaf] ||= []);
          const key = address + ":" + copy;
          if (groups.at(-1)?.key === key) groups.at(-1)!.end = end;
          else groups.push({ key, source: sourceText, start, end });
          if (!entries[leaf]) {
            const at =
              node.closest<HTMLElement>("[data-reading-at]")!.dataset
                .readingAt!;
            const [ci, fi] = at.split(".").map((n) => +n - 1),
              offset = Number(node.dataset.bookChar) || 0;
            const source = plain(content.c[ci][fi]);
            entries[leaf] = {
              at,
              offset,
              preview: source.slice(
                offset % (source.length + 1),
                (offset % (source.length + 1)) + 95,
              ),
            };
          }
        }
        let lastLeaf = 0;
        const walker = document.createTreeWalker(
          text.current,
          NodeFilter.SHOW_TEXT,
        );
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) {
            const origin = text.current.getBoundingClientRect();
            const leaf = scrolling
              ? Math.floor(
                  (rect.top - origin.top + 1) / viewport.current.clientHeight,
                )
              : Math.floor((rect.left - origin.left + 1) / (columnWidth + gap));
            lastLeaf = Math.max(lastLeaf, leaf);
          }
        }
        const leaves = Math.max(1, entries.length, lastLeaf + 1);
        for (let i = 0; i < leaves; i++)
          if (!entries[i])
            entries[i] = entries[i - 1] ||
              entries.find(Boolean) || { at: "1.1", offset: 0, preview: "" };
        next.leaves = leaves;
        next.count = Math.ceil(leaves / columns);
        const measuredSources = Array.from({ length: leaves }, (_, i) =>
          (sourceGroups[i] || [])
            .map(
              (g) =>
                g.source.slice(g.start, g.end) +
                (g.source.slice(g.end).match(/^[^\p{L}\p{M}]*/u)?.[0] || ""),
            )
            .join("\n"),
        );
        const json = JSON.stringify([entries, measuredSources]);
        if (
          document.fonts.status === "loaded" &&
          json !== emittedIndex.current
        ) {
          emittedIndex.current = json;
          setPageIndex(entries);
          setPageSources(measuredSources);
          state.current.props.onIndex?.(entries);
        }
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
    settings.columns,
    settings.lineSpacing,
    settings.letterSpacing,
    settings.wordSpacing,
    settings.margins,
    settings.bold,
    settings.hintSize,
    settings.customLayout,
    settings.justify,
    settings.hintItalic,
    settings.readingTheme,
    scrolling,
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
    if (text.current && !scrolling)
      text.current.style.transform = `translateX(${-page * (layout.width + layout.gap)}px)`;
    if (
      scrolling &&
      viewport.current &&
      !scrollActive.current &&
      lastScrollPage.current !== page
    ) {
      viewport.current.scrollTop = page * viewport.current.clientHeight;
      lastScrollPage.current = page;
    }
    if (viewport.current) viewport.current.scrollLeft = 0;
  });

  const scrollActive = useRef(false);
  const lastScrollPage = useRef<number | null>(null);
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
    if (!props.measureOnly) state.current.props.onPosition(address, char);
  }
  const turn = (delta: number) => {
    if (!state.current.layout.ready) return;
    const next = Math.max(
      0,
      Math.min(state.current.layout.count - 1, state.current.page + delta),
    );
    if (next === state.current.page) return;
    if (
      text.current &&
      !scrolling &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      if (settings.pageTurn === "fade")
        text.current.animate([{ opacity: 0.25 }, { opacity: 1 }], {
          duration: 180,
        });
      if (settings.pageTurn === "curl" && viewport.current && root.current) {
        const geometry = state.current.layout,
          box = viewport.current.getBoundingClientRect();
        const leaf = document.createElement("div");
        leaf.className = "curl-leaf";
        leaf.setAttribute("aria-hidden", "true");
        const width =
          geometry.columns === 2
            ? (geometry.width - geometry.gap) / 2
            : geometry.width;
        Object.assign(leaf.style, {
          left: (delta > 0 ? box.right - width : box.left) + "px",
          top: box.top + "px",
          width: width + "px",
          height: box.height + "px",
          transformOrigin: delta > 0 ? "left center" : "right center",
        });
        const snapshot = text.current.cloneNode(true) as HTMLElement;
        snapshot.classList.add("curl-snapshot");
        Object.assign(snapshot.style, {
          width: geometry.width + "px",
          height: box.height + "px",
          marginLeft:
            delta > 0 && geometry.columns === 2
              ? -(width + geometry.gap) + "px"
              : "0",
          transition: "none",
        });
        leaf.append(snapshot);
        root.current.append(leaf);
        const animation = leaf.animate(
          [
            { transform: "perspective(1600px) rotateY(0deg)", opacity: 1 },
            {
              transform: `perspective(1600px) rotateY(${delta > 0 ? -115 : 115}deg)`,
              opacity: 0.7,
              offset: 0.8,
            },
            {
              transform: `perspective(1600px) rotateY(${delta > 0 ? -155 : 155}deg)`,
              opacity: 0,
            },
          ],
          {
            duration: 480,
            easing: "cubic-bezier(.2,.6,.3,1)",
            fill: "forwards",
          },
        );
        animation.onfinish = () => leaf.remove();
      }
    }
    report(next);
    setPage(next);
    hide();
    state.current.page = next;
    if (scrolling && viewport.current)
      viewport.current.scrollTop = next * viewport.current.clientHeight;
    if (text.current && !scrolling)
      text.current.style.transform = `translateX(${-next * (state.current.layout.width + state.current.layout.gap)}px)`;
  };
  const jumpPage = (next: number) => {
    report(next);
    setPage(next);
    state.current.page = next;
    if (scrolling && viewport.current)
      viewport.current.scrollTop = next * viewport.current.clientHeight;
    if (text.current && !scrolling)
      text.current.style.transform = `translateX(${-next * (state.current.layout.width + state.current.layout.gap)}px)`;
  };
  useLayoutEffect(() => {
    if (props.measureOnly) return;
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
        target.closest(
          ".folio-popover,.word-panel,.folio-toolbar,.folio-bottom,.reading-menu",
        ) ||
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
  }, [scrolling, settings.pageTurn]);
  useLayoutEffect(() => {
    if (props.measureOnly || scrolling) return;
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
  }, [scrolling, settings.pageTurn]);
  const listenPage = () => {
    const visible = [
      ...text.current!.querySelectorAll<HTMLElement>("[data-book-char]"),
    ].filter((node) => {
      const leaf = columnOf(node, layout);
      return (
        leaf >= page * layout.columns && leaf < (page + 1) * layout.columns
      );
    });
    const ipa = visible
      .map((node) => {
        const address =
          node.closest<HTMLElement>("[data-reading-at]")!.dataset.readingAt!;
        const form = node.textContent || "";
        return content.x?.[address]?.[form] || content.f[form]?.[0] || "";
      })
      .join(" ");
    const source = pageSources
      .slice(page * layout.columns, (page + 1) * layout.columns)
      .join(" ")
      .trim();
    const entry = pageIndex[page * layout.columns];
    const [ci, fi] = (entry?.at || at).split(".").map((n) => +n - 1);
    props.onListen(
      source || plain(content.c[ci][fi]),
      source && ipa ? ipa : undefined,
    );
  };
  const searchSnippet = (text: string, q: string) => {
    const i = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
    return "…" + text.slice(Math.max(0, i - 35), i + q.length + 85) + "…";
  };
  const pageNumber = page * layout.columns + 1;
  return (
    <div
      class={
        "books-reader turn-" +
        settings.pageTurn +
        (props.measureOnly ? " pagination-probe" : "") +
        (scrolling ? " scroll-reader" : "") +
        (controls || panel || menu ? " controls-visible" : "")
      }
      style={appearanceStyle(settings)}
      aria-hidden={props.measureOnly || undefined}
      inert={props.measureOnly || undefined}
      data-mode={mode}
      ref={root}
      tabIndex={props.measureOnly ? undefined : -1}
      aria-label={t("Read book")}
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
        if (panel || menu) {
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
      {!props.measureOnly && (
        <div class="folio-running-title">{manifest.title}</div>
      )}
      {!props.measureOnly && (
        <header
          class={
            "folio-toolbar" + (controls || panel || menu ? " visible" : "")
          }
          onFocusCapture={() => setControls(true)}
        >
          <div class="folio-toolbar-start">
            <a class="folio-round" href="#/home" aria-label={t("Back")}>
              <Icon name="back" />
            </a>
            <button
              class="folio-round desktop-contents"
              aria-label={t("Contents")}
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
            <div
              class="reader-mode-tabs tabs"
              role="tablist"
              aria-label={t("Default mode")}
            >
              {["frank", "clean", "parallel"].map((value) => (
                <button
                  role="tab"
                  aria-selected={mode === value}
                  disabled={value === "parallel" && !content.t}
                  onClick={() => props.onMode(value)}
                >
                  {t(
                    value === "frank"
                      ? "Frank"
                      : value === "clean"
                        ? "Clean"
                        : "Parallel",
                  )}
                </button>
              ))}
            </div>
            <button
              class="folio-round folio-aa"
              aria-label={t("Themes & Voice")}
              onClick={() => {
                setPanel(panel === "type" ? null : "type");
                setControls(true);
              }}
            >
              Aa
            </button>
            <button
              class="folio-round desktop-audio"
              aria-label={t(props.busy ? "Stop audio" : "Listen to page")}
              onClick={() => listenPage()}
            >
              <Icon name={props.busy ? "stop" : "sound"} />
            </button>
            <button
              class={
                "folio-round desktop-bookmark" +
                (props.bookmarked ? " marked" : "")
              }
              aria-label={t(props.bookmarked ? "Remove bookmark" : "Bookmark")}
              onClick={props.onBookmark}
            >
              <Icon name="bookmark" />
            </button>
            <button
              class="folio-round mobile-reader-menu"
              aria-label={t("Contents")}
              onClick={() => {
                setMenu(!menu);
                setControls(true);
              }}
            >
              <Icon name={menu ? "close" : "menu"} />
            </button>
          </div>
        </header>
      )}
      <div
        class="folio-viewport"
        ref={viewport}
        onScroll={() => {
          if (!scrolling || props.measureOnly) return;
          const next = Math.min(
            layout.count - 1,
            Math.floor(
              viewport.current!.scrollTop / viewport.current!.clientHeight,
            ),
          );
          lastScrollPage.current = next;
          if (next !== page) {
            scrollActive.current = true;
            report(next);
            setPage(next);
            requestAnimationFrame(() => {
              scrollActive.current = false;
            });
          }
        }}
      >
        <main
          class="folio-columns"
          ref={text}
          aria-label={t("Текст книги")}
          onClickCapture={(event) => {
            if (
              (event.target as HTMLElement).closest("[data-book-char]") &&
              !allowLookup.current &&
              mode !== "clean" &&
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
      {!props.measureOnly && (
        <>
          <div class="folio-page-number" aria-live="polite">
            {t("{0} of {1}", { 0: pageNumber, 1: layout.leaves || 1 })}
          </div>
          <footer
            class={"folio-bottom" + (controls || panel ? " visible" : "")}
            onFocusCapture={() => setControls(true)}
          >
            <button
              class="folio-round"
              aria-label={t("Previous page")}
              disabled={page === 0}
              onClick={() => turn(-1)}
            >
              <Icon name="back" />
            </button>
            <label class="folio-slider">
              <span>
                {t("Page {0} of {1}", { 0: pageNumber, 1: layout.leaves || 1 })}
              </span>
              <input
                type="range"
                min="0"
                max={layout.count - 1}
                value={page}
                aria-label={t("Reading position")}
                onInput={(e) => jumpPage(+e.currentTarget.value)}
              />
            </label>
            <button
              class="folio-round"
              aria-label={t(
                page === layout.count - 1 ? "Finish reading" : "Next page",
              )}
              onClick={() =>
                page === layout.count - 1 ? props.onComplete() : turn(1)
              }
            >
              <Icon name="next" />
            </button>
          </footer>
          {menu && (
            <section
              class="reading-menu glass"
              role="dialog"
              aria-label={t("Contents")}
            >
              <button
                onClick={() => {
                  setPanel("contents");
                  setMenu(false);
                }}
              >
                <span>
                  {t("Contents")} ·{" "}
                  {props.progressPercent ??
                    Math.round((page / Math.max(1, layout.count - 1)) * 100)}
                  %
                </span>
                <Icon name="menu" />
              </button>
              <button
                onClick={() => {
                  setPanel("contents");
                  setMenu(false);
                  setTimeout(
                    () =>
                      root.current
                        ?.querySelector<HTMLInputElement>(".book-search")
                        ?.focus(),
                    30,
                  );
                }}
              >
                <span>{t("Search Book")}</span>
                <Icon name="search" />
              </button>
              <div class="tabs" role="tablist">
                {["frank", "clean", "parallel"].map((value) => (
                  <button
                    role="tab"
                    aria-selected={mode === value}
                    disabled={value === "parallel" && !content.t}
                    onClick={() => props.onMode(value)}
                  >
                    {t(
                      value === "frank"
                        ? "Frank"
                        : value === "clean"
                          ? "Clean"
                          : "Parallel",
                    )}
                  </button>
                ))}
              </div>
              <button
                aria-label={t("Themes & Voice")}
                onClick={() => {
                  setPanel("type");
                  setMenu(false);
                }}
              >
                <span>{t("Themes & Voice")}</span>
                <span>Aa</span>
              </button>
              <div class="reading-menu-icons">
                <button
                  aria-label={t(props.busy ? "Stop audio" : "Listen to page")}
                  onClick={listenPage}
                >
                  <Icon name={props.busy ? "stop" : "sound"} />
                </button>
                <button
                  aria-label={t("Without hints")}
                  aria-pressed={mode === "clean"}
                  onClick={() =>
                    props.onMode(mode === "clean" ? "frank" : "clean")
                  }
                >
                  <Icon name="hints" />
                </button>
                <button
                  aria-label={t(
                    props.bookmarked ? "Remove bookmark" : "Bookmark",
                  )}
                  aria-pressed={props.bookmarked}
                  onClick={props.onBookmark}
                >
                  <Icon name="bookmark" />
                </button>
                <button aria-label={t("Book words")} onClick={props.onWords}>
                  <Icon name="words" />
                </button>
              </div>
            </section>
          )}
          {panel === "type" && (
            <section
              class="folio-popover type glass"
              role="dialog"
              aria-label={t("Themes & Voice")}
            >
              <ThemesPanel
                settings={settings}
                onChange={props.onSettings}
                onClose={hide}
              />
            </section>
          )}
          {panel === "contents" && (
            <section
              class="folio-popover contents glass"
              role="dialog"
              aria-label={t("Pages")}
            >
              <div class="row between">
                <h2>{t("Pages")}</h2>
                <small>
                  {t("{0} pages", { 0: pageIndex.length })} ·{" "}
                  {t("{0}% read", {
                    0:
                      props.progressPercent ??
                      Math.round((page / Math.max(1, layout.count - 1)) * 100),
                  })}
                </small>
                <button class="round" aria-label={t("Close")} onClick={hide}>
                  <Icon name="close" />
                </button>
              </div>
              <input
                class="book-search"
                aria-label={t("Search Book")}
                placeholder={t("Search Book")}
                value={bookQuery}
                onInput={(e) => setBookQuery(e.currentTarget.value)}
              />
              <div class="tabs">
                <button
                  aria-pressed={!bookmarkView}
                  onClick={() => setBookmarkView(false)}
                >
                  {t("Pages")}
                </button>
                <button
                  aria-pressed={bookmarkView}
                  onClick={() => setBookmarkView(true)}
                >
                  {t("Bookmarks")}
                </button>
              </div>
              <nav>
                {pageIndex.map((entry, i) => {
                  const isBookmarked = props.bookmarks?.some((b) => {
                    const start = pageIndex[i],
                      end = pageIndex[i + 1];
                    const key = (x: { at: string; offset: number }) => {
                      const [c, f] = x.at.split(".").map(Number);
                      return c * 1e12 + f * 1e7 + x.offset;
                    };
                    return key(b) >= key(start) && (!end || key(b) < key(end));
                  });
                  if (bookmarkView && !isBookmarked) return null;
                  if (bookQuery) {
                    const needle = bookQuery.toLocaleLowerCase();
                    if (!pageSources[i]?.toLocaleLowerCase().includes(needle))
                      return null;
                  }
                  return (
                    <button
                      class="page-entry"
                      aria-current={
                        Math.floor(i / layout.columns) === page
                          ? "location"
                          : undefined
                      }
                      onClick={() => {
                        jumpPage(Math.floor(i / layout.columns));
                        hide();
                      }}
                    >
                      <span>
                        <strong>{t("Page {0}", { 0: i + 1 })}</strong>
                        <small>
                          {bookQuery
                            ? searchSnippet(pageSources[i], bookQuery)
                            : entry.preview}
                        </small>
                      </span>
                      {isBookmarked ? (
                        <Icon name="bookmark" size={14} />
                      ) : i < page * layout.columns ? (
                        <Icon name="check" size={14} />
                      ) : Math.floor(i / layout.columns) === page ? (
                        <em>{t("NOW")}</em>
                      ) : null}
                    </button>
                  );
                })}
                {bookmarkView && !props.bookmarks?.length && (
                  <p class="muted">{t("No bookmarks yet")}</p>
                )}
              </nav>
            </section>
          )}
        </>
      )}
      {wordPanel && <div class="folio-word-overlay">{wordPanel}</div>}
    </div>
  );
}
