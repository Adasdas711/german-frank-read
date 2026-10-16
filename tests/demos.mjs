import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import assert from "node:assert/strict";
const names = ["die-bremer-stadtmusikanten", "rotkappchen", "die-verwandlung"];
const demos = await Promise.all(
  names.map(async (name) => {
    const entries = unzipSync(await readFile(`books/${name}-demo.fbook`));
    return {
      manifest: JSON.parse(strFromU8(entries["manifest.json"])),
      content: JSON.parse(strFromU8(entries["book.json"])),
    };
  }),
);
function record(manifest, content) {
  const bytes = zipSync({
    mimetype: [strToU8("application/vnd.fbook+zip"), { level: 0 }],
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "book.json": strToU8(JSON.stringify(content)),
  });
  return { manifest, bytes: [...bytes] };
}
const old = structuredClone(demos[0]);
old.manifest.revision = 1;
old.manifest.chapters[0][1] = 3;
old.manifest.stats = { fragments: 3, words: 94 };
old.content.c[0] = old.content.c[0].slice(0, 3);
old.content.t[0] = old.content.t[0].slice(0, 3);
const newer = structuredClone(demos[1]);
newer.manifest.revision = 8;
newer.manifest.title = "Eigene Ausgabe";
const custom = structuredClone(old);
custom.manifest.id = "11111111-2222-4333-8444-555555555555";
custom.manifest.title = "Meine Geschichte";
const word = {
  key: demos[0].manifest.id + "|der Esel|1.1",
  book: demos[0].manifest.id,
  at: "1.1",
  lemma: "der Esel",
  ru: "осёл",
  ipa: "ˈeːzəl",
  context: "Es hatte ein Mann einen Esel",
  form: "Esel",
  savedAt: "2026-10-15T12:00:00.000Z",
  inAnki: true,
};
const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((resolve) => server.listen(4179, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4179/german-frank-read/");
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  for (const b of demos) {
    for (const mode of ["frank", "clean", "parallel"]) {
      await page.evaluate(
        ({ id, mode }) => (location.hash = `/read/${id}/1.1/${mode}`),
        { id: b.manifest.id, mode },
      );
      await page.locator(".books-reader[data-ready=true]").waitFor();
      assert.equal(
        await page.locator(".folio-fragment").count(),
        b.manifest.stats.fragments,
      );
    }
  }
  await page.evaluate(() => (location.hash = "/home"));
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  // Simulate an existing installation, including a deleted demo and a newer edition.
  await page.evaluate(
    async ({ records, deleted, word }) => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("franka-v2");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(
          ["books", "words", "progress", "settings"],
          "readwrite",
        );
        for (const record of records)
          tx.objectStore("books").put(
            { ...record, bytes: new Uint8Array(record.bytes) },
            record.manifest.id,
          );
        tx.objectStore("books").delete(deleted);
        tx.objectStore("words").put(word, word.key);
        tx.objectStore("progress").put(
          {
            book: word.book,
            at: "1.3",
            mode: "frank",
            percent: 67,
            updatedAt: "2026-10-15T12:00:00.000Z",
          },
          word.book,
        );
        tx.objectStore("settings").put(
          {
            font: "sans",
            fontSize: 24,
            theme: "dark",
            language: "de",
            showClean: true,
            readingDefaultsVersion: 1,
            readingFlow: "continuous",
            bookStyleVersion: 1,
            rate: 1,
            voice: "espeak",
            current: word.book,
          },
          "app",
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    {
      records: [
        record(old.manifest, old.content),
        record(newer.manifest, newer.content),
        record(custom.manifest, custom.content),
      ],
      deleted: demos[2].manifest.id,
      word,
    },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Weiterlesen", exact: true })
    .first()
    .waitFor();
  const snapshot = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("franka-v2");
      r.onsuccess = () => resolve(r.result);
    });
    const all = (store) =>
      new Promise((resolve) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const result = {
      books: (await all("books")).map((b) => b.manifest),
      words: await all("words"),
      progress: await all("progress"),
    };
    db.close();
    return result;
  });
  assert.equal(
    snapshot.books.find((b) => b.id === old.manifest.id).revision,
    2,
  );
  assert.equal(
    snapshot.books.find((b) => b.id === old.manifest.id).stats.words,
    946,
  );
  assert.equal(
    snapshot.books.find((b) => b.id === newer.manifest.id).revision,
    8,
  );
  assert.equal(
    snapshot.books.find((b) => b.id === newer.manifest.id).title,
    "Eigene Ausgabe",
  );
  assert.equal(
    snapshot.books.find((b) => b.id === custom.manifest.id).revision,
    1,
  );
  assert.ok(
    !snapshot.books.some((b) => b.id === demos[2].manifest.id),
    "Deleted demo must not reappear",
  );
  assert.deepEqual(
    snapshot.words,
    [word],
    "Saved words and Anki marks survive the update",
  );
  assert.equal(
    snapshot.progress.find((p) => p.book === old.manifest.id).at,
    "1.3",
  );
  assert.equal(
    snapshot.progress.find((p) => p.book === old.manifest.id).percent,
    7,
  );
  const prefs = await page.evaluate(async () => {
    const d = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    return new Promise((r) => {
      const q = d.transaction("settings").objectStore("settings").get("app");
      q.onsuccess = () => r(q.result);
    });
  });
  assert.equal(prefs.language, "de");
  assert.equal(prefs.font, "Golos Text");
  assert.equal(prefs.pageTurn, "scroll");
  assert.equal(prefs.showClean, true);
  await page
    .getByRole("button", { name: "Weiterlesen", exact: true })
    .first()
    .click();
  await page.locator(".books-reader[data-ready=true]").waitFor();
  assert.match(page.url(), /1\.3\/frank$/);
  assert.equal(await page.locator(".folio-fragment").count(), 30);
  assert.ok(await page.locator(".scroll-reader").count());
  await page.reload();
  await page.locator(".books-reader[data-ready=true]").waitFor();
  assert.match(page.url(), /1\.3\/frank$/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: expanded demos in all formats; revision upgrade preserves bookmarks, words, preferences, deleted books and newer editions",
  );
} finally {
  await browser.close();
  server.close();
}
