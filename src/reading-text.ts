import { sentences } from "./core";

// Keep the archive's legacy sentence indexes intact; repair quotation boundaries
// only for presentation, so existing fbooks and their translations still load.
export function readingSentences(source: string, translations: string[]) {
  let cursor = 0;
  const old = sentences(source).map((text, i) => {
    const start = source.indexOf(text, cursor);
    cursor = start + text.length;
    return { start, end: cursor, translation: translations[i] || "" };
  });
  const rows: {
    text: string;
    start: number;
    end: number;
    translation: string;
  }[] = [];
  for (const match of source.matchAll(/[^.!?]+[.!?]+[»”“"')\]]*|[^.!?]+$/g)) {
    const text = match[0].trim();
    if (!text) continue;
    const start = match.index! + match[0].indexOf(text),
      end = start + text.length;
    if (!/[\p{L}\p{N}]/u.test(text) && rows.length) {
      rows.at(-1)!.text += text;
      rows.at(-1)!.end = end;
      continue;
    }
    const parts = old
      .filter((row) => {
        const overlap = source.slice(
          Math.max(start, row.start),
          Math.min(end, row.end),
        );
        return (
          row.end > start && row.start < end && /[\p{L}\p{N}]/u.test(overlap)
        );
      })
      .map((row) => row.translation)
      .filter((value) => /[\p{L}\p{N}]/u.test(value));
    rows.push({
      text,
      start,
      end,
      translation: parts.filter((part, i) => part !== parts[i - 1]).join(" "),
    });
  }
  return rows;
}
