import { readFile, writeFile } from "node:fs/promises";
import ESpeakNG from "espeak-ng";
import { unzipSync, strFromU8 } from "fflate";
import {
  packBook,
  readBook,
  words,
  plain,
  sentences,
  IPA,
} from "../src/core.ts";
import { toPhonemes } from "../src/ipa.ts";
const source = JSON.parse(await readFile("src/immensee-source.json", "utf8"));
const overrides = JSON.parse(
  await readFile("src/immensee-ipa-overrides.json", "utf8"),
);
const content = { v: 2, l: source.lemmas, f: {}, g: [], c: [], t: [] };
const glossary = new Map();
for (const chapter of source.chapters) {
  content.c.push(
    chapter.fragments.map((fragment) =>
      fragment.chunks.map((chunk) => {
        if (typeof chunk === "string") return chunk;
        let i = glossary.get(chunk[1]);
        if (i === undefined) {
          i = content.g.push(chunk[1]) - 1;
          glossary.set(chunk[1], i);
        }
        return [chunk[0], i];
      }),
    ),
  );
  content.t.push(chapter.fragments.map((fragment) => fragment.translation));
}
const cache = {};
for (const packed of JSON.parse(await readFile("src/demos.json", "utf8"))) {
  const files = unzipSync(Buffer.from(packed, "base64"));
  const book = JSON.parse(strFromU8(files["book.json"]));
  for (const [form, [ipa]] of Object.entries(book.f)) cache[form] = ipa;
}
try {
  const old = readBook(await readFile("books/immensee.fbook"));
  for (const [form, [ipa]] of Object.entries(old.content.f)) cache[form] = ipa;
} catch {}
const forms = [
  ...new Set(content.c.flat().flatMap((chunks) => words(plain(chunks)))),
];
const missing = forms.filter((form) => !cache[form] && !overrides[form]);
const wasm = await readFile("node_modules/espeak-ng/dist/espeak-ng.wasm");
const compiled = await WebAssembly.compile(wasm);
for (let i = 0; i < missing.length; i += 100) {
  const group = missing.slice(i, i + 100);
  const module = await ESpeakNG({
    arguments: [
      "-v",
      "de",
      "--ipa=3",
      "-q",
      "--phonout",
      "/ipa",
      group.map((word) => word + ".").join("\n\n"),
    ],
    wasmBinary: wasm,
    print: () => {},
    printErr: () => {},
    instantiateWasm: (imports, callback) => {
      WebAssembly.instantiate(compiled, imports).then((instance) =>
        callback(instance, compiled),
      );
      return {};
    },
  });
  const ipa = module.FS.readFile("/ipa", { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim().replace(/[\u200c\u200d]/g, ""))
    .filter(Boolean);
  if (ipa.length !== group.length)
    throw Error(
      `IPA alignment mismatch at ${i}: ${ipa.length} / ${group.length}`,
    );
  group.forEach((form, j) => (cache[form] = ipa[j]));
  console.log(`IPA ${Math.min(i + 100, missing.length)}/${missing.length}`);
}
for (const form of forms) {
  const ipa = overrides[form] || cache[form];
  if (!ipa || !IPA.test(ipa)) throw Error("Invalid IPA " + form + ": " + ipa);
  toPhonemes(ipa);
  const lemma = content.l.findIndex(
    (l) => l[0] === form || l[0].replace(/^(der|die|das) /, "") === form,
  );
  content.f[form] = lemma >= 0 ? [ipa, lemma] : [ipa];
}
const manifest = {
  format: "fbook",
  formatVersion: 2,
  id: source.id,
  revision: 1,
  ...source.meta,
  lang: "de",
  hintLang: "ru",
  annotation: "auto",
  has: ["ipa", "translation"],
  chapters: source.chapters.map((c) => [c.title, c.fragments.length]),
  stats: {
    fragments: content.c.flat().length,
    words: content.c.flat().reduce((n, c) => n + words(plain(c)).length, 0),
  },
};
const bytes = packBook(manifest, content);
readBook(bytes);
await writeFile("books/immensee.fbook", bytes);
await writeFile(
  "src/immensee.json",
  JSON.stringify(Buffer.from(bytes).toString("base64")) + "\n",
);
console.log(
  "Full Immensee:",
  manifest.chapters.length,
  "chapters,",
  manifest.stats.words,
  "words,",
  content.g.length,
  "hints,",
  bytes.length,
  "bytes",
);
