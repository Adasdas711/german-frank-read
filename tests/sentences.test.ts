import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sentences, readBook, packBook, validate } from "../src/core";
import { readingSentences } from "../src/reading-text";
import { compileSource } from "../src/builder-core";

const P216 =
  "»Küß die Hand, gnä' Frau,« rief der Baumeister, lüftete den grünen Hut mit dem Gamsbart und behielt ihn in der Hand, so daß der weiße Kopf eine Weile unbedeckt blieb. »Wir wollen Sie grad abholen« – und auf ihren fragenden Blick – »haben Sie denn vergessen, gnä' Frau? heut ist ja Donnerstag, Tarockpartie beim Direktor.«";
const ROW1 =
  "»Küß die Hand, gnä' Frau,« rief der Baumeister, lüftete den grünen Hut mit dem Gamsbart und behielt ihn in der Hand, so daß der weiße Kopf eine Weile unbedeckt blieb.";
const ROW2 =
  "»Wir wollen Sie grad abholen« – und auf ihren fragenden Blick – »haben Sie denn vergessen, gnä' Frau? heut ist ja Donnerstag, Tarockpartie beim Direktor.«";

// [source, expected display rows]
const EXAMPLES: [string, string[]][] = [
  [P216, [ROW1, ROW2]],
  ["»Wer?«, fragte er. Dann ging er.", ["»Wer?«, fragte er.", "Dann ging er."]],
  [
    "»Dein Kreis...«, sagte Frau Rosner, »wer ist denn dein Kreis?",
    ["»Dein Kreis...«, sagte Frau Rosner, »wer ist denn dein Kreis?"],
  ],
  ["»Es ist gut...«,erwiderte Josef.", ["»Es ist gut...«,erwiderte Josef."]],
  [
    "Er kam am 6. Juni 1895. Sie nicht.",
    ["Er kam am 6. Juni 1895.", "Sie nicht."],
  ],
  [
    "Fräulein Else T., ein neunzehnjähriges Mädchen.",
    ["Fräulein Else T., ein neunzehnjähriges Mädchen."],
  ],
  [
    "Er sagte z.B. nichts. Dann ging er.",
    ["Er sagte z.B. nichts.", "Dann ging er."],
  ],
  [
    "Ich weiß nicht … Vielleicht morgen.",
    ["Ich weiß nicht …", "Vielleicht morgen."],
  ],
  ["Nein!« – »Doch!«", ["Nein!«", "– »Doch!«"]],
];

describe("legacy sentences() (format rule, must never change)", () => {
  it("splits the reference examples exactly as before", () => {
    expect(EXAMPLES.map(([s]) => sentences(s))).toMatchInlineSnapshot(`
      [
        [
          "»Küß die Hand, gnä' Frau,« rief der Baumeister, lüftete den grünen Hut mit dem Gamsbart und behielt ihn in der Hand, so daß der weiße Kopf eine Weile unbedeckt blieb.",
          "»Wir wollen Sie grad abholen« – und auf ihren fragenden Blick – »haben Sie denn vergessen, gnä' Frau?",
          "heut ist ja Donnerstag, Tarockpartie beim Direktor.",
          "«",
        ],
        [
          "»Wer?",
          "«, fragte er.",
          "Dann ging er.",
        ],
        [
          "»Dein Kreis...",
          "«, sagte Frau Rosner, »wer ist denn dein Kreis?",
        ],
        [
          "»Es ist gut...",
          "«,erwiderte Josef.",
        ],
        [
          "Er kam am 6.",
          "Juni 1895.",
          "Sie nicht.",
        ],
        [
          "Fräulein Else T.",
          ", ein neunzehnjähriges Mädchen.",
        ],
        [
          "Er sagte z.",
          "B.",
          "nichts.",
          "Dann ging er.",
        ],
        [
          "Ich weiß nicht … Vielleicht morgen.",
        ],
        [
          "Nein!",
          "« – »Doch!",
          "«",
        ],
      ]
    `);
  });
});

describe("readingSentences() display rows", () => {
  for (const [source, rows] of EXAMPLES)
    it(source.slice(0, 40), () => {
      const result = readingSentences(source, []);
      expect(result.map((r) => r.text)).toEqual(rows);
      for (const r of result) expect(source.slice(r.start, r.end)).toBe(r.text);
    });
  it("joins overlapping legacy translations for 2.16", () => {
    expect(
      readingSentences(P216, ["A", "B", "C", "»"]).map((r) => r.translation),
    ).toEqual(["A", "B C"]);
  });
  it("maps translations through split legacy sentences", () => {
    expect(
      readingSentences("»Wer?«, fragte er. Dann ging er.", [
        "— Кто?",
        "— спросил он.",
        "Потом он ушёл.",
      ]).map((r) => r.translation),
    ).toEqual(["— Кто? — спросил он.", "Потом он ушёл."]);
  });
  it("never splits one translated legacy sentence across rows", () => {
    expect(
      readingSentences("Ich weiß nicht … Vielleicht morgen.", ["Не знаю…"]),
    ).toEqual([
      {
        text: "Ich weiß nicht … Vielleicht morgen.",
        start: 0,
        end: 35,
        translation: "Не знаю…",
      },
    ]);
  });
});

const sample = readBook(
  new Uint8Array(
    Buffer.from(
      JSON.parse(readFileSync("tests/fixtures/legacy-books.json", "utf8"))[0],
      "base64",
    ),
  ),
);

describe("translation mismatch", () => {
  const broken = () => {
    const content = structuredClone(sample.content);
    const expected = content.t![0][1].length;
    content.t![0][1] = content.t![0][1].slice(0, -1).concat(["x", "y"]);
    return { content, expected, got: expected + 1 };
  };
  it("validate() keeps the book, reports and hides only that fragment", () => {
    const { content, expected, got } = broken();
    const untouched = structuredClone(content.t![0][0]);
    expect(validate(sample.manifest, content)).toEqual([
      { at: "1.2", expected, got },
    ]);
    expect(content.t![0][1]).toEqual([]);
    expect(content.t![0][0]).toEqual(untouched);
    expect(content.t![0][2]).toEqual(sample.content.t![0][2]);
  });
  it("validate() reports empty or non-string lines too", () => {
    const content = structuredClone(sample.content);
    const expected = content.t![0][0].length;
    content.t![0][0] = content.t![0][0].map((x, i) => (i ? x : " "));
    (content.t![0][2] as any) = "text";
    expect(validate(sample.manifest, content)).toEqual([
      { at: "1.1", expected, got: expected },
      { at: "1.3", expected: sample.content.t![0][2].length, got: 0 },
    ]);
  });
  it("other checks stay strict", () => {
    const { content } = broken();
    delete content.f.Esel;
    expect(() => validate(sample.manifest, content)).toThrow(/IPA/);
  });
  it("packBook() rejects it with expected and actual counts", () => {
    const { content, expected, got } = broken();
    expect(() => packBook(sample.manifest, content)).toThrow(
      `Число предложений перевода не совпадает: 1.2 (ожидалось ${expected}, в переводе ${got})`,
    );
  });
  it("readBook() opens a packed mismatching book with warnings", async () => {
    const { content, expected, got } = broken();
    const { zipSync, strToU8 } = await import("fflate");
    const bytes = zipSync({
      mimetype: [strToU8("application/vnd.fbook+zip"), { level: 0 }],
      "manifest.json": strToU8(JSON.stringify(sample.manifest)),
      "book.json": strToU8(JSON.stringify(content)),
    });
    const book = readBook(bytes);
    expect(book.warnings).toEqual([{ at: "1.2", expected, got }]);
    expect(book.content.t![0][1]).toEqual([]);
  });
  it("builder rejects it with expected and actual counts", () => {
    const source = JSON.parse(readFileSync("src/demo-source.json", "utf8"))[0];
    const fragment = source.chapters[0].fragments[1];
    const text = fragment.chunks
      .map((c: any) => (typeof c === "string" ? c : c[0]))
      .join("");
    const expected = sentences(text).length;
    fragment.translation = Array(expected + 1).fill("x");
    const ipa = Object.fromEntries(
      Object.entries(sample.content.f).map(([k, v]) => [k, v[0]]),
    );
    expect(() => compileSource(source, sample.manifest.id, 2, ipa, {})).toThrow(
      `Число предложений перевода не совпадает: 1.2 (ожидалось ${expected}, в переводе ${expected + 1})`,
    );
  });
});
