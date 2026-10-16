import { selectReadingFlow } from "./select-reading-flow.mjs";
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
  await selectReadingFlow(page);
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .waitFor();
  // Fresh profiles receive every expanded book with all three reading formats.
  for (const b of demos) {
    await page.evaluate(
      (id) => (location.hash = `/read/${id}/1.1/frank`),
      b.manifest.id,
    );
    await page
      .getByRole("heading", { name: b.manifest.title, exact: true, level: 1 })
      .waitFor();
    await page
      .getByRole("button", { name: "Сплошной текст", exact: true })
      .click();
    await page.locator(".book-flow.continuous").waitFor();
    assert.equal(
      await page.locator(".book-fragment").count(),
      b.manifest.stats.fragments,
    );
    for (const mode of ["Франк", "Паралель", "Оригинал"]) {
      await page.getByRole("tab", { name: mode, exact: true }).click();
      await page.waitForFunction(
        (mode) =>
          document.querySelector("[role=tab][aria-selected=true]")
            ?.textContent === mode,
        mode,
      );
      assert.equal(
        await page.locator(".book-fragment").count(),
        b.manifest.stats.fragments,
      );
    }
    await page
      .getByRole("button", { name: "По отрывкам", exact: true })
      .click();
    assert.equal(await page.locator(".book-fragment").count(), 1);
  }
  await page.evaluate(() => (location.hash = "/home"));
  await page.locator(".hero").waitFor();
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
  await page.getByRole("button", { name: "Weiterlesen", exact: true }).click();
  await page.locator(".book-flow.continuous").waitFor();
  assert.match(page.url(), /1\.3\/frank$/);
  assert.equal(await page.locator(".book-fragment").count(), 30);
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Text ohne Hilfen", exact: true })
      .isChecked(),
    true,
  );
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--size")
        .trim(),
    ),
    "24px",
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  // Reloading an already upgraded profile does not reset its bookmark.
  await page.reload();
  await page.locator(".continuous").waitFor();
  assert.match(page.url(), /1\.3\/frank$/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: expanded demos in both views and all formats; revision upgrade preserves bookmarks, words, preferences, deleted books and newer editions",
  );
} finally {
  await browser.close();
  server.close();
}
