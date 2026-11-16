import { planChapterBreaks } from "./sentence-pages";
import * as store from "./storage";

export type PageEntry = { at: string; offset: number; preview: string };
// Pagination of one chapter. Chapters start in a new column and are separate
// multicol boxes, so each is measured on its own; leaves are chapter-local.
export type ChapterMeasure = {
  columns: number;
  breaks: number[];
  entries: PageEntry[];
  sources: string[];
};
export type ChapterGeometry = {
  stride: number;
  gap: number;
  height: number;
  // One page: the chapter box always has this content width and column count,
  // so the browser derives exactly the same column width as for a single book
  // canvas, whether the chapter is being measured or shown.
  width: number;
  columns: number;
};

// Reserve room for a chapter's further (overflow) columns with padding and a
// margin correction, keeping its content box one page wide. The next chapter
// then starts exactly `columns` strides later.
// With facing pages every chapter starts on a new spread. Measuring a chapter
// in the background then never changes which columns face each other.
export const chapterSpan = (columns: number, geometry: ChapterGeometry) =>
  Math.ceil(columns / geometry.columns) * geometry.columns;
export function sizeChapter(
  chapter: HTMLElement,
  columns: number,
  geometry: ChapterGeometry,
) {
  const extent =
      chapterSpan(columns, geometry) * geometry.stride - geometry.gap,
    pad = Math.max(0, extent - geometry.width);
  chapter.style.setProperty("--chapter-pad", pad + "px");
  chapter.style.setProperty(
    "--chapter-shift",
    extent - geometry.width - pad + "px",
  );
}
// Last column holding text, from fragment and heading boxes (one rectangle
// per column fragment), relative to the chapter's first column.
function lastColumn(chapter: HTMLElement, stride: number, tail = Infinity) {
  const origin = chapter.getBoundingClientRect().left;
  const blocks = [
    ...chapter.querySelectorAll(
      ":scope > .folio-chapter-title, :scope > .folio-fragment",
    ),
  ].slice(-tail);
  let last = -1;
  for (const element of blocks)
    for (const rect of element.getClientRects())
      if (rect.height > 1)
        last = Math.max(last, Math.floor((rect.left - origin + 1) / stride));
  return last;
}

const firstRect = (range: Range, element: Element) => {
  range.selectNodeContents(element);
  for (const r of range.getClientRects())
    if (r.width > 0 && r.height > 0) return r;
  return element.getClientRects()[0] || element.getBoundingClientRect();
};

// Plan sentence breaks, typeset and index one chapter. Only this chapter is
// laid out: the others keep content-visibility and their measured widths.
export function measureChapter(
  canvas: HTMLElement,
  chapter: HTMLElement,
  geometry: ChapterGeometry,
  sourceTexts: Map<string, string>,
): ChapterMeasure {
  const { stride, gap, height } = geometry;
  chapter.dataset.measuring = "true";
  sizeChapter(chapter, geometry.columns, geometry);
  try {
    const breaks = planChapterBreaks(canvas, chapter, stride, gap, height);
    // Overflow columns beyond the one-page box show up in scrollWidth.
    const columns =
      chapter.scrollWidth > geometry.width + 1
        ? Math.ceil((chapter.scrollWidth + gap - 0.5) / stride)
        : 1;
    const origin = chapter.getBoundingClientRect().left;
    const range = document.createRange();
    const leafOf = (element: Element) =>
      Math.max(
        0,
        Math.floor((firstRect(range, element).left - origin + 1) / stride),
      );
    const nodes = [
      ...chapter.querySelectorAll<HTMLElement>("[data-book-char]"),
    ];
    const entries: PageEntry[] = [];
    const groups: {
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
        const text = sourceTexts.get(address)!;
        const char = Number(node.dataset.bookChar) || 0;
        const copy = Math.floor(char / (text.length + 1));
        const start = char % (text.length + 1);
        entries[leaf] ||= {
          at: address,
          offset: char,
          preview: text.slice(start, start + 95),
        };
        // Book search covers the Frank paragraph only; its hint-free repeat
        // would report every match twice.
        if (copy > 0) continue;
        const end = start + (node.textContent?.length || 0),
          list = (groups[leaf] ||= []),
          key = address + ":" + copy;
        if (list.at(-1)?.key === key) list.at(-1)!.end = end;
        else list.push({ key, source: text, start, end });
      }
      cursor = low;
    }
    // Fragment boxes include hints, punctuation and translations. They give
    // the last occupied leaf without a rectangle per text node.
    const lastLeaf = lastColumn(chapter, stride);
    const leaves = Math.max(columns, entries.length, lastLeaf + 1);
    const first = entries.find(Boolean) || {
      at:
        chapter.querySelector<HTMLElement>("[data-reading-at]")?.dataset
          .readingAt || "1.1",
      offset: 0,
      preview: "",
    };
    for (let i = 0; i < leaves; i++) entries[i] ||= entries[i - 1] || first;
    const sources = Array.from({ length: leaves }, (_, i) =>
      (groups[i] || [])
        .map(
          (g) =>
            g.source.slice(g.start, g.end) +
            (g.source.slice(g.end).match(/^[^\p{L}\p{M}]*/u)?.[0] || ""),
        )
        .join("\n"),
    );
    sizeChapter(chapter, leaves, geometry);
    return { columns: leaves, breaks, entries, sources };
  } finally {
    delete chapter.dataset.measuring;
  }
}

// Restore a known measurement without laying the chapter out.
export function applyChapter(
  chapter: HTMLElement,
  measure: ChapterMeasure,
  geometry: ChapterGeometry,
) {
  const rows = chapter.querySelectorAll<HTMLElement>(".sentence-row");
  for (const row of rows) delete row.dataset.pageStart;
  for (const i of measure.breaks)
    if (rows[i]) rows[i].dataset.pageStart = "true";
  sizeChapter(chapter, measure.columns, geometry);
}

// A stored measurement is trusted only while the chapter, now laid out,
// still ends in its last measured column.
export function chapterMatches(
  chapter: HTMLElement,
  measure: ChapterMeasure,
  stride: number,
) {
  const last = lastColumn(chapter, stride, 3);
  return last >= measure.columns - 2 && last <= measure.columns - 1;
}

// Saved between sessions so a long book opens without measuring again. The
// record is bound to the book revision and to the browser that typeset it.
const LAYOUTS = 4;
type Stored = {
  revision: number;
  environment: string;
  layouts: [string, [number, number[], [string, number][], string[]][]][];
};
const environment = () =>
  navigator.userAgent + "|" + (globalThis.devicePixelRatio || 1);
const storeKey = (id: string) => "layout:" + id;

export async function loadLayouts(id: string, revision: number) {
  try {
    const stored = await store.get<Stored>("drafts", storeKey(id));
    if (
      !stored ||
      stored.revision !== revision ||
      stored.environment !== environment()
    )
      return new Map<string, ChapterMeasure[]>();
    return new Map(
      stored.layouts.map(([key, chapters]) => [
        key,
        chapters.map(([columns, breaks, entries, sources]) => ({
          columns,
          breaks,
          entries: entries.map(([at, offset]) => ({ at, offset, preview: "" })),
          sources,
        })),
      ]),
    );
  } catch {
    return new Map<string, ChapterMeasure[]>();
  }
}

export async function saveLayout(
  id: string,
  revision: number,
  key: string,
  chapters: ChapterMeasure[] | null,
) {
  try {
    const stored = await store.get<Stored>("drafts", storeKey(id));
    const layouts =
      stored &&
      stored.revision === revision &&
      stored.environment === environment()
        ? stored.layouts.filter(([k]) => k !== key)
        : [];
    if (chapters)
      layouts.push([
        key,
        chapters.map((c) => [
          c.columns,
          c.breaks,
          c.entries.map((e) => [e.at, e.offset] as [string, number]),
          c.sources,
        ]),
      ]);
    await store.put("drafts", storeKey(id), {
      revision,
      environment: environment(),
      layouts: layouts.slice(-LAYOUTS),
    } satisfies Stored);
  } catch {
    /* A layout cache is an optimisation; storage errors must not block reading. */
  }
}
