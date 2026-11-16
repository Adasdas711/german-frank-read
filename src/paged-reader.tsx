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
import {
  applyChapter,
  chapterMatches,
  loadLayouts,
  measureChapter,
  saveLayout,
  sizeChapter,
  chapterSpan,
  type ChapterGeometry,
  type ChapterMeasure,
  type PageEntry,
} from "./chapter-layout";
export type { PageEntry };

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
// Scroll mode measures the whole book at once.
type MeasuredLayout = {
  layout: Layout;
  entries: PageEntry[];
  sources: string[];
};
// One multicol box holding a whole novel makes Chromium layerize every column
// fragment on each paint (seconds per page turn at 500+ pages). Each chapter
// already starts in a new column, so chapters are separate multicol boxes in a
// horizontal row (books.css); their columns keep the same stride and therefore
// the same page positions. Off-screen chapters skip rendering, and a chapter is
// measured only when it is needed or when the browser is idle.
type PagedState = {
  key: string;
  geometry: ChapterGeometry;
  chapters: HTMLElement[];
  measures: (ChapterMeasure | undefined)[];
  // Measurements restored from storage are checked once the chapter is laid out.
  checked: boolean[];
  starts: number[];
  idle: number;
  delay: number;
};
// Measurements made in this session need no check against the live layout.
const sessionMeasured = new WeakSet<ChapterMeasure>();
// Reuse chapter measurements when reopening a book with the same settings.
const measuredLayouts = new WeakMap<
  Content,
  Map<string, (ChapterMeasure | undefined)[]>
>();
const scrollLayouts = new WeakMap<Content, Map<string, MeasuredLayout>>();
const loadedLayouts = new WeakMap<Content, Promise<void>>();
// Measure further chapters synchronously while opening stays this short.
const OPEN_BUDGET = 250;
const idle = (callback: () => void) =>
  "requestIdleCallback" in globalThis
    ? requestIdleCallback(callback, { timeout: 300 })
    : (setTimeout(callback, 30) as unknown as number);
const cancelIdle = (handle: number) =>
  "cancelIdleCallback" in globalThis
    ? cancelIdleCallback(handle)
    : clearTimeout(handle);
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
  const frankMode = mode === "frank" || mode === "frank-original";
  // "Without hints" returns to the Frank variant the reader came from.
  const lastFrank = useRef<"frank" | "frank-original">("frank");
  if (frankMode) lastFrank.current = mode;

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
  // Start loading the reading font's faces and the saved page layout while
  // the book is still being rendered, so measuring can begin right after it.
  const readingFont = String(appearance["--reading"] || "");
  const preload = useMemo(() => {
    const families = new Set(
      readingFont
        .split(",")
        .map((name) => name.trim().replace(/^["']|["']$/g, "")),
    );
    const faces = () =>
      [...document.fonts].filter((face) =>
        families.has(face.family.replace(/^["']|["']$/g, "")),
      );
    // Load every face of the reading font before measuring, so no face starts
    // loading halfway through and forces the whole book to be measured again.
    const fonts = Promise.all(
      faces().map((face) =>
        (face.status === "unloaded" ? face.load() : face.loaded).catch(
          () => undefined,
        ),
      ),
    );
    let stored = loadedLayouts.get(content);
    if (!stored) {
      stored = loadLayouts(manifest.id, manifest.revision).then((layouts) => {
        let cache = measuredLayouts.get(content);
        if (!cache) measuredLayouts.set(content, (cache = new Map()));
        for (const [key, chapters] of layouts)
          if (!cache.has(key) && chapters.length === content.c.length) {
            for (const chapter of chapters)
              for (const entry of chapter.entries) {
                const [ci, fi] = entry.at.split(".").map((n) => +n - 1);
                const text = plain(content.c[ci]?.[fi] || []),
                  start = entry.offset % (text.length + 1);
                entry.preview = text.slice(start, start + 95);
              }
            cache.set(key, chapters);
          }
      });
      loadedLayouts.set(content, stored);
    }
    return { faces, ready: Promise.all([fonts, stored]) };
  }, [content, readingFont]);
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
  // First word of every physical leaf, from the last measurement.
  const entriesRef = useRef<PageEntry[]>([]);
  // Avoids scanning every word of the book on each page turn. A leaf without
  // words repeats the previous entry, so the word's column is confirmed.
  const leafWord = (leaf: number, geometry: Layout) => {
    const entry = entriesRef.current[leaf];
    if (!entry || !text.current) return undefined;
    const word = text.current.querySelector<HTMLElement>(
      `[data-reading-at="${entry.at}"] [data-book-char="${entry.offset}"]`,
    );
    return word && columnOf(word, geometry) === leaf ? word : undefined;
  };
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
    // A position inside the hint-free copy (Frank + original) stays there;
    // other modes, which render a single copy, fall back to the source offset.
    const word =
      (bookmark.offset > length
        ? words.find((word) => Number(word.dataset.bookChar) >= bookmark.offset)
        : undefined) ||
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
  const sourcesRef = useRef<string[]>([]);
  const paged = useRef<PagedState | null>(null);
  const appliedKey = useRef("");
  const settleFrame = useRef(0);
  const focused = useRef(false);
  const held = useRef(false);
  useLayoutEffect(() => {
    const down = () => (held.current = true),
      up = () => (held.current = false);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, []);
  const chapterChars = useMemo(
    () =>
      content.c.map((chapter, ci) =>
        chapter.reduce(
          (n, _, fi) =>
            n + (sourceTexts.get(`${ci + 1}.${fi + 1}`)?.length || 0),
          0,
        ),
      ),
    [content, sourceTexts],
  );
  const anchorChapter = () => Math.max(0, +anchor.current.at.split(".")[0] - 1);
  // The neighbouring chapters first (next, then previous), then the rest of
  // the book forward, then backward.
  const chapterOrder = (from: number, total: number) =>
    [
      from + 1,
      from - 1,
      ...Array.from({ length: total }, (_, i) => from + 2 + i),
      ...Array.from({ length: total }, (_, i) => from - 2 - i),
    ].filter((i) => i >= 0 && i < total);
  const chapterOfLeaf = (leaf: number) => {
    const starts = paged.current!.starts;
    let low = 0,
      high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      if (starts[mid] <= leaf) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  // Join chapter indexes into book pages. A chapter not measured yet gets an
  // estimated width from the measured text density; it is not rendered.
  const compose = (): Layout => {
    const state = paged.current!;
    const { geometry, measures } = state;
    let chars = 0,
      leaves = 0;
    measures.forEach((m, i) => {
      if (!m) return;
      chars += chapterChars[i];
      leaves += m.columns;
    });
    const perLeaf = leaves ? chars / leaves : 1200;
    const entries: PageEntry[] = [],
      sources: string[] = [],
      starts: number[] = [];
    measures.forEach((m, i) => {
      starts.push(entries.length);
      if (m) {
        for (const entry of m.entries) entries.push(entry);
        for (const source of m.sources) sources.push(source);
        // An empty facing column completes the chapter's last spread.
        for (let k = m.columns; k < chapterSpan(m.columns, geometry); k++) {
          entries.push(m.entries.at(-1)!);
          sources.push("");
        }
        return;
      }
      const columns = chapterSpan(
        Math.max(1, Math.round(chapterChars[i] / perLeaf)),
        geometry,
      );
      sizeChapter(state.chapters[i], columns, geometry);
      const at = `${i + 1}.1`,
        filler = {
          at,
          offset: 0,
          preview: (sourceTexts.get(at) || "").slice(0, 95),
        };
      for (let k = 0; k < columns; k++) {
        entries.push(filler);
        sources.push("");
      }
    });
    state.starts = starts;
    entriesRef.current = entries;
    sourcesRef.current = sources;
    const total = Math.max(1, entries.length);
    return {
      width: geometry.width,
      gap: geometry.gap,
      columns: geometry.columns,
      count: Math.ceil(total / geometry.columns),
      ready: true,
      leaves: total,
    };
  };
  const publish = () => {
    const entries = entriesRef.current,
      sources = sourcesRef.current;
    const json = JSON.stringify([entries, sources]);
    if (json !== emittedIndex.current) {
      emittedIndex.current = json;
      setPageIndex(entries);
      setPageSources(sources);
    }
    state.current.props.onIndex?.(entries);
  };
  // Show the page holding the reading position for the given layout.
  const applyLayout = (next: Layout) => {
    const canvas = text.current!;
    canvas.style.transition = "none";
    const restored = positionFor(next);
    state.current.layout = next;
    state.current.page = restored;
    if (!scrolling)
      canvas.style.transform = `translateX(${-restored * (next.width + next.gap)}px)`;
    setLayout(next);
    setPage(restored);
    cancelAnimationFrame(settleFrame.current);
    settleFrame.current = requestAnimationFrame(() => {
      if (text.current) text.current.style.transition = "";
    });
    const complete = !paged.current || paged.current.measures.every(Boolean);
    // Long books finish pagination in the background; tests and tools can
    // wait for "complete" before inspecting every page.
    if (root.current)
      root.current.dataset.paginated = complete ? "complete" : "partial";
    if (complete) publish();
    if (!focused.current && !props.measureOnly) {
      focused.current = true;
      root.current?.focus({ preventScroll: true });
    }
  };
  const measureAt = (ci: number) => {
    const state = paged.current!;
    const measure = measureChapter(
      text.current!,
      state.chapters[ci],
      state.geometry,
      sourceTexts,
    );
    sessionMeasured.add(measure);
    state.measures[ci] = measure;
    state.checked[ci] = true;
    if (state.measures.every(Boolean))
      void saveLayout(
        manifest.id,
        manifest.revision,
        state.key,
        state.measures as ChapterMeasure[],
      );
  };
  // Make sure a chapter about to be shown is measured (or that a stored
  // measurement still matches). Returns true when page numbers changed.
  const ensureChapter = (ci: number) => {
    const state = paged.current;
    if (!state || ci < 0 || ci >= state.chapters.length) return false;
    const known = state.measures[ci];
    if (known && state.checked[ci]) return false;
    if (known) {
      if (chapterMatches(state.chapters[ci], known, state.geometry.stride)) {
        state.checked[ci] = true;
        return false;
      }
      // This browser typesets differently now: discard every stored chapter.
      state.measures.forEach((_, i) => {
        if (!state.checked[i]) state.measures[i] = undefined;
      });
      void saveLayout(manifest.id, manifest.revision, state.key, null);
    }
    measureAt(ci);
    return true;
  };
  // Resolve a page and measure every chapter visible on it, repeating while
  // measurement moves page numbers. Returns the layout and whether it changed.
  const settlePage = (resolve: (geometry: Layout) => number) => {
    let next = state.current.layout,
      changed = false;
    for (let pass = 0; pass < 4; pass++) {
      const page = resolve(next);
      let measured = false;
      for (
        let leaf = page * next.columns;
        leaf < (page + 1) * next.columns && leaf < (next.leaves || 1);
        leaf++
      )
        measured = ensureChapter(chapterOfLeaf(leaf)) || measured;
      if (!measured) break;
      changed = true;
      next = compose();
    }
    return { next, changed };
  };
  const scheduleIdle = () => {
    const state = paged.current;
    if (!state || state.idle || state.measures.every(Boolean)) return;
    state.idle = idle(() => {
      state.idle = 0;
      if (paged.current !== state || !text.current) return;
      // Never re-number pages under a finger (slider, swipe) or mid-turn.
      if (root.current?.dataset.turning || dragTurn.current || held.current) {
        scheduleIdle();
        return;
      }
      const ci = chapterOrder(anchorChapter(), state.chapters.length).find(
        (i) => !state.measures[i],
      );
      if (ci === undefined) return;
      measureAt(ci);
      applyLayout(compose());
      scheduleIdle();
    });
  };
  // Book search needs the text of every page.
  const measureAll = () => {
    const state = paged.current;
    if (!state || state.measures.every(Boolean)) return;
    state.measures.forEach((m, i) => m || measureAt(i));
    applyLayout(compose());
  };
  // Measure columns after fonts/layout changes. The bookmark is a source-text offset,
  // so it survives a different font, window width or number of facing pages.
  useLayoutEffect(() => {
    let frame = 0,
      started = false,
      closed = false;
    // New geometry or text: pagination restarts until applyLayout says otherwise.
    if (root.current) root.current.dataset.paginated = "partial";
    const { faces } = preload;
    const calculate = () => {
      if (closed || !viewport.current || !text.current) return;
      const viewportBox = viewport.current.getBoundingClientRect();
      const viewportHeight = viewport.current.clientHeight;
      if (viewportBox.width <= 0 || viewportHeight <= 0) return;
      const width = viewportBox.width;
      const fontState = faces()
        .map((face) => face.status)
        .join();
      const cacheKey = JSON.stringify([
        width,
        viewportHeight,
        typesetting,
        fontState,
      ]);
      // Resize observers and font events repeat; identical geometry needs no work.
      if (appliedKey.current === cacheKey && state.current.layout.ready) return;
      stopTurn.current();
      dragTurn.current = null;
      if (paged.current?.idle) cancelIdle(paged.current.idle);
      clearTimeout(paged.current?.delay);
      paged.current = null;
      const canvas = text.current;
      // Safari may treat a percentage height inside an inset-positioned box
      // as auto, flowing the entire book into one long column. Use a definite
      // physical height before asking the browser to fragment its columns.
      canvas.style.height = scrolling ? "auto" : viewportHeight + "px";
      canvas.style.width = width + "px";
      // Apply the destination column geometry before any layout read. A mode
      // switch must not lay out the whole novel once with the old columns first.
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
      const stride = (width + gap) / columns;
      canvas.style.columnWidth = scrolling ? "auto" : columnWidth + "px";
      canvas.style.columnCount = scrolling ? "auto" : String(columns);
      canvas.style.columnGap = gap + "px";
      canvas.style.setProperty("--chapter-page", width + "px");
      canvas.style.setProperty("--chapter-columns", String(columns));
      canvas.style.setProperty("--chapter-height", viewportHeight + "px");
      appliedKey.current = cacheKey;
      if (!scrolling) {
        let cache = measuredLayouts.get(content);
        if (!cache) measuredLayouts.set(content, (cache = new Map()));
        let measures = cache.get(cacheKey);
        if (!measures) {
          cache.set(cacheKey, (measures = []));
          if (cache.size > 6) cache.delete(cache.keys().next().value!);
        }
        const chapters = [
          ...canvas.querySelectorAll<HTMLElement>(":scope > .folio-chapter"),
        ];
        // Dense, so every()/forEach() see chapters that are not measured yet.
        while (measures.length < chapters.length) measures.push(undefined);
        const geometry = {
          stride,
          gap,
          height: viewportHeight,
          width,
          columns,
        };
        paged.current = {
          key: cacheKey,
          geometry,
          chapters,
          measures,
          checked: chapters.map(
            (_, i) => !!measures[i] && sessionMeasured.has(measures[i]),
          ),
          starts: [],
          idle: 0,
          delay: 0,
        };
        measures.forEach((m, i) => m && applyChapter(chapters[i], m, geometry));
        const begin = performance.now();
        const target = anchorChapter();
        ensureChapter(target);
        // Short books are measured completely before they appear. Another
        // chapter is taken only while its expected cost, predicted from the
        // first chapter's speed, still fits in the opening budget.
        const rate =
          (performance.now() - begin) / Math.max(1, chapterChars[target]);
        for (const ci of chapterOrder(target, chapters.length)) {
          if (measures[ci]) continue;
          const elapsed = performance.now() - begin;
          if (elapsed + rate * chapterChars[ci] > OPEN_BUDGET) break;
          measureAt(ci);
        }
        state.current.layout = compose();
        applyLayout(settlePage((g) => positionFor(g)).next);
        // Let the first page paint and answer the first touch before the
        // remaining chapters are measured.
        const opened = paged.current;
        opened.delay = window.setTimeout(() => {
          opened.delay = 0;
          scheduleIdle();
        }, 500);
        return;
      }
      // Scroll: one continuous column, measured at once.
      sentencePages(canvas, stride, 0);
      let cache = scrollLayouts.get(content);
      if (!cache) scrollLayouts.set(content, (cache = new Map()));
      const cached = cache.get(cacheKey);
      if (cached) {
        entriesRef.current = cached.entries;
        sourcesRef.current = cached.sources;
        applyLayout(cached.layout);
        return;
      }
      const origin = canvas.getBoundingClientRect();
      const nodes = [
        ...canvas.querySelectorAll<HTMLElement>("[data-book-char]"),
      ];
      const leafOf = (element: Element) =>
        Math.max(
          0,
          Math.floor((textRect(element).top - origin.top + 1) / viewportHeight),
        );
      const entries: PageEntry[] = [];
      const sourceGroups: {
        key: string;
        source: string;
        start: number;
        end: number;
      }[][] = [];
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
          const start = char % (sourceText.length + 1);
          entries[leaf] ||= {
            at: address,
            offset: char,
            preview: sourceText.slice(start, start + 95),
          };
          if (copy > 0) continue;
          const end = start + (node.textContent?.length || 0);
          const groups = (sourceGroups[leaf] ||= []),
            key = address + ":" + copy;
          if (groups.at(-1)?.key === key) groups.at(-1)!.end = end;
          else groups.push({ key, source: sourceText, start, end });
        }
        cursor = low;
      }
      let lastLeaf = 0;
      for (const element of canvas.querySelectorAll(
        ".reading-panel p,.folio-chapter-title",
      ))
        for (const rect of element.getClientRects())
          lastLeaf = Math.max(
            lastLeaf,
            Math.floor((rect.bottom - origin.top - 0.5) / viewportHeight),
          );
      const leaves = Math.max(
        1,
        Math.ceil(canvas.scrollHeight / viewportHeight),
        entries.length,
        lastLeaf + 1,
      );
      for (let i = 0; i < leaves; i++)
        entries[i] ||= entries[i - 1] ||
          entries.find(Boolean) || { at: "1.1", offset: 0, preview: "" };
      const sources = Array.from({ length: leaves }, (_, i) =>
        (sourceGroups[i] || [])
          .map(
            (g) =>
              g.source.slice(g.start, g.end) +
              (g.source.slice(g.end).match(/^[^\p{L}\p{M}]*/u)?.[0] || ""),
          )
          .join("\n"),
      );
      const next = {
        width,
        gap,
        columns: 1,
        count: leaves,
        ready: true,
        leaves,
      };
      cache.set(cacheKey, { layout: next, entries, sources });
      if (cache.size > 6) cache.delete(cache.keys().next().value!);
      entriesRef.current = entries;
      sourcesRef.current = sources;
      applyLayout(next);
    };
    const measure = () => {
      if (!started) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Let the new settings and pressed state paint before the expensive
        // index calculation; opening a book still measures on its first frame.
        if (state.current.layout.ready)
          frame = requestAnimationFrame(calculate);
        else calculate();
      });
    };
    void Promise.race([
      preload.ready,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]).then(() => {
      if (closed) return;
      started = true;
      measure();
    });
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current!);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame.current);
      if (paged.current?.idle) cancelIdle(paged.current.idle);
      clearTimeout(paged.current?.delay);
      paged.current = null;
      appliedKey.current = "";
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [content, pages, typesetting]);
  useLayoutEffect(() => {
    if (bookQuery.trim()) measureAll();
  }, [bookQuery]);
  useLayoutEffect(() => {
    const key = at + ":" + offset;
    if (key === lastReported.current) return;
    anchor.current = { at, offset };
    if (!layout.ready) return;
    if (paged.current) {
      const measured = ensureChapter(anchorChapter());
      if (measured) state.current.layout = compose();
      const settled = settlePage((g) => positionFor(g));
      if (measured || settled.changed) {
        applyLayout(settled.next);
        return;
      }
    }
    setPage(positionFor(state.current.layout));
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
    const entry = entriesRef.current[next * geometry.columns];
    if (entry && leafWord(next * geometry.columns, geometry)) {
      anchor.current = { at: entry.at, offset: entry.offset };
      lastReported.current = entry.at + ":" + entry.offset;
      if (!props.measureOnly)
        state.current.props.onPosition(entry.at, entry.offset);
      return;
    }
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
  // Every chapter visible on the page is measured and confirmed.
  const pageReady = (page: number) => {
    const state = paged.current,
      geometry = stateLayout();
    if (!state || !state.starts.length) return true;
    for (
      let leaf = page * geometry.columns;
      leaf < (page + 1) * geometry.columns && leaf < (geometry.leaves || 1);
      leaf++
    ) {
      const ci = chapterOfLeaf(leaf);
      if (!state.measures[ci] || !state.checked[ci]) return false;
    }
    return true;
  };
  const stateLayout = () => state.current.layout;
  const clampPage = (page: number, geometry: Layout) =>
    Math.max(0, Math.min(geometry.count - 1, page));
  // Measure the destination chapter first when a turn or jump leaves the
  // measured part of a long book.
  const prepareTarget = (resolve: (geometry: Layout) => number) => {
    const settled = settlePage(resolve);
    if (settled.changed) applyLayout(settled.next);
  };
  const turn = (delta: number, interactive = false, originY = 0.75) => {
    props.onDismissWord();
    clearTimeout(lookupTimer.current);
    if (!state.current.layout.ready) return;
    if (
      paged.current &&
      !pageReady(clampPage(state.current.page + delta, state.current.layout))
    )
      prepareTarget((g) => clampPage(positionFor(g) + delta, g));
    const geometry = state.current.layout;
    const origin = state.current.page;
    const next = Math.max(0, Math.min(geometry.count - 1, origin + delta));
    if (next === origin) return;
    const canvas = text.current!;
    clearTurnAnimations();
    // Capture the complete sheet, including its margins, rather than sliding
    // just the text rectangle through a stationary frame.
    const box = root.current!.getBoundingClientRect();
    let nodes: HTMLElement[] | undefined;
    const snapshot = (target: number) => {
      const known = leafWord(target * geometry.columns, geometry);
      if (known)
        return finishSnapshot(pageSnapshot(canvas, box, known), target);
      nodes ||= [...canvas.querySelectorAll<HTMLElement>("[data-book-char]")];
      let low = 0,
        high = nodes.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (columnOf(nodes[middle], geometry) < target * geometry.columns)
          low = middle + 1;
        else high = middle;
      }
      return finishSnapshot(pageSnapshot(canvas, box, nodes[low]), target);
    };
    const finishSnapshot = (copy: HTMLElement, target: number) => {
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
  const jumpPage = (target: number) => {
    props.onDismissWord();
    clearTimeout(lookupTimer.current);
    clearTurnAnimations();
    // "Last page" stays the last page when measuring a chapter on the way
    // changes the page count (End, the end of the slider).
    const toEnd = target >= state.current.layout.count - 1;
    const resolve = (g: Layout) => (toEnd ? g.count - 1 : clampPage(target, g));
    if (paged.current && !pageReady(target)) prepareTarget(resolve);
    const next = resolve(state.current.layout);
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
          data-chaptered=""
          data-chapter-pages=""
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
                  {["frank", "clean", "parallel"].map((value) => {
                    const frank = value === "frank";
                    const selected = frank ? frankMode : mode === value;
                    return (
                      <button
                        role="tab"
                        aria-selected={selected}
                        data-reading-mode={value}
                        disabled={value === "parallel" && !content.t}
                        onClick={() =>
                          // A second press on the active Frank tab toggles
                          // Frank ↔ Frank + original.
                          props.onMode(
                            !frank
                              ? value
                              : mode === "frank"
                                ? "frank-original"
                                : "frank",
                          )
                        }
                      >
                        {t(
                          frank
                            ? mode === "frank-original"
                              ? "Frank+"
                              : "Frank"
                            : value === "clean"
                              ? "Clean"
                              : "Parallel",
                        )}
                      </button>
                    );
                  })}
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
                      props.onMode(
                        mode === "clean" ? lastFrank.current : "clean",
                      )
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
