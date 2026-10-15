import { zipSync, strToU8, strFromU8 } from "fflate";
import * as store from "./storage";
import { safeUnzip, readBook, escape, csv, download, slug } from "./core";
import type { Book } from "./core";
import type { SavedWord, Progress } from "./storage";
export async function exportBackup(withBooks: boolean) {
  const data = await store.backup(),
    date = new Date().toISOString().slice(0, 10);
  if (!withBooks) {
    download(
      JSON.stringify(data, null, 2),
      `franka-backup-${date}.json`,
      "application/json",
    );
    return;
  }
  const files: Record<string, Uint8Array> = {
    "backup.json": strToU8(JSON.stringify(data)),
  };
  for (const b of await store.all<Book>("books"))
    files[b.manifest.id + ".fbook"] = b.bytes;
  download(zipSync(files, { level: 6 }), `franka-backup-${date}.zip`);
}
export function parseBackup(bytes: Uint8Array) {
  let data: any,
    books: Book[] = [];
  if (bytes[0] === 80 && bytes[1] === 75) {
    const files = safeUnzip(bytes, false);
    if (!files["backup.json"]) throw Error("В архиве нет backup.json.");
    for (const [name, bytes] of Object.entries(files)) {
      if (name === "backup.json") continue;
      if (!name.endsWith(".fbook"))
        throw Error("Неожиданный файл резервной копии.");
      const b = readBook(bytes);
      books.push({ manifest: b.manifest, bytes });
    }
    data = JSON.parse(strFromU8(files["backup.json"]));
  } else data = JSON.parse(strFromU8(bytes));
  if (
    data?.backup !== "franka" ||
    data.version !== 2 ||
    !Array.isArray(data.words) ||
    !Array.isArray(data.progress) ||
    data.words.length > 100000 ||
    data.progress.length > 10000
  )
    throw Error("Неверный формат резервной копии.");
  for (const p of data.progress)
    if (
      !p ||
      typeof p.book !== "string" ||
      typeof p.at !== "string" ||
      !/^\d+\.\d+$/.test(p.at) ||
      !Number.isFinite(p.percent) ||
      p.percent < 0 ||
      p.percent > 100 ||
      !["frank", "clean", "parallel"].includes(p.mode) ||
      (p.updatedAt && !Number.isFinite(Date.parse(p.updatedAt)))
    )
      throw Error("Повреждённый прогресс в копии.");
  for (const w of data.words)
    if (
      !w ||
      !["book", "at", "lemma", "ru", "ipa", "context", "savedAt"].every(
        (k) => typeof w[k] === "string",
      ) ||
      !w.lemma ||
      !Number.isFinite(Date.parse(w.savedAt))
    )
      throw Error("Повреждённое слово в копии.");
  return { data, books };
}
export async function importBackup(
  parsed: ReturnType<typeof parseBackup>,
  replaceSettings: boolean,
) {
  const { data, books } = parsed,
    d = await store.db();
  await new Promise<void>((res, rej) => {
    const t = d.transaction(
      ["books", "progress", "words", "settings"],
      "readwrite",
    );
    for (const b of books) {
      const s = t.objectStore("books"),
        r = s.get(b.manifest.id);
      r.onsuccess = () => {
        if (!r.result || r.result.manifest.revision < b.manifest.revision)
          s.put(b, b.manifest.id);
      };
    }
    for (const p of data.progress) {
      const s = t.objectStore("progress"),
        r = s.get(p.book);
      r.onsuccess = () => {
        if (
          !r.result ||
          Date.parse(r.result.updatedAt || "1970-01-01") <=
            Date.parse(p.updatedAt || data.exportedAt || "1970-01-01")
        )
          s.put({ ...p, updatedAt: p.updatedAt || data.exportedAt }, p.book);
      };
    }
    for (const w of data.words) {
      const key = [w.book, w.lemma, w.at].join("|"),
        s = t.objectStore("words"),
        r = s.get(key);
      r.onsuccess = () => {
        if (!r.result)
          s.put(
            { ...w, key, form: w.form || w.lemma, inAnki: !!w.inAnki },
            key,
          );
      };
    }
    if (replaceSettings && data.settings)
      t.objectStore("settings").put(
        store.checkedSettings(data.settings),
        "app",
      );
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export function exportWords(
  list: SavedWord[],
  books: Book[],
  anki: boolean,
  onlyNew = true,
) {
  const chosen = list.filter((w) => !anki || !onlyNew || !w.inAnki);
  if (!chosen.length) throw Error("Нет новых слов для экспорта.");
  if (!anki) {
    download(
      csv([
        ["Слово", "IPA", "Перевод", "Контекст", "Книга", "Отрывок"],
        ...chosen.map((w) => [
          w.lemma,
          w.ipa,
          w.ru,
          w.context,
          books.find((b) => b.manifest.id === w.book)?.manifest.title || w.book,
          w.at,
        ]),
      ]),
      "franka-words.csv",
      "text/csv;charset=utf-8",
    );
    return chosen;
  }
  const cell = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  const lines = chosen.map((w) => {
    const title =
      books.find((b) => b.manifest.id === w.book)?.manifest.title || w.book;
    const context = escape(w.context).replace(
      new RegExp(escape(w.form).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"),
      "<b>$&</b>",
    );
    return [
      cell(`<b>${escape(w.lemma)}</b> [${escape(w.ipa)}]`),
      cell(`${escape(w.ru)}<br><i>${context}</i>`),
      "franka " + slug(title),
      cell("Немецкий по Франку::" + title.replaceAll("::", " ")),
    ].join("\t");
  });
  download(
    "#separator:tab\n#html:true\n#notetype:Basic\n#tags column:3\n#deck column:4\n" +
      lines.join("\n"),
    "franka-anki.txt",
    "text/plain;charset=utf-8",
  );
  return chosen;
}
