import { readFile, writeFile } from "node:fs/promises";
import ESpeakNG from "espeak-ng";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
const sources = JSON.parse(await readFile("src/demo-source.json", "utf8"));
const wasm = await readFile("node_modules/espeak-ng/dist/espeak-ng.wasm");
const WORD = /[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*/gu;
const compiled = await WebAssembly.compile(wasm);
const cache = {};
// Retain the pronunciation of existing demo words and generate only new forms.
for (const packed of JSON.parse(await readFile("src/demos.json", "utf8"))) {
  const entries = unzipSync(Buffer.from(packed, "base64"));
  const book = JSON.parse(strFromU8(entries["book.json"]));
  for (const [form, [ipa]] of Object.entries(book.f)) cache[form] = ipa;
}

for (const source of sources) {
  const b = { v: 2, l: source.lemmas, f: {}, g: [], c: [], t: [] };
  for (const c of source.chapters) {
    const ch = [],
      t = [];
    for (const f of c.fragments) {
      ch.push(
        f.chunks.map((x) =>
          typeof x === "string"
            ? x
            : [
                x[0],
                ...x.slice(1).map((y) => {
                  if (y == null || y === 1) return y;
                  let i = b.g.indexOf(y);
                  if (i < 0) i = b.g.push(y) - 1;
                  return i;
                }),
              ],
        ),
      );
      t.push(f.translation);
    }
    b.c.push(ch);
    b.t.push(t);
  }
  const text = b.c
    .flat()
    .map((f) => f.map((c) => (typeof c === "string" ? c : c[0])).join(""))
    .join(" ");
  const forms = [...new Set(text.match(WORD))];
  for (const form of forms) {
    if (!source.ipa?.[form] && !cache[form]) {
      const mod = await ESpeakNG({
        arguments: ["-v", "de", "--ipa=3", "-q", "--phonout", "/ipa", form],
        wasmBinary: wasm,
        print: () => {},
        printErr: () => {},
        instantiateWasm: (imports, cb) => {
          WebAssembly.instantiate(compiled, imports).then((instance) =>
            cb(instance, compiled),
          );
          return {};
        },
      });
      cache[form] = mod.FS.readFile("/ipa", { encoding: "utf8" })
        .trim()
        .replace(/[\u200c\u200d]/g, "");
    }
    const li = b.l.findIndex(
      (l) =>
        l[0] === (source.forms[form] || form) ||
        l[0].replace(/^(der|die|das) /, "") === form,
    );
    const ipa = source.ipa?.[form] || cache[form];
    if (!/^[\p{L}\p{M}\sˈˌːˑ.͜͡‿|()\-]+$/u.test(ipa))
      throw Error(
        `Invalid generated IPA for ${form}; provide source.ipa[${JSON.stringify(form)}]`,
      );
    b.f[form] = li >= 0 ? [ipa, li] : [ipa];
  }
  const m = {
    format: "fbook",
    formatVersion: 2,
    id: source.id,
    revision: 2,
    ...source.meta,
    lang: "de",
    hintLang: "ru",
    annotation: "auto",
    has: ["ipa", "translation"],
    chapters: source.chapters.map((c) => [c.title, c.fragments.length]),
    stats: { fragments: b.c.flat().length, words: text.match(WORD).length },
  };
  const bytes = zipSync(
    {
      mimetype: [strToU8("application/vnd.fbook+zip"), { level: 0 }],
      "manifest.json": strToU8(JSON.stringify(m)),
      "book.json": strToU8(JSON.stringify(b)),
    },
    { level: 9 },
  );
  const slug = source.meta.title
    .toLowerCase()
    .replaceAll("ä", "a")
    .replace(/[^a-z0-9]+/g, "-");
  await writeFile("books/" + slug + "-demo.fbook", bytes);
  console.log(m.title, bytes.length, "bytes");
  source.packed = Buffer.from(bytes).toString("base64");
}
await writeFile("src/demos.json", JSON.stringify(sources.map((s) => s.packed)));
