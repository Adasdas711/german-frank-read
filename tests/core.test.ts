import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import {
  readBook,
  validate,
  packBook,
  inspectZip,
  safeUnzip,
  plain,
  crc32,
  MIME,
} from "../src/core";
import {
  checkSource,
  mergeSources,
  compileSource,
  compareText,
} from "../src/builder-core";
import { parseBackup } from "../src/transfer";
const bytes = new Uint8Array(
  Buffer.from(
    JSON.parse(readFileSync("tests/fixtures/legacy-books.json", "utf8"))[0],
    "base64",
  ),
);
const sample = readBook(bytes);
const source = JSON.parse(readFileSync("src/demo-source.json", "utf8"))[0];
describe("fbook v2", () => {
  it("round trips real demo and preserves chunks", () => {
    expect(sample.content.c[0]).toHaveLength(30);
    expect(readBook(packBook(sample.manifest, sample.content)).content).toEqual(
      sample.content,
    );
    expect(plain(sample.content.c[0][1])).toContain(
      "Da dachte der Herr daran,",
    );
  });
  it("requires IPA for every form", () => {
    const b = structuredClone(sample.content);
    delete b.f.Esel;
    expect(() => validate(sample.manifest, b)).toThrow(/IPA/);
  });
  it("rejects invalid hint and translation counts", () => {
    const b = structuredClone(sample.content);
    (b.c[0][0][0] as any)[1] = 999999;
    expect(() => validate(sample.manifest, b)).toThrow(/подсказка/);
    const c = structuredClone(sample.content);
    c.t![0][0] = [];
    expect(() => validate(sample.manifest, c)).toThrow(/предложений/);
  });
  it("rejects extra entries, encrypted and inflated sizes", () => {
    const entries = {
      mimetype: [strToU8(MIME), { level: 0 }],
      "manifest.json": strToU8(JSON.stringify(sample.manifest)),
      "book.json": strToU8(JSON.stringify(sample.content)),
      "evil.js": strToU8("x"),
    };
    expect(() => readBook(zipSync(entries as any))).toThrow(/только/);
    const b = bytes.slice();
    const p = b.findIndex(
      (_, i) =>
        b[i] === 80 && b[i + 1] === 75 && b[i + 2] === 1 && b[i + 3] === 2,
    );
    new DataView(b.buffer).setUint32(p + 24, 1000000000, true);
    expect(() => inspectZip(b)).toThrow(/32 МБ/);
  });
  it("checks CRC rather than accepting corrupted payload", () => {
    const b = bytes.slice();
    b[38] ^= 1;
    expect(() => readBook(b)).toThrow(/CRC|mimetype/);
  });
  it("rejects duplicate names before unpacking", () => {
    const b = bytes.slice();
    const p = b.findIndex(
      (_, i) =>
        b[i] === 80 && b[i + 1] === 75 && b[i + 2] === 1 && b[i + 3] === 2,
    );
    b[p + 46] = 120;
    expect(() => inspectZip(b)).toThrow(/запись|совпадает/);
  });
  it("validates contextual homograph addresses", () => {
    const b = structuredClone(sample.content);
    b.x = { "9.99": { Esel: "eːzl" } };
    expect(() => validate(sample.manifest, b)).toThrow(/адрес/);
  });
  it("computes standard CRC32", () =>
    expect(crc32(strToU8("123456789"))).toBe(0xcbf43926));
});
describe("supplied full editions", () => {
  it("embeds every supplied book intact with stable site identities", () => {
    const embedded = JSON.parse(readFileSync("src/demos.json", "utf8"));
    const catalog = JSON.parse(readFileSync("books/catalog.json", "utf8"));
    expect(catalog).toHaveLength(3);
    for (const [i, item] of catalog.entries()) {
      const b = readBook(new Uint8Array(readFileSync("books/" + item.file)));
      const original = readBook(new Uint8Array(readFileSync(item.source)));
      expect(b.manifest.id).toBe(item.id);
      expect(b.manifest.revision).toBe(3);
      expect(b.manifest.stats).toEqual(item.stats);
      expect(b.content).toEqual(original.content);
      expect(
        readBook(new Uint8Array(Buffer.from(embedded[i], "base64"))),
      ).toEqual(b);
      expect(b.manifest.annotation).toBe("auto");
    }
    const kafka = readBook(
      new Uint8Array(readFileSync("books/die-verwandlung-demo.fbook")),
    );
    expect(kafka.manifest.chapters).toHaveLength(3);
    expect(kafka.manifest.stats.words).toBe(19145);
    expect(plain(kafka.content.c[2].at(-1)!)).toContain(
      "ihren jungen Körper dehnte.",
    );
  });
});
describe("builder", () => {
  it("checks source and rejects missing chapters", () => {
    expect(() => checkSource(source)).not.toThrow();
    const s = structuredClone(source);
    s.chapters[0].n = 2;
    expect(() => checkSource(s)).toThrow(/Главы/);
  });
  it("compiles source into valid compressed fbook", () => {
    const ipa = Object.fromEntries(
      Object.entries(sample.content.f).map(([k, v]) => [k, v[0]]),
    );
    const b = compileSource(source, sample.manifest.id, 2, ipa, {});
    expect(readBook(b.bytes).manifest.revision).toBe(2);
    expect(plain(b.content.c[0][1])).toEqual(plain(sample.content.c[0][1]));
  });
  it("reports absent IPA and invalid translated sentences", () => {
    expect(() => compileSource(source, sample.manifest.id, 2, {}, {})).toThrow(
      /IPA/,
    );
    const s = structuredClone(source);
    s.chapters[0].fragments[0].translation = [];
    expect(() => checkSource(s)).toThrow(/Перевод/);
  });
  it("compares PDF hyphenation and finds missing words", () => {
    expect(
      compareText("Es hatte ei-\nnen Esel.", "Es hatte einen Esel.").every(
        (x) => x.type === "same",
      ),
    ).toBe(true);
    expect(
      compareText("Es hatte einen Esel.", "Es hatte Esel.")
        .filter((x) => x.type === "missing")
        .map((x) => x.text),
    ).toEqual(["einen"]);
  });
  it("rejects duplicate chapters across parts", () => {
    const a = structuredClone(source),
      b = structuredClone(source);
    a.meta.part = 1;
    b.meta.part = 2;
    expect(() => mergeSources([a, b])).toThrow(/Повторяется/);
  });
});
describe("backup validation", () => {
  it("preserves source-word bookmarks and rejects invalid character offsets", () => {
    const backup = {
      backup: "franka",
      version: 2,
      words: [],
      progress: [
        {
          book: sample.manifest.id,
          at: "1.2",
          offset: 42,
          percent: 8,
          mode: "frank",
          updatedAt: "2026-10-16T00:00:00.000Z",
        },
      ],
    };
    expect(
      parseBackup(strToU8(JSON.stringify(backup))).data.progress[0].offset,
    ).toBe(42);
    for (const offset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        parseBackup(
          strToU8(
            JSON.stringify({
              ...backup,
              progress: [{ ...backup.progress[0], offset }],
            }),
          ),
        ),
      ).toThrow(/прогресс/);
  });

  it("rejects unrelated and invalid backups", () => {
    expect(() => parseBackup(strToU8("{}"))).toThrow(/формат/);
    expect(() =>
      parseBackup(
        strToU8(
          JSON.stringify({
            backup: "franka",
            version: 2,
            words: [{}],
            progress: [],
          }),
        ),
      ),
    ).toThrow(/слово/);
  });
  it("accepts a valid empty backup and a zip with books", () => {
    const backup = { backup: "franka", version: 2, words: [], progress: [] };
    expect(parseBackup(strToU8(JSON.stringify(backup))).data).toEqual({
      ...backup,
      collections: [],
    });
    const z = zipSync({
      "backup.json": strToU8(JSON.stringify(backup)),
      [sample.manifest.id + ".fbook"]: bytes,
    });
    expect(parseBackup(z).books).toHaveLength(1);
  });
});

import { toPhonemes } from "../src/ipa";
import { readingSentences } from "../src/reading-text";
describe("Reader quotation boundaries", () => {
  it("keeps German closing quotes with their sentence and legacy translations aligned", () => {
    const rows = readingSentences(
      "„Ein Engel?“ sagte sie. „Hatte er denn Flügel?“",
      ["Ангел?", "сказала она.", "У него были крылья?", "“"],
    );
    expect(rows.map((row) => row.text)).toEqual([
      "„Ein Engel?“",
      "sagte sie.",
      "„Hatte er denn Flügel?“",
    ]);
    expect(rows.map((row) => row.translation)).toEqual([
      "Ангел?",
      "сказала она.",
      "У него были крылья?",
    ]);
  });
  it("preserves the full Immensee original without quotation-only parallel rows", () => {
    const book = readBook(new Uint8Array(readFileSync("books/immensee.fbook")));
    for (const [ci, chapter] of book.content.c.entries())
      for (const [fi, chunks] of chapter.entries()) {
        const source = plain(chunks),
          rows = readingSentences(source, book.content.t![ci][fi]);
        expect(
          rows
            .map((row) => row.text)
            .join("")
            .replace(/\s/g, ""),
        ).toBe(source.replace(/\s/g, ""));
        expect(rows.every((row) => /[\p{L}\p{N}]/u.test(row.text))).toBe(true);
      }
  });
});
describe("German IPA mapping", () => {
  it("covers every IPA form in shipped demos", () => {
    for (const name of [
      "die-bremer-stadtmusikanten",
      "rotkappchen",
      "die-verwandlung",
    ]) {
      const b = readBook(
        new Uint8Array(readFileSync("books/" + name + "-demo.fbook")),
      );
      for (const [ipa] of Object.values(b.content.f))
        expect(() => toPhonemes(ipa)).not.toThrow();
    }
  });
  it("preserves stress, long vowels, diphthongs and pauses", () => {
    expect(toPhonemes("ˈaɪ̯ | ʃøːn")).toBe("'aI _ S2:n");
    expect(toPhonemes("ˈa\u200dɪn")).toBe("'aIn");
    expect(() => toPhonemes("😀")).toThrow(/символ/);
  });
});

describe("reader preferences", () => {
  it("uses English by default, preserves existing languages and migrates reading preferences", async () => {
    const { defaults, checkedSettings } = await import("../src/storage");
    expect(defaults.language).toBe("en");
    expect(defaults.showClean).toBe(false);
    expect(checkedSettings({ readingFlow: "blocks" }).readingFlow).toBe(
      "pages",
    );
    expect(checkedSettings({}).readingFlow).toBe("pages");
    expect(
      checkedSettings({ readingFlow: "continuous", bookStyleVersion: 1 })
        .readingFlow,
    ).toBe("pages");
    expect(checkedSettings({ readingFlow: "continuous" }).pageTurn).toBe(
      "scroll",
    );
    expect(checkedSettings({ readingFlow: "unexpected" }).readingFlow).toBe(
      "pages",
    );
    expect(checkedSettings({ language: "en" }).language).toBe("en");
    expect(checkedSettings({ language: "ru" }).language).toBe("ru");
    const migrated = checkedSettings({
      showClean: true,
      fontSize: 24,
      theme: "dark",
      current: "book-1",
    });
    expect(migrated.showClean).toBe(true);
    expect(migrated).toMatchObject({
      fontSize: 24,
      theme: "dark",
      current: "book-1",
    });
    expect(
      checkedSettings({ ...migrated, showClean: true, language: "de" }),
    ).toMatchObject({ showClean: true, language: "de" });
  });
  it("translates messages and parameters without touching book data", async () => {
    const { translate, translateMessage } = await import("../src/i18n");
    expect(translate("de", "  Назад ")).toBe("  Zurück ");
    expect(
      translate("ru", "{0}, версия {1}. Прогресс и слова сохранятся.", {
        0: "Buch",
        1: 2,
      }),
    ).toBe("Buch, версия 2. Прогресс и слова сохранятся.");
    expect(
      translate("de", "{0}, версия {1}. Прогресс и слова сохранятся.", {
        0: "Buch",
        1: 2,
      }),
    ).toBe("Buch, Version 2. Lesefortschritt und Wörter bleiben erhalten.");
    expect(translateMessage("de", "Файл превышает 32 МБ.")).toBe(
      "Die Datei ist größer als 32 MB.",
    );
    expect(translate("de", "Бременские музыканты")).toBe(
      "Бременские музыканты",
    );
  });
});

describe("Books v2 settings and search", () => {
  it("validates theme options and preserves an existing installation", async () => {
    const { checkedSettings } = await import("../src/storage");
    expect(
      checkedSettings({
        language: "ru",
        showClean: false,
        current: "uuid",
        font: "sans",
        readingFlow: "continuous",
        rate: 1.25,
      }),
    ).toMatchObject({
      language: "ru",
      showClean: false,
      current: "uuid",
      font: "Golos Text",
      pageTurn: "scroll",
      rate: 1.25,
      designVersion: 2,
    });
    expect(
      checkedSettings({
        hintColor: "url(javascript:alert(1))",
        fontSize: 100,
        lineSpacing: 0,
        columns: "invalid",
        recentSearches: ["Esel", 4, null],
      }),
    ).toMatchObject({
      hintColor: "",
      fontSize: 36,
      lineSpacing: 1.15,
      columns: "auto",
      recentSearches: ["Esel"],
    });
  });
  it("finds every occurrence in original text and maps source offsets to real pages", async () => {
    const { searchText, pageFor, highlightParts } = await import(
      "../src/library-model"
    );
    const hits = searchText(sample.content, "Esel", [
      { at: "1.1", offset: 0, preview: "" },
      { at: "1.1", offset: 30, preview: "" },
      { at: "1.2", offset: 0, preview: "" },
    ]);
    expect(hits.length).toBeGreaterThan(3);
    expect(hits[0].at).toBe("1.1");
    expect(hits[0].context).toContain("Esel");
    expect(
      pageFor(
        [
          { at: "1.1", offset: 0, preview: "" },
          { at: "1.1", offset: 30, preview: "" },
        ],
        "1.1",
        35,
      ),
    ).toBe(2);
    expect(
      highlightParts("Mühle und MÜHLE", "mühle").filter((p) => p.match),
    ).toHaveLength(2);
    expect(searchText(sample.content, "   ")).toEqual([]);
  });
  it("localizes all new interface strings without translating the book", async () => {
    const { bookLocales } = await import("../src/books-locales");
    const { translate } = await import("../src/i18n");
    for (const [key, values] of Object.entries(bookLocales))
      for (const lang of ["en", "ru", "de"] as const)
        expect(translate(lang, key)).toBe(values[lang]);
    expect(translate("en", "Page {0} of {1}", { 0: 2, 1: 18 })).toBe(
      "Page 2 of 18",
    );
    expect(translate("ru", "Page {0} of {1}", { 0: 2, 1: 18 })).toBe(
      "Страница 2 из 18",
    );
  });
});

describe("Personal collections and complete Immensee", () => {
  it("moves collections and books without modifying the library", async () => {
    const {
      moveCollection,
      moveBookToCollection,
      checkedCollections,
      mergeCollections,
    } = await import("../src/collections");
    const list = [
      { id: "a", name: "Stories", bookIds: ["one"], updatedAt: "2026-01-01" },
      { id: "b", name: "German", bookIds: ["two"], updatedAt: "2026-01-02" },
      { id: "c", name: "Next", bookIds: [], updatedAt: "2026-01-03" },
    ];
    expect(moveCollection(list, "c", "a").map((c) => c.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moveCollection(list, "a", null).map((c) => c.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    const moved = moveBookToCollection(list, "one", "b");
    expect(moved[0].bookIds).toEqual([]);
    expect(moved[1].bookIds).toEqual(["two", "one"]);
    expect(list[0].bookIds).toEqual(["one"]);
    expect(
      moveBookToCollection(moved, "one", null).flatMap((c) => c.bookIds),
    ).toEqual(["two"]);
    expect(() => checkedCollections([{ ...list[0], name: " " }])).toThrow();
    expect(() => checkedCollections([list[0], list[0]])).toThrow();
    expect(
      mergeCollections(list, [
        { ...list[1], name: "Updated", updatedAt: "2026-02-01" },
      ])[0].name,
    ).toBe("Updated");
    const full = Array.from({ length: 200 }, (_, i) => ({
      ...list[0],
      id: String(i),
    }));
    expect(() => mergeCollections(full, list)).toThrow(
      "Collection limit reached",
    );
  });
  it("accepts old backups and validates and restores collection records", () => {
    const data = {
      backup: "franka",
      version: 2,
      progress: [],
      words: [],
      collections: [
        {
          id: "a",
          name: "Stories",
          bookIds: ["book"],
          updatedAt: "2026-01-01",
        },
      ],
    };
    expect(parseBackup(strToU8(JSON.stringify(data))).data.collections).toEqual(
      data.collections,
    );
    expect(() =>
      parseBackup(
        strToU8(
          JSON.stringify({
            ...data,
            collections: [{ ...data.collections[0], bookIds: [99] }],
          }),
        ),
      ),
    ).toThrow("Invalid collections backup");
  });
  it("ships the full supplied story, with 10 actual chapters, source hints and working IPA", async () => {
    const { toPhonemes } = await import("../src/ipa");
    const book = readBook(new Uint8Array(readFileSync("books/immensee.fbook")));
    const source = JSON.parse(readFileSync("src/immensee-source.json", "utf8"));
    expect(book.manifest.title).toBe("Immensee");
    expect(book.manifest.chapters).toHaveLength(10);
    expect(book.manifest.stats.words).toBe(9484);
    expect(book.manifest.stats.fragments).toBe(111);
    expect(plain(book.content.c[0][0])).toMatch(
      /^An einem Spätherbstnachmittage/,
    );
    expect(plain(book.content.c[9].at(-1)!)).toMatch(
      /Kraft seiner Jugend geübt hatte\.$/,
    );
    for (const [ci, chapter] of book.content.c.entries())
      for (const [fi, chunks] of chapter.entries())
        expect(plain(chunks)).toBe(
          source.chapters[ci].fragments[fi].chunks
            .map((c) => (typeof c === "string" ? c : c[0]))
            .join(""),
        );
    expect(
      book.content.c
        .flat()
        .flat()
        .filter((c) => Array.isArray(c)),
    ).toHaveLength(1406);
    for (const [form, [ipa]] of Object.entries(book.content.f)) {
      expect(ipa, form).not.toContain("?");
      expect(() => toPhonemes(ipa), form).not.toThrow();
    }
    expect(book.content.l.length).toBeGreaterThan(800);
    expect(book.manifest.source).toContain("Theodor Storm. Immensee.pdf");
    expect(book.manifest.license).toContain("2018");
  });
});
