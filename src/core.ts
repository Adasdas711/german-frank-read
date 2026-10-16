import {
  zipSync,
  unzipSync,
  strToU8,
  strFromU8,
  unzip,
  Unzip,
  UnzipInflate,
} from "fflate";
export const MIME = "application/vnd.fbook+zip";
export const WORD = /[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*/gu;
export type Chunk = string | [string, number, number?, number?];
export type Manifest = {
  format: "fbook";
  formatVersion: 2;
  id: string;
  revision: number;
  title: string;
  titleRu?: string;
  author: string;
  lang: "de";
  hintLang: "ru";
  level: string;
  annotation: "auto" | "verified";
  has: string[];
  chapters: [string, number][];
  stats: { fragments: number; words: number };
  source?: string;
  license?: string;
};
export type Content = {
  v: 2;
  l: string[][];
  f: Record<string, [string, number?]>;
  g: string[];
  c: Chunk[][][];
  t?: string[][][];
  x?: Record<string, Record<string, string>>;
};
export type Book = { manifest: Manifest; bytes: Uint8Array; addedAt?: string };
export const plain = (chunks: Chunk[]) =>
  chunks.map((c) => (typeof c === "string" ? c : c[0])).join("");
export const words = (s: string): string[] => s.match(WORD) || [];
export const sentences = (s: string) =>
  s
    .match(/[^.!?]+[.!?]+[»”"']*|[^.!?]+$/g)
    ?.map((x) => x.trim())
    .filter(Boolean) || [];
const fail = (s: string): never => {
  throw Error(s);
};
export const IPA = /^[\p{L}\p{M}\sˈˌːˑ.͜͡‿|()\-]+$/u;
export function validate(m: any, b: any): asserts b is Content {
  if (!m || m.format !== "fbook" || m.formatVersion !== 2)
    fail("Неподдерживаемая версия .fbook. Нужен формат 2.");
  for (const key of [
    "id",
    "title",
    "author",
    "lang",
    "hintLang",
    "level",
    "annotation",
  ])
    if (typeof m[key] !== "string" || !m[key].trim())
      fail("В манифесте отсутствует " + key);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      m.id,
    )
  )
    fail("id книги должен быть UUID.");
  if (
    m.lang !== "de" ||
    m.hintLang !== "ru" ||
    !["A1", "A2", "B1", "B2", "C1", "C2"].includes(m.level) ||
    !["auto", "verified"].includes(m.annotation) ||
    !Number.isInteger(m.revision) ||
    m.revision < 1
  )
    fail("Некорректные поля манифеста.");
  if (
    !Array.isArray(m.chapters) ||
    !m.chapters.length ||
    !Array.isArray(m.has) ||
    !m.has.every((x: any) => ["ipa", "translation"].includes(x)) ||
    !m.has.includes("ipa")
  )
    fail("Некорректный список глав или возможностей.");
  if (
    !b ||
    b.v !== 2 ||
    !Array.isArray(b.l) ||
    !b.l.every(
      (l: any) =>
        Array.isArray(l) &&
        l.length >= 3 &&
        l.every((s: any) => typeof s === "string"),
    ) ||
    !Array.isArray(b.g) ||
    !b.g.every((g: any) => typeof g === "string") ||
    !b.f ||
    typeof b.f !== "object" ||
    Array.isArray(b.f) ||
    !Array.isArray(b.c) ||
    b.c.length !== m.chapters.length
  )
    fail("Неверная структура book.json.");
  for (const [form, v] of Object.entries(b.f) as any) {
    if (
      !Array.isArray(v) ||
      typeof v[0] !== "string" ||
      !v[0].trim() ||
      !IPA.test(v[0]) ||
      (v[1] !== undefined && (!Number.isInteger(v[1]) || !b.l[v[1]]))
    )
      fail("Некорректная IPA или лемма: " + form);
  }
  const hasT = m.has.includes("translation");
  if (hasT && (!Array.isArray(b.t) || b.t.length !== b.c.length))
    fail("Не хватает перевода глав.");
  let count = 0,
    wcount = 0;
  b.c.forEach((chapter: any, ci: number) => {
    if (
      !Array.isArray(chapter) ||
      !chapter.length ||
      !Array.isArray(m.chapters[ci]) ||
      typeof m.chapters[ci][0] !== "string" ||
      m.chapters[ci][1] !== chapter.length
    )
      fail("Не совпадает число отрывков главы " + (ci + 1));
    if (hasT && (!Array.isArray(b.t[ci]) || b.t[ci].length !== chapter.length))
      fail("Не совпадает перевод главы " + (ci + 1));
    chapter.forEach((frag: any, fi: number) => {
      const at = `${ci + 1}.${fi + 1}`;
      if (!Array.isArray(frag) || !frag.length) fail("Пустой отрывок " + at);
      frag.forEach((c: any) => {
        if (typeof c === "string") return;
        if (
          !Array.isArray(c) ||
          c.length < 2 ||
          c.length > 4 ||
          typeof c[0] !== "string" ||
          !Number.isInteger(c[1]) ||
          b.g[c[1]] === undefined ||
          (c[2] != null &&
            (!Number.isInteger(c[2]) || b.g[c[2]] === undefined)) ||
          (c[3] !== undefined && c[3] !== 1)
        )
          fail("Неверная подсказка: " + at);
      });
      const text = plain(frag);
      if (!text.trim()) fail("Пустой текст " + at);
      count++;
      wcount += words(text).length;
      for (const word of words(text))
        if (!Object.hasOwn(b.f, word)) fail(`Нет IPA для «${word}» в ${at}`);
      if (hasT) {
        const t = b.t[ci][fi];
        if (
          !Array.isArray(t) ||
          !t.every((x: any) => typeof x === "string" && x.trim()) ||
          t.length !== sentences(text).length
        )
          fail("Число предложений перевода не совпадает: " + at);
      }
    });
  });
  if (!m.stats || m.stats.fragments !== count || m.stats.words !== wcount)
    fail("Статистика манифеста не совпадает с текстом.");
  if (b.x) {
    if (typeof b.x !== "object" || Array.isArray(b.x))
      fail("Неверная таблица омографов.");
    for (const [at, forms] of Object.entries(b.x) as any) {
      const [c, f] = at.split(".").map(Number);
      if (
        !/^\d+\.\d+$/.test(at) ||
        !b.c[c - 1]?.[f - 1] ||
        !forms ||
        typeof forms !== "object"
      )
        fail("Неверный адрес IPA: " + at);
      for (const [form, ipa] of Object.entries(forms))
        if (
          !words(plain(b.c[c - 1][f - 1])).includes(form) ||
          typeof ipa !== "string" ||
          !IPA.test(ipa) ||
          !ipa.trim()
        )
          fail("Неверная IPA по месту: " + at);
    }
  }
}
const MAX = 32 * 1024 * 1024;
// Read the central directory before inflation. Never trust compressed or advertised sizes alone.
export function inspectZip(bytes: Uint8Array, book = true) {
  if (bytes.length > MAX) fail("Архив превышает лимит 32 МБ.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (
      v.getUint32(p, true) === 0x06054b50 &&
      p + 22 + v.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  if (end < 0) fail("Повреждённый ZIP: не найден каталог.");
  if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true))
    fail("Многотомный архив не поддерживается.");
  const n = v.getUint16(end + 10, true),
    offset = v.getUint32(end + 16, true);
  if (n > 250 || offset + v.getUint32(end + 12, true) !== end)
    fail("Некорректный каталог ZIP.");
  let p = offset,
    total = 0;
  const entries: {
    name: string;
    crc: number;
    size: number;
    method: number;
    offset: number;
  }[] = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50)
      fail("Повреждённый каталог ZIP.");
    const nameLen = v.getUint16(p + 28, true),
      extra = v.getUint16(p + 30, true),
      comment = v.getUint16(p + 32, true);
    if (p + 46 + nameLen + extra + comment > end)
      fail("Повреждённый заголовок ZIP.");
    const name = strFromU8(bytes.subarray(p + 46, p + 46 + nameLen));
    const size = v.getUint32(p + 24, true),
      compressed = v.getUint32(p + 20, true),
      method = v.getUint16(p + 10, true),
      loc = v.getUint32(p + 42, true);
    if (
      seen.has(name) ||
      name.includes("..") ||
      name.includes("/") ||
      name.includes("\\") ||
      v.getUint16(p + 8, true) & 1 ||
      ![0, 8].includes(method)
    )
      fail("Недопустимая запись ZIP: " + name);
    seen.add(name);
    total += size;
    if (total > MAX) fail("Распакованная книга превышает лимит 32 МБ.");
    if (loc + 30 > offset || v.getUint32(loc, true) !== 0x04034b50)
      fail("Повреждённый локальный заголовок ZIP.");
    const localN = v.getUint16(loc + 26, true),
      localE = v.getUint16(loc + 28, true);
    if (
      loc + 30 + localN + localE + compressed > offset ||
      strFromU8(bytes.subarray(loc + 30, loc + 30 + localN)) !== name ||
      v.getUint16(loc + 8, true) !== method
    )
      fail("Каталог ZIP не совпадает с содержимым.");
    entries.push({
      name,
      crc: v.getUint32(p + 16, true),
      size,
      method,
      offset: loc,
    });
    p += 46 + nameLen + extra + comment;
  }
  if (p !== end) fail("Повреждённая длина каталога ZIP.");
  if (
    book &&
    (n !== 3 ||
      entries.some(
        (e) => !["mimetype", "manifest.json", "book.json"].includes(e.name),
      ) ||
      entries.find((e) => e.name === "mimetype")?.offset !== 0 ||
      entries.find((e) => e.name === "mimetype")?.method !== 0)
  )
    fail(
      "В .fbook нужны только mimetype (первый, без сжатия), manifest.json и book.json.",
    );
  return entries;
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  for (let k = 0; k < 8; k++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
export function crc32(a: Uint8Array) {
  let c = 0xffffffff;
  for (const n of a) c = crcTable[(c ^ n) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function safeUnzip(bytes: Uint8Array, book = true) {
  const entries = inspectZip(bytes, book),
    out: Record<string, Uint8Array> = {};
  let used = 0;
  const stream = new Unzip((file) => {
    const e = entries.find((x) => x.name === file.name);
    if (!e) fail("Неожиданная запись ZIP.");
    const parts: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, data, final) => {
      if (err) throw err;
      size += data.length;
      used += data.length;
      if (size > e!.size || used > MAX) {
        file.terminate();
        fail("Превышен размер распаковки.");
      }
      parts.push(data);
      if (final) {
        if (size !== e!.size) fail("Не совпадает размер записи.");
        const a = new Uint8Array(size);
        let p = 0;
        for (const part of parts) {
          a.set(part, p);
          p += part.length;
        }
        if (crc32(a) !== e!.crc) fail("Ошибка CRC-32: " + file.name);
        out[file.name] = a;
      }
    };
    file.start();
  });
  stream.register(UnzipInflate);
  for (let p = 0; p < bytes.length; p += 8192)
    stream.push(bytes.subarray(p, p + 8192), p + 8192 >= bytes.length);
  if (Object.keys(out).length !== entries.length)
    fail("Архив распакован не полностью.");
  return out;
}
export function readBook(bytes: Uint8Array) {
  const out = safeUnzip(bytes);
  if (strFromU8(out.mimetype) !== MIME) fail("Неверный mimetype .fbook.");
  let manifest, content;
  try {
    manifest = JSON.parse(strFromU8(out["manifest.json"]));
    content = JSON.parse(strFromU8(out["book.json"]));
  } catch {
    fail("Некорректный JSON в книге.");
  }
  validate(manifest, content);
  return { manifest: manifest as Manifest, content: content as Content, bytes };
}
export function packBook(manifest: Manifest, content: Content) {
  validate(manifest, content);
  const bytes = zipSync(
    {
      mimetype: [strToU8(MIME), { level: 0 }],
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "book.json": strToU8(JSON.stringify(content)),
    },
    { level: 9 },
  );
  readBook(bytes);
  return bytes;
}
export function locate(b: Content, at: string) {
  let [c, f] = at.split(".").map((n) => Number(n) - 1);
  if (!b.c[c]?.[f]) {
    c = 0;
    f = 0;
  }
  return { c, f, chunks: b.c[c][f] };
}
export function addresses(b: Content) {
  return b.c.flatMap((c, ci) => c.map((_, fi) => `${ci + 1}.${fi + 1}`));
}
export function download(
  data: BlobPart | Uint8Array,
  name: string,
  type = "application/octet-stream",
) {
  const blob = new Blob([data as BlobPart], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "book";
export function csv(rows: string[][]) {
  return (
    "\ufeff" +
    rows
      .map((r) => r.map((s) => '"' + s.replace(/"/g, '""') + '"').join(","))
      .join("\r\n")
  );
}
