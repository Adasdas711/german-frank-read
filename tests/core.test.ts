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
  readFileSync("books/die-bremer-stadtmusikanten-demo.fbook"),
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
describe("expanded examples", () => {
  it("ships ten times more original words with aligned hints, translations and IPA", () => {
    const embedded = JSON.parse(readFileSync("src/demos.json", "utf8"));
    const sources = JSON.parse(readFileSync("src/demo-source.json", "utf8"));
    for (const [index, [name, previous]] of [
      ["die-bremer-stadtmusikanten", 94],
      ["rotkappchen", 59],
      ["die-verwandlung", 20],
    ].entries()) {
      const bytes = new Uint8Array(
        readFileSync("books/" + name + "-demo.fbook"),
      );
      const b = readBook(bytes);
      expect(b.manifest.revision).toBe(2);
      expect(b.manifest.stats.words).toBeGreaterThanOrEqual(
        Number(previous) * 10,
      );
      expect(
        readBook(new Uint8Array(Buffer.from(embedded[index], "base64"))),
      ).toEqual(b);
      const paragraphs = b.content.c.flat().map(plain);
      expect(new Set(paragraphs).size).toBe(paragraphs.length);
      checkSource(sources[index]);
      expect(paragraphs).toEqual(
        sources[index].chapters.flatMap((c) =>
          c.fragments.map((f) =>
            f.chunks.map((c) => (typeof c === "string" ? c : c[0])).join(""),
          ),
        ),
      );
    }
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
    expect(parseBackup(strToU8(JSON.stringify(backup))).data).toEqual(backup);
    const z = zipSync({
      "backup.json": strToU8(JSON.stringify(backup)),
      [sample.manifest.id + ".fbook"]: bytes,
    });
    expect(parseBackup(z).books).toHaveLength(1);
  });
});

import { toPhonemes } from "../src/ipa";
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
  it("uses Russian and hides the unannotated copy by default", async () => {
    const { defaults, checkedSettings } = await import("../src/storage");
    expect(defaults.language).toBe("ru");
    expect(defaults.showClean).toBe(false);
    expect(checkedSettings({ readingFlow: "blocks" }).readingFlow).toBe(
      "pages",
    );
    expect(checkedSettings({}).readingFlow).toBe("pages");
    expect(
      checkedSettings({ readingFlow: "continuous", bookStyleVersion: 1 })
        .readingFlow,
    ).toBe("continuous");
    expect(checkedSettings({ readingFlow: "unexpected" }).readingFlow).toBe(
      "pages",
    );
    expect(checkedSettings({ language: "en" }).language).toBe("ru");
    const migrated = checkedSettings({
      showClean: true,
      fontSize: 24,
      theme: "dark",
      current: "book-1",
    });
    expect(migrated.showClean).toBe(false);
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
