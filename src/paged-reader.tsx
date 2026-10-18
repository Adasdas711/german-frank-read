import type { ComponentChildren } from "preact";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { plain, type Chunk, type Content, type Manifest } from "./core";
import type { Settings, SavedWord } from "./storage";
import { useT } from "./i18n";
import { Icon } from "./ui";
import { ThemesPanel } from "./themes-panel";
import { appearanceStyle, typesettingKey, readingTheme } from "./appearance";
import { WordPopover } from "./word-popover";
import { useControlActivation } from "./control-activation";
import { ReaderWords } from "./reader-words";
import {
  animatePageTurn,
  pageSnapshot,
  type PageMotion,
} from "./reader-motion";
import { FilledSlider } from "./filled-slider";
import { ReaderPresence, useReaderControls } from "./reader-presence";
import { sentencePages } from "./sentence-pages";
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
  onIndex?(pages: PageEntry[]): void;
  onBookmark?(): void;
  bookmarked?: boolean;
  savedWords: SavedWord[];
  onRemoveWord(key: string): void;
  measureOnly?: boolean;
  renderFragment(chunks: Chunk[], at: string): ComponentChildren;
  wordPanel: ComponentChildren;
  wordAnchor?: HTMLElement;
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
type MeasuredLayout = {
  layout: Layout;
  entries: PageEntry[];
  sources: string[];
  breaks: number[];
};
// Reuse exact layout indexes when reopening a book with the same settings.
const measuredLayouts = new WeakMap<Content, Map<string, MeasuredLayout>>();
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
  const appearance = appearanceStyle(settings);
  // Only text metrics invalidate pagination. Color and interface-size changes
  // must paint immediately without measuring every sentence in the novel.
  const typesetting = typesettingKey(settings, mode);

  const [bookQuery, setBookQuery] = useState(""),
    [menu, setMenu] = useState(false);
  const [pageIndex, setPageIndex] = useState<PageEntry[]>([]);
  const [pageSources, setPageSources] = useState<string[]>([]);
  const emittedIndex = useRef("");
  const [controls, setControls] = useState(false),
    [panel, setPanel] = useState<
      "type" | "contents" | "search" | "words" | null
    >(null);
  const [page, setPage] = useState(0);
  const [scrollPosition, setScrollPosition] = useState(0);
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
  const stopTurn = useRef<() => void>(() => {});
  const dragTurn = useRef<{
    motion: PageMotion;
    direction: number;
    origin: number;
  } | null>(null);
  const state = useRef({ props, page, layout });
  useControlActivation(root, props.measureOnly);
  useReaderControls(root, !!(controls || panel || menu));
  useLayoutEffect(() => {
    if (!wordPanel)
      root.current
        ?.querySelectorAll(".word.chosen")
        .forEach((n) => n.classList.remove("chosen"));
  }, [wordPanel]);
  state.current = { props, page, layout };
  const anchor = useRef({ at, offset });
  const lastReported = useRef<string | null>(null);
  const gesture = useRef<{
      id: number;
      x: number;
      y: number;
      started: number;
      moved: boolean;
      type: string;
      dismiss: boolean;
    } | null>(null),
    suppressClick = useRef(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout>>();
  const allowLookup = useRef(false),
    longPressed = useRef(false);
  const openWord = (word: HTMLElement) => {
    allowLookup.current = true;
    word.click();
    allowLookup.current = false;
    setControls(false);
    setPanel(null);
    setMenu(false);
  };
  const hide = useCallback(() => {
    setControls(false);
    setPanel(null);
    setMenu(false);
  }, []);
  const show = () => {
    setControls(true);
  };
  const backToMenu = () => {
    setPanel(null);
    setMenu(true);
    setControls(true);
  };
  useLayoutEffect(() => {
    if (props.measureOnly) return;
    document.documentElement.classList.add("reading-pages");
    root.current?.focus({ preventScroll: true });
    const cancelHold = () => {
      clearTimeout(lookupTimer.current);
      dragTurn.current?.motion.finish(false);
      gesture.current = null;
      suppressClick.current = true;
    };
    window.addEventListener("blur", cancelHold);
    document.addEventListener("visibilitychange", cancelHold);
    return () => {
      document.documentElement.classList.remove("reading-pages");
      clearTimeout(lookupTimer.current);
      stopTurn.current();
      window.removeEventListener("blur", cancelHold);
      document.removeEventListener("visibilitychange", cancelHold);
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

  const sourceTexts = useMemo(
    () =>
      new Map<string, string>(
        content.c.flatMap((chapter, ci) =>
          chapter.map(
            (chunks, fi) => [`${ci + 1}.${fi + 1}`, plain(chunks)] as const,
          ),
        ),
      ),
    [content],
  );
  const textRange = useRef<Range>();
  // Read actual glyph positions. Inline form-control rectangles can describe
  // their original flow box instead of its fragment in WebKit columns.
  const textRect = (element: Element) => {
    const range = (textRange.current ||= document.createRange());
    range.selectNodeContents(element);
    return (
      Array.from(range.getClientRects()).find(
        (r) => r.width > 0 && r.height > 0,
      ) ||
      element.getClientRects()[0] ||
      element.getBoundingClientRect()
    );
  };
  function columnOf(element: Element, geometry: Layout) {
    const box = textRect(element);
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
    const sourceOffset = bookmark.offset % (length + 1);
    const word =
      words.find((word) => Number(word.dataset.bookChar) >= sourceOffset) ||
      words.at(-1) ||
      fragment;
    const target =
      fi === 0 && sourceOffset === 0
        ? fragment
            .closest(".folio-chapter")
            ?.querySelector(".folio-chapter-title") || word
        : word;
    return Math.min(
      geometry.count - 1,
      Math.floor(columnOf(target, geometry) / geometry.columns),
    );
  };
  // Measure columns after fonts/layout changes. The bookmark is a source-text offset,
  // so it survives a different font, window width or number of facing pages.
  useLayoutEffect(() => {
    let frame = 0,
      settle = 0,
      closed = false;
    const calculate = () => {
      if (closed || !viewport.current || !text.current) return;
      stopTurn.current();
      dragTurn.current = null;
      const viewportBox = viewport.current.getBoundingClientRect();
      const viewportHeight = viewport.current.clientHeight;
      if (viewportBox.width <= 0 || viewportHeight <= 0) return;
      // Safari may treat a percentage height inside an inset-positioned box
      // as auto, flowing the entire book into one long column. Use a definite
      // physical height before asking the browser to fragment its columns.
      text.current.style.height = scrolling ? "auto" : viewportHeight + "px";
      text.current.style.width = viewportBox.width + "px";
      // Apply the destination column geometry before any layout read. A mode
      // switch must not lay out the whole novel once with the old columns first.
      const width = viewportBox.width;
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
      const columnWidth = (width - gap * (columns - 1)) / columns;
      text.current.style.columnWidth = scrolling ? "auto" : columnWidth + "px";
      text.current.style.columnCount = scrolling ? "auto" : String(columns);
      text.current.style.columnGap = gap + "px";
      const cacheKey = JSON.stringify([width, viewportHeight, typesetting]);
      let cache = measuredLayouts.get(content);
      if (!cache) {
        cache = new Map();
        measuredLayouts.set(content, cache);
      }
      const cached =
        document.fonts.status === "loaded" ? cache.get(cacheKey) : undefined;
      const breaks = sentencePages(
        text.current,
        (width + gap) / columns,
        scrolling ? 0 : viewportHeight,
        scrolling ? [] : cached?.breaks,
      );
      if (cached) {
        setPageIndex(cached.entries);
        setPageSources(cached.sources);
        const restored = positionFor(cached.layout);
        text.current.style.transition = "none";
        setLayout(cached.layout);
        setPage(restored);
        state.current.props.onIndex?.(cached.entries);
        cancelAnimationFrame(settle);
        settle = requestAnimationFrame(() => {
          if (text.current) text.current.style.transition = "";
        });
        return;
      }
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
      const origin = text.current.getBoundingClientRect();
      const stride = (width + gap) / columns;
      const leafOf = (element: Element) => {
        const rect = textRect(element);
        return Math.max(
          0,
          Math.floor(
            scrolling
              ? (rect.top - origin.top + 1) / viewportHeight
              : (rect.left - origin.left + 1) / stride,
          ),
        );
      };
      const entries: PageEntry[] = [];
      const sourceGroups: {
        key: string;
        source: string;
        start: number;
        end: number;
      }[][] = [];
      // Source words are ordered by physical leaf. Locate page boundaries with
      // binary search, rather than requesting a layout rectangle for every word.
      let cursor = 0;
      while (cursor < nodes.length) {
        const leaf = leafOf(nodes[cursor]);
        let low = cursor + 1,
          high = nodes.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (leafOf(nodes[mid]) <= leaf) low = mid + 1;
          else high = mid;
        }
        for (let i = cursor; i < low; i++) {
          const node = nodes[i];
          const address =
            node.closest<HTMLElement>("[data-reading-at]")!.dataset.readingAt!;
          const sourceText = sourceTexts.get(address)!;
          const char = Number(node.dataset.bookChar) || 0;
          const copy = Math.floor(char / (sourceText.length + 1));
          const start = char % (sourceText.length + 1),
            end = start + (node.textContent?.length || 0);
          const groups = (sourceGroups[leaf] ||= []),
            key = address + ":" + copy;
          if (groups.at(-1)?.key === key) groups.at(-1)!.end = end;
          else groups.push({ key, source: sourceText, start, end });
          if (!entries[leaf])
            entries[leaf] = {
              at: address,
              offset: char,
              preview: sourceText.slice(start, start + 95),
            };
        }
        cursor = low;
      }
      let lastLeaf = 0;
      // Paragraph fragments include hints, punctuation and translations. Measuring
      // their boxes avoids a Range/layout read for every text node in the novel.
      for (const element of text.current.querySelectorAll(
        ".reading-panel p,.folio-chapter-title",
      )) {
        for (const rect of element.getClientRects()) {
          const leaf = scrolling
            ? Math.floor((rect.bottom - origin.top - 0.5) / viewportHeight)
            : Math.floor((rect.left - origin.left + 1) / (columnWidth + gap));
          lastLeaf = Math.max(lastLeaf, leaf);
        }
      }
      // The overflow extent is independent of element rectangles. Never
      // collapse a multi-column book to one page because a fragment box was
      // reported in the first column by the browser.
      const extentLeaves = scrolling
        ? Math.ceil(text.current.scrollHeight / viewportHeight)
        : Math.ceil((text.current.scrollWidth + gap - 0.5) / stride);
      const leaves = Math.max(1, extentLeaves, entries.length, lastLeaf + 1);
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
      if (document.fonts.status === "loaded") {
        cache.set(cacheKey, {
          layout: next,
          entries,
          sources: measuredSources,
          breaks,
        });
        if (cache.size > 6) cache.delete(cache.keys().next().value!);
      }
      const json = JSON.stringify([entries, measuredSources]);
      if (document.fonts.status === "loaded" && json !== emittedIndex.current) {
        emittedIndex.current = json;
        setPageIndex(entries);
        setPageSources(measuredSources);
      }
      if (document.fonts.status === "loaded")
        state.current.props.onIndex?.(entries);
      const restored = positionFor(next);
      text.current.style.transition = "none";
      setLayout(next);
      setPage(restored);
      cancelAnimationFrame(settle);
      settle = requestAnimationFrame(() => {
        if (text.current) text.current.style.transition = "";
      });
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Let the new settings and pressed state paint before the expensive
        // index calculation; opening a book still measures on its first frame.
        if (state.current.layout.ready)
          frame = requestAnimationFrame(calculate);
        else calculate();
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current!);
    document.fonts.addEventListener("loadingdone", measure);
    document.fonts.ready.then(() => {
      if (!closed) measure();
    });
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settle);
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [content, pages, typesetting]);
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
  const clearTurnAnimations = () => {
    stopTurn.current();
    dragTurn.current = null;
    stopTurn.current = () => {};
    text.current?.getAnimations().forEach((animation) => animation.cancel());
  };
  useLayoutEffect(() => {
    clearTurnAnimations();
    clearTimeout(lookupTimer.current);
    gesture.current = null;
    suppressClick.current = false;
  }, [mode, settings.pageTurn]);
  const previousMode = useRef(`${mode}:${settings.pageTurn}`);
  useLayoutEffect(() => {
    const next = `${mode}:${settings.pageTurn}`;
    if (previousMode.current === next || props.measureOnly) return;
    previousMode.current = next;
    let animation: Animation | undefined;
    // Pagination paints the new layout first. Animate the visible viewport,
    // without copying the book or delaying further settings changes.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const node = viewport.current;
        if (!node) return;
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        node.dataset.modeTransition = "true";
        animation = node.animate(
          [
            { opacity: 0.4, transform: reduced ? "none" : "translateY(6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: reduced ? 120 : 240, easing: "ease-out" },
        );
        animation.onfinish = () => {
          delete node.dataset.modeTransition;
          animation?.cancel();
        };
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
      if (viewport.current) delete viewport.current.dataset.modeTransition;
    };
  }, [mode, settings.pageTurn]);
  const turn = (delta: number, interactive = false, originY = 0.75) => {
    props.onDismissWord();
    clearTimeout(lookupTimer.current);
    const geometry = state.current.layout;
    if (!geometry.ready) return;
    const origin = state.current.page;
    const next = Math.max(0, Math.min(geometry.count - 1, origin + delta));
    if (next === origin) return;
    const canvas = text.current!;
    clearTurnAnimations();
    // Capture the complete sheet, including its margins, rather than sliding
    // just the text rectangle through a stationary frame.
    const box = root.current!.getBoundingClientRect();
    const nodes = [...canvas.querySelectorAll<HTMLElement>("[data-book-char]")];
    const snapshot = (target: number) => {
      let low = 0,
        high = nodes.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (columnOf(nodes[middle], geometry) < target * geometry.columns)
          low = middle + 1;
        else high = middle;
      }
      const copy = pageSnapshot(canvas, box, nodes[low]);
      const footer = document.createElement("span");
      footer.className = "snapshot-page-number";
      footer.textContent = String(target * geometry.columns + 1);
      copy.append(footer);
      return copy;
    };
    const outgoing = scrolling ? undefined : snapshot(origin);
    report(next);
    setPage(next);
    hide();
    state.current.page = next;
    if (scrolling && viewport.current) {
      viewport.current.scrollTop = next * viewport.current.clientHeight;
      return;
    }
    const to = `translateX(${-next * (geometry.width + geometry.gap)}px)`;
    canvas.style.transform = to;
    const incoming =
      settings.pageTurn === "curl" && delta < 0 ? snapshot(next) : undefined;
    const motion = animatePageTurn({
      kind: settings.pageTurn as "slide" | "curl" | "fade",
      canvas,
      host: root.current!,
      box,
      outgoing: outgoing!,
      incoming,
      to,
      direction: delta,
      interactive,
      originY,
      onFinish(commit) {
        dragTurn.current = null;
        stopTurn.current = () => {};
        if (!commit) jumpPage(origin);
      },
    });
    stopTurn.current = motion.stop;
    return { motion, direction: delta, origin };
  };
  const jumpPage = (next: number) => {
    props.onDismissWord();
    clearTimeout(lookupTimer.current);
    clearTurnAnimations();
    report(next);
    setPage(next);
    state.current.page = next;
    if (scrolling && viewport.current)
      viewport.current.scrollTop = next * viewport.current.clientHeight;
    if (text.current && !scrolling)
      text.current.style.transform = `translateX(${-next * (state.current.layout.width + state.current.layout.gap)}px)`;
  };
  const seekScroll = (position: number) => {
    const view = viewport.current;
    if (!view) return;
    props.onDismissWord();
    clearTimeout(lookupTimer.current);
    clearTurnAnimations();
    setScrollPosition(position);
    // Scroll progress follows the actual scrollable distance, not page-height
    // multiples. This also permits fine adjustments within the current page.
    view.scrollTop =
      (Math.max(0, view.scrollHeight - view.clientHeight) * position) / 1000;
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
      if (event.key === "Enter" || event.key === " ") {
        const word = target.closest<HTMLElement>("[data-book-char]");
        if (word) {
          event.preventDefault();
          openWord(word);
          return;
        }
      }
      if (
        target.closest(
          ".reader-exit,.reader-tools-button,.folio-popover,.word-panel,.folio-toolbar,.folio-bottom,.reading-menu",
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
    if (props.measureOnly) return;
    let distance = 0,
      lastEvent = 0,
      turned = false;
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        (event.target as HTMLElement).closest(
          ".reader-exit,.reader-tools-button,.folio-popover,.word-panel,.folio-toolbar,.folio-bottom,.reading-menu",
        )
      )
        return;
      if (scrolling) {
        hide();
        return;
      }
      event.preventDefault();
      const now = performance.now();
      if (now - lastEvent > 300) {
        distance = 0;
        turned = false;
      }
      lastEvent = now;
      const amount =
        (Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY) *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.current!.clientHeight
            : 1);
      if (Math.sign(distance) !== Math.sign(amount)) distance = 0;
      distance += amount;
      if (!turned && Math.abs(distance) >= 45) {
        turned = true;
        turn(distance > 0 ? 1 : -1);
      }
    };
    root.current!.addEventListener("wheel", wheel, { passive: false });
    return () => root.current?.removeEventListener("wheel", wheel);
  }, [scrolling, settings.pageTurn]);
  const tap = () => {
    if (panel || menu || wordPanel) {
      hide();
      props.onDismissWord();
      return;
    }
    if (controls) hide();
    else show();
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
        (controls || panel || menu ? " controls-visible" : "") +
        (panel || menu ? " settings-open" : "")
      }
      style={appearance}
      aria-hidden={props.measureOnly || undefined}
      inert={props.measureOnly || undefined}
      data-mode={mode}
      data-reading-tone={readingTheme(settings).light ? "light" : "dark"}
      ref={root}
      tabIndex={props.measureOnly ? undefined : -1}
      aria-label={t("Read book")}
      data-ready={layout.ready}
      data-columns={layout.columns}
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest(".folio-columns"))
          event.preventDefault();
      }}
      onPointerDown={(event) => {
        const wasTurning = !!root.current?.dataset.turning;
        clearTurnAnimations();
        clearTimeout(lookupTimer.current);
        gesture.current = null;
        longPressed.current = false;
        if (!event.isPrimary || event.button !== 0) {
          gesture.current = null;
          suppressClick.current = true;
          return;
        }
        const target = (
          wasTurning
            ? document.elementFromPoint(event.clientX, event.clientY) ||
              event.target
            : event.target
        ) as HTMLElement;
        if (
          target.closest(
            ".reader-exit,.reader-tools-button,.folio-toolbar,.folio-popover,.folio-bottom,.word-panel,.reading-menu",
          )
        ) {
          // Native controls handle their own clicks. A drag which starts on a
          // control must not turn a page if it ends on the canvas underneath.
          suppressClick.current = true;
          return;
        }
        suppressClick.current = false;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          started: performance.now(),
          moved: false,
          type: event.pointerType,
          dismiss: !!(menu || panel),
        };
        if (gesture.current.dismiss) return;
        const word = target.closest<HTMLElement>("[data-book-char]");
        if (word)
          lookupTimer.current = setTimeout(() => {
            if (!gesture.current || gesture.current.moved) return;
            longPressed.current = true;
            suppressClick.current = true;
            openWord(word);
          }, 550);
      }}
      onPointerMove={(event) => {
        const start = gesture.current;
        if (!start || start.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
          start.moved = true;
          suppressClick.current = true;
          clearTimeout(lookupTimer.current);
          if (start.dismiss) return;
          hide();
        }
        if (start.dismiss) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (
          !scrolling &&
          start.type !== "mouse" &&
          !longPressed.current &&
          Math.abs(dx) > 10 &&
          Math.abs(dx) > Math.abs(dy) * 1.5
        ) {
          if (!dragTurn.current) {
            const pending = turn(dx < 0 ? 1 : -1, true, start.y / innerHeight);
            if (pending) {
              dragTurn.current = pending;
              root.current?.setPointerCapture(event.pointerId);
            }
          }
          if (dragTurn.current)
            dragTurn.current.motion.seek(
              (-dx * dragTurn.current.direction) / root.current!.clientWidth,
            );
        }
      }}
      onPointerCancel={() => {
        dragTurn.current?.motion.finish(false);
        gesture.current = null;
        suppressClick.current = true;
        clearTimeout(lookupTimer.current);
      }}
      onPointerLeave={() => clearTimeout(lookupTimer.current)}
      onPointerUp={(event) => {
        clearTimeout(lookupTimer.current);
        const start = gesture.current;
        gesture.current = null;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        const moved = start.moved || Math.hypot(dx, dy) > 10;
        if (start.dismiss) {
          suppressClick.current = true;
          if (!moved) hide();
          return;
        }
        if (dragTurn.current) {
          const pending = dragTurn.current;
          suppressClick.current = true;
          pending.motion.finish(
            -dx * pending.direction >
              Math.min(100, root.current!.clientWidth * 0.18),
          );
          return;
        }
        suppressClick.current =
          moved ||
          longPressed.current ||
          performance.now() - start.started > 450;
        if (!suppressClick.current) {
          // A tap is a short, stationary pointer press. Handle it here: touch
          // browsers can omit the compatibility click after scrolling.
          suppressClick.current = true;
          tap();
          return;
        }
        if (
          !scrolling &&
          start.type !== "mouse" &&
          !longPressed.current &&
          Math.abs(dx) > 64 &&
          Math.abs(dx) > Math.abs(dy) * 1.5
        )
          turn(dx < 0 ? 1 : -1);
      }}
      onClickCapture={(event) => {
        if (allowLookup.current) return;
        const target = event.target as HTMLElement;
        if (
          target.closest(
            ".reader-exit,.reader-tools-button,.folio-toolbar,.folio-popover,.folio-bottom,.word-panel,.reading-menu",
          )
        )
          return;
        if (suppressClick.current && (event.detail !== 0 || event.isTrusted)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const word = target.closest("[data-book-char]");
        if (word && (event.detail > 0 || event.isTrusted)) {
          event.preventDefault();
          event.stopPropagation();
          if (event.detail <= 1) tap();
        }
      }}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button,a,input,select,label,[data-book-char],.reader-exit,.reader-tools-button,.folio-toolbar,.folio-bottom,.folio-popover,.word-panel,.reading-menu",
          )
        )
          return;
        if (event.detail <= 1) tap();
      }}
    >
      {!props.measureOnly && (
        <header
          class={
            "folio-toolbar" + (controls || panel || menu ? " visible" : "")
          }
          onFocusCapture={() => setControls(true)}
        >
          <span class="reader-page-count">
            {pageNumber} of {layout.leaves || 1}
          </span>
        </header>
      )}
      {!props.measureOnly && (
        <>
          <a
            class="folio-round reader-exit"
            href="#/home"
            aria-label={t("Exit reading")}
          >
            <Icon name="close" size={25} />
          </a>
          <button
            class="folio-round mobile-reader-menu reader-tools-button"
            aria-label={t("Reading tools")}
            aria-haspopup="dialog"
            aria-expanded={!!(menu || panel)}
            aria-hidden={!!(menu || panel)}
            inert={!!(menu || panel)}
            onClick={() => {
              props.onDismissWord();
              if (menu || panel) hide();
              else {
                setMenu(true);
                setControls(true);
              }
            }}
          >
            <Icon name="menu" size={24} />
          </button>
        </>
      )}
      <div
        class="folio-viewport"
        ref={viewport}
        onScroll={() => {
          if (!scrolling || props.measureOnly) return;
          const view = viewport.current!;
          const end = Math.max(0, view.scrollHeight - view.clientHeight);
          // Safari reports negative or beyond-end offsets during elastic scroll.
          const position = Math.max(0, Math.min(end, view.scrollTop));
          setScrollPosition(end > 0 ? Math.round((position / end) * 1000) : 0);
          // The final viewport often overlaps the previous physical page.
          // Browsers clamp scrollTop to this end, so floor(scrollTop / height)
          // alone would send the slider back to the penultimate page forever.
          const next = Math.min(
            layout.count - 1,
            end > 0 && position >= end - 1
              ? layout.count - 1
              : Math.floor(position / view.clientHeight),
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
          onDblClick={(event) => event.preventDefault()}
          style={{ visibility: layout.ready ? "visible" : "hidden" }}
          onFocusCapture={(event) => {
            const word = (event.target as HTMLElement).closest(
              "[data-book-char]",
            );
            if (viewport.current) viewport.current.scrollLeft = 0;
            if (word && layout.ready && !gesture.current) {
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
            {pageNumber}
          </div>
          <ReaderPresence>
            {menu && (
              <section
                class="reading-menu glass"
                role="dialog"
                aria-label={t("Reading tools")}
              >
                <FilledSlider
                  value={scrolling ? scrollPosition : page}
                  min={0}
                  max={
                    scrolling ? (layout.count > 1 ? 1000 : 0) : layout.count - 1
                  }
                  label={t("Reading position")}
                  activationLabel={t("Contents")}
                  valueText={`${pageNumber} of ${layout.leaves || 1}`}
                  onInput={scrolling ? seekScroll : jumpPage}
                  onActivate={() => {
                    setPanel("contents");
                    setMenu(false);
                  }}
                >
                  <span>
                    {t("Contents")} ·{" "}
                    {scrolling
                      ? Math.round(scrollPosition / 10)
                      : layout.count > 1
                        ? Math.round((page / (layout.count - 1)) * 100)
                        : 0}
                    %
                  </span>
                  <Icon name="menu" />
                </FilledSlider>
                <button
                  onClick={() => {
                    setPanel("search");
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
                  aria-label={t("Themes")}
                  onClick={() => {
                    setPanel("type");
                    setMenu(false);
                  }}
                >
                  <span>{t("Themes")}</span>
                  <span>Aa</span>
                </button>
                <div class="reading-menu-icons">
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
                  <button
                    aria-label={t("Book words")}
                    onClick={() => {
                      setPanel("words");
                      setMenu(false);
                    }}
                  >
                    <Icon name="words" />
                  </button>
                </div>
              </section>
            )}
          </ReaderPresence>
          <ReaderPresence>
            {panel === "type" && (
              <section
                class="folio-popover type glass"
                role="dialog"
                aria-label={t("Themes")}
              >
                <ThemesPanel
                  settings={settings}
                  onChange={props.onSettings}
                  onClose={backToMenu}
                />
              </section>
            )}
          </ReaderPresence>
          <ReaderPresence>
            {panel === "words" && (
              <section
                class="folio-popover words glass"
                role="dialog"
                aria-label={t("Book words")}
              >
                <ReaderWords
                  words={props.savedWords}
                  onRemove={props.onRemoveWord}
                  onClose={backToMenu}
                />
              </section>
            )}
          </ReaderPresence>
          <ReaderPresence>
            {panel === "contents" && (
              <section
                class="folio-popover contents glass"
                role="dialog"
                aria-label={t("Contents")}
              >
                <div class="reader-panel-heading row between">
                  <h2>{t("Chapters")}</h2>
                  <button
                    class="round"
                    aria-label={t("Close")}
                    onClick={backToMenu}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <nav aria-label={t("Chapters")}>
                  {manifest.chapters.map((chapter, ci) => (
                    <button
                      class="page-entry chapter-entry"
                      data-chapter={ci + 1}
                      aria-current={
                        Number(at.split(".")[0]) === ci + 1
                          ? "location"
                          : undefined
                      }
                      onClick={() => {
                        props.onJump(`${ci + 1}.1`);
                        hide();
                      }}
                    >
                      <strong>
                        {chapter[0] || t("Chapter {0}", { 0: ci + 1 })}
                      </strong>
                    </button>
                  ))}
                </nav>
              </section>
            )}
          </ReaderPresence>
          <ReaderPresence>
            {panel === "search" && (
              <section
                class="folio-popover search glass"
                role="dialog"
                aria-label={t("Search Book")}
              >
                <div class="reader-panel-heading row between">
                  <h2>{t("Search Book")}</h2>
                  <button
                    class="round"
                    aria-label={t("Close")}
                    onClick={backToMenu}
                  >
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
                <nav aria-label={t("Search results")}>
                  {bookQuery.trim() &&
                    pageIndex.map((_, i) => {
                      const needle = bookQuery.trim().toLocaleLowerCase();
                      if (!pageSources[i]?.toLocaleLowerCase().includes(needle))
                        return null;
                      return (
                        <button
                          class="page-entry"
                          onClick={() => {
                            jumpPage(Math.floor(i / layout.columns));
                            hide();
                          }}
                        >
                          <span>
                            <strong>{t("Page {0}", { 0: i + 1 })}</strong>
                            <small>
                              {searchSnippet(pageSources[i], bookQuery.trim())}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                </nav>
              </section>
            )}
          </ReaderPresence>
        </>
      )}
      <ReaderPresence>
        {wordPanel && props.wordAnchor && (
          <WordPopover
            anchor={props.wordAnchor}
            onDismiss={props.onDismissWord}
          >
            {wordPanel}
          </WordPopover>
        )}
      </ReaderPresence>
    </div>
  );
}
