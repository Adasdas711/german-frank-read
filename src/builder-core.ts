import {
  words,
  plain,
  sentences,
  IPA,
  validate,
  packBook,
  type Content,
  type Manifest,
  type Chunk,
} from "./core";
export type Source = {
  meta: {
    title: string;
    titleRu?: string;
    author: string;
    level: string;
    source: string;
    license: string;
    part?: number;
    chaptersInPart?: number[];
  };
  chapters: {
    n: number;
    title: string;
    fragments: {
      chunks: (string | [string, string, string?, number?])[];
      translation: string[];
    }[];
  }[];
  lemmas: string[][];
  ipa?: Record<string, string>;
  ipaAt?: Record<string, Record<string, string>>;
};
export function checkSource(source: any): asserts source is Source {
  if (
    !source?.meta ||
    !Array.isArray(source.chapters) ||
    !source.chapters.length ||
    !Array.isArray(source.lemmas)
  )
    throw Error("Нужны meta, chapters и lemmas из book.source.json.");
  for (const k of ["title", "author", "level", "source", "license"])
    if (typeof source.meta[k] !== "string" || !source.meta[k].trim())
      throw Error("Заполните meta." + k);
  if (!["A1", "A2", "B1", "B2", "C1", "C2"].includes(source.meta.level))
    throw Error("Уровень должен быть A1–C2.");
  if (
    !source.lemmas.every(
      (l: any) =>
        Array.isArray(l) &&
        l.length === 3 &&
        l.every((s: any) => typeof s === "string"),
    )
  )
    throw Error("Некорректные lemmas.");
  let n = 1;
  for (const chapter of source.chapters) {
    if (chapter.n !== n++)
      throw Error(
        "Главы должны идти по порядку с 1, без пропусков и повторов.",
      );
    if (
      !Array.isArray(chapter.fragments) ||
      !chapter.fragments.length ||
      typeof chapter.title !== "string"
    )
      throw Error("Пустая или некорректная глава.");
    for (const [fi, f] of chapter.fragments.entries()) {
      const at = chapter.n + "." + (fi + 1);
      if (
        !Array.isArray(f.chunks) ||
        !f.chunks.length ||
        !Array.isArray(f.translation)
      )
        throw Error("Некорректный отрывок " + at);
      for (const c of f.chunks)
        if (
          typeof c !== "string" &&
          (!Array.isArray(c) ||
            c.length < 2 ||
            c.length > 4 ||
            typeof c[0] !== "string" ||
            typeof c[1] !== "string" ||
            (c[2] != null && typeof c[2] !== "string") ||
            (c[3] !== undefined && c[3] !== 1))
        )
          throw Error("Некорректный кусок " + at);
      const text = f.chunks
        .map((c: any) => (typeof c === "string" ? c : c[0]))
        .join("");
      if (!text.trim()) throw Error("Пустой текст " + at);
      if (
        f.translation.length &&
        (!f.translation.every((t: any) => typeof t === "string" && t.trim()) ||
          f.translation.length !== sentences(text).length)
      )
        throw Error("Не совпадает число предложений перевода: " + at);
    }
  }
  const translated = source.chapters
    .flatMap((c: any) => c.fragments)
    .map((f: any) => !!f.translation.length);
  if (translated.some(Boolean) && translated.some((x: boolean) => !x))
    throw Error(
      "Перевод должен быть у всех отрывков либо отсутствовать везде.",
    );
  for (const [form, ipa] of Object.entries(source.ipa || {}))
    if (typeof ipa !== "string")
      throw Error("IPA должна быть строкой: " + form);
}
export function mergeSources(parts: any[]): Source {
  if (!parts.length) throw Error("Нет исходников.");
  if (parts.length === 1) {
    checkSource(parts[0]);
    return parts[0];
  }
  const sorted = [...parts].sort(
    (a, b) => (a.meta?.part || 0) - (b.meta?.part || 0),
  );
  const result = structuredClone(sorted[0]);
  result.chapters = [];
  result.lemmas = [];
  result.ipa = {};
  result.ipaAt = {};
  const seen = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.meta?.part !== i + 1)
      throw Error("Номера частей должны идти с 1 без пропусков.");
    if (
      p.meta?.title !== result.meta.title ||
      p.meta?.author !== result.meta.author ||
      !Array.isArray(p.chapters) ||
      !Array.isArray(p.lemmas)
    )
      throw Error("Части относятся к разным книгам или повреждены.");
    for (const c of p.chapters) {
      if (seen.has(c.n)) throw Error("Повторяется глава " + c.n);
      seen.add(c.n);
      result.chapters.push(c);
    }
    for (const l of p.lemmas) {
      const old = result.lemmas.find((x: any) => x[0] === l[0]);
      if (old && JSON.stringify(old) !== JSON.stringify(l))
        throw Error("Разные значения леммы " + l[0]);
      if (!old) result.lemmas.push(l);
    }
    Object.assign(result.ipa, p.ipa || {});
    Object.assign(result.ipaAt, p.ipaAt || {});
  }
  result.chapters.sort((a: any, b: any) => a.n - b.n);
  checkSource(result);
  return result;
}
export const sourceText = (s: Source) =>
  s.chapters
    .flatMap((c) =>
      c.fragments.map((f) =>
        f.chunks.map((c) => (typeof c === "string" ? c : c[0])).join(""),
      ),
    )
    .join("\n\n");
export function compileSource(
  s: Source,
  id: string,
  revision: number,
  ipa: Record<string, string>,
  links: Record<string, number>,
  verified = false,
) {
  checkSource(s);
  const b: Content = {
    v: 2,
    l: s.lemmas,
    f: {},
    g: [],
    c: [],
    ...(s.chapters[0].fragments[0].translation.length ? { t: [] } : {}),
    ...(s.ipaAt && Object.keys(s.ipaAt).length ? { x: s.ipaAt } : {}),
  };
  const g = (text: string) => {
    let i = b.g.indexOf(text);
    if (i < 0) i = b.g.push(text) - 1;
    return i;
  };
  for (const ch of s.chapters) {
    b.c.push(
      ch.fragments.map((f) =>
        f.chunks.map((c) =>
          typeof c === "string"
            ? c
            : ([
                c[0],
                g(c[1]),
                ...(c[2] != null || c[3] === 1
                  ? [c[2] != null ? g(c[2]) : null]
                  : []),
                ...(c[3] === 1 ? [1] : []),
              ] as Chunk),
        ),
      ),
    );
    b.t?.push(ch.fragments.map((f) => f.translation));
  }
  for (const word of new Set(words(sourceText(s)))) {
    if (!ipa[word]) throw Error("Сначала создайте IPA: " + word);
    b.f[word] =
      links[word] !== undefined ? [ipa[word], links[word]] : [ipa[word]];
  }
  const m: Manifest = {
    format: "fbook",
    formatVersion: 2,
    id,
    revision,
    title: s.meta.title,
    titleRu: s.meta.titleRu || "",
    author: s.meta.author,
    lang: "de",
    hintLang: "ru",
    level: s.meta.level,
    annotation: verified ? "verified" : "auto",
    has: ["ipa", ...(b.t ? ["translation"] : [])],
    chapters: s.chapters.map((c) => [c.title, c.fragments.length]),
    stats: { fragments: b.c.flat().length, words: words(sourceText(s)).length },
    source: s.meta.source,
    license: s.meta.license,
  };
  return { manifest: m, content: b, bytes: packBook(m, b) };
}
export function normalizePDF(s: string) {
  return s
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .split("\n")
    .filter((line) => !/^\s*\d+\s*$/.test(line))
    .join("\n")
    .replace(/[„“”«»]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export function compareText(pdf: string, source: string) {
  const a = words(normalizePDF(pdf)),
    b = words(normalizePDF(source)),
    diff: { type: "same" | "missing" | "extra"; text: string }[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      diff.push({ type: "same", text: a[i++] });
      j++;
      continue;
    }
    let ai = -1,
      bj = -1;
    for (let k = 1; k < 35; k++) {
      if (ai < 0 && a[i + k] === b[j]) ai = k;
      if (bj < 0 && b[j + k] === a[i]) bj = k;
    }
    if (ai > 0 && (bj < 0 || ai <= bj)) {
      for (let k = 0; k < ai; k++) diff.push({ type: "missing", text: a[i++] });
    } else if (bj > 0) {
      for (let k = 0; k < bj; k++) diff.push({ type: "extra", text: b[j++] });
    } else {
      if (i < a.length) diff.push({ type: "missing", text: a[i++] });
      if (j < b.length) diff.push({ type: "extra", text: b[j++] });
    }
  }
  return diff;
}
