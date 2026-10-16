import { plain, type Content } from "./core";
import type { PageEntry } from "./paged-reader";
export type TextHit = {
  at: string;
  offset: number;
  context: string;
  page: number;
};
export const positionKey = (at: string, offset = 0) => {
  const [c, f] = at.split(".").map(Number);
  return c * 1e12 + f * 1e7 + offset;
};
export function pageFor(
  entries: PageEntry[] | undefined,
  at: string,
  offset = 0,
) {
  if (!entries?.length) return 1;
  const key = positionKey(at, offset);
  let page = 0;
  for (let i = 0; i < entries.length; i++) {
    if (positionKey(entries[i].at, entries[i].offset) > key) break;
    page = i;
  }
  return page + 1;
}
export function searchText(
  content: Content,
  query: string,
  index?: PageEntry[],
): TextHit[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const hits: TextHit[] = [];
  content.c.forEach((chapter, ci) =>
    chapter.forEach((chunks, fi) => {
      const source = plain(chunks),
        lower = source.toLocaleLowerCase(),
        at = `${ci + 1}.${fi + 1}`;
      let start = 0;
      while (start < source.length) {
        const offset = lower.indexOf(q, start);
        if (offset < 0) break;
        hits.push({
          at,
          offset,
          context:
            (offset > 38 ? "…" : "") +
            source.slice(Math.max(0, offset - 38), offset + q.length + 90) +
            (offset + q.length + 90 < source.length ? "…" : ""),
          page: pageFor(index, at, offset),
        });
        start = offset + q.length;
      }
    }),
  );
  return hits;
}
export function highlightParts(text: string, query: string) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  const lower = text.toLocaleLowerCase();
  while (from < text.length) {
    const i = lower.indexOf(q, from);
    if (i < 0) {
      parts.push({ text: text.slice(from), match: false });
      break;
    }
    if (i > from) parts.push({ text: text.slice(from, i), match: false });
    parts.push({ text: text.slice(i, i + q.length), match: true });
    from = i + q.length;
  }
  return parts;
}
