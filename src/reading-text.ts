import { sentences } from "./core";

const LETTER = /[\p{L}\p{N}]/u;
// A display sentence ends after [.!?…]+ and optional closing quotes/brackets,
// when whitespace and a character that is not a lowercase letter follow, or at
// the end of the text. "…«, sagte", "gut...«,erwiderte", "z.B. nichts" and
// "Frau? heut" are therefore not boundaries.
const BOUNDARY = /[.!?…]+[»«”“"'’›‹)\]]*(?=\s+[^\p{Ll}\s]|\s*$)/gu;
// German ordinals ("am 6. Juni", "im 19. Jahrhundert") are not sentence ends.
const ORDINAL = /(?:^|[^\p{L}\p{N}])\d{1,2}$/u;

function displayRanges(source: string) {
  const ranges: { start: number; end: number }[] = [];
  let from = 0;
  const push = (to: number) => {
    const piece = source.slice(from, to),
      lead = piece.length - piece.trimStart().length,
      text = piece.trim();
    from = to;
    if (!text) return;
    const start = to - piece.length + lead,
      end = start + text.length;
    // Rows without letters or digits (a stray quote) join the previous row.
    if (!LETTER.test(text) && ranges.length) ranges.at(-1)!.end = end;
    else ranges.push({ start, end });
  };
  for (const match of source.matchAll(BOUNDARY)) {
    const at = match.index!;
    if (match[0] === "." && ORDINAL.test(source.slice(0, at))) continue;
    push(at + match[0].length);
  }
  push(source.length);
  return ranges;
}

// Keep the archive's legacy sentence indexes intact; sentence boundaries are
// repaired only for presentation, so existing fbooks and their translations
// still load. Each display row takes the translations of every legacy sentence
// it overlaps by letters.
export function readingSentences(source: string, translations: string[]) {
  let cursor = 0;
  const old = sentences(source).map((text, i) => {
    const start = source.indexOf(text, cursor);
    cursor = start + text.length;
    return { start, end: cursor, translation: translations[i] || "" };
  });
  const covered = (start: number, end: number) =>
    old.flatMap((row, i) =>
      row.end > start &&
      row.start < end &&
      LETTER.test(
        source.slice(Math.max(start, row.start), Math.min(end, row.end)),
      )
        ? [i]
        : [],
    );
  const translated = (i: number) => LETTER.test(old[i].translation);
  // A display row never splits a translated legacy sentence: if two rows share
  // one, they are shown as one row so its translation is not repeated.
  const ranges: { start: number; end: number; legacy: number[] }[] = [];
  for (const range of displayRanges(source)) {
    const legacy = covered(range.start, range.end),
      last = ranges.at(-1);
    if (last && legacy.some((i) => translated(i) && last.legacy.includes(i))) {
      last.end = range.end;
      last.legacy = [...new Set([...last.legacy, ...legacy])];
    } else ranges.push({ ...range, legacy });
  }
  return ranges.map(({ start, end, legacy }) => {
    const parts = legacy
      .map((i) => old[i].translation)
      .filter((value) => LETTER.test(value));
    return {
      text: source.slice(start, end),
      start,
      end,
      translation: parts.filter((part, i) => part !== parts[i - 1]).join(" "),
    };
  });
}
