import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html");
const server = createServer((q, s) => {
  s.setHeader("Content-Type", "text/html;charset=utf-8");
  s.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const snapshot = (p) =>
  p.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    const all = (store) =>
      new Promise((r) => {
        const q = db.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => r(q.result);
      });
    const books = await all("books"),
      progress = await all("progress"),
      words = await all("words");
    const summaries = await Promise.all(
      books.map(async (b) => ({
        manifest: b.manifest,
        hash: Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", b.bytes)),
        ).join(","),
      })),
    );
    db.close();
    return { books: summaries, progress, words };
  });
try {
  for (const width of [1440, 834, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 960 },
      }),
      p = await context.newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await p.evaluate(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("franka-v2");
        q.onsuccess = () => r(q.result);
      });
      const book = await new Promise((r) => {
        const q = db.transaction("books").objectStore("books").getAll();
        q.onsuccess = () => r(q.result[0].manifest.id);
      });
      await new Promise((r) => {
        const tx = db.transaction(["progress", "words"], "readwrite");
        tx.objectStore("progress").put(
          {
            book,
            at: "1.1",
            mode: "frank",
            percent: 10,
            updatedAt: new Date().toISOString(),
          },
          book,
        );
        tx.objectStore("words").put(
          {
            key: "test-word",
            book,
            at: "1.1",
            lemma: "Wort",
            form: "Wort",
            ru: "слово",
            ipa: "vɔrt",
            context: "Ein Wort",
            savedAt: new Date().toISOString(),
            inAnki: false,
          },
          "test-word",
        );
        tx.oncomplete = r;
      });
      db.close();
      location.hash = "/library";
    });
    await p.reload();
    await p.getByRole("tab", { name: "A2", exact: true }).click();
    const initial = await snapshot(p);
    await p.locator(".delete-library-folder").click();
    const confirm = p.getByRole("dialog", { name: "Delete folder A2?" });
    await confirm
      .getByText("The books will stay in your library.", { exact: true })
      .waitFor();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await p.getByRole("tab", { name: "A2", exact: true }).count(),
      1,
    );
    await p.locator(".delete-library-folder").click();
    await p
      .getByRole("dialog", { name: "Delete folder A2?" })
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await p.getByRole("heading", { name: "All Books", exact: true }).waitFor();
    assert.equal(
      await p.getByRole("tab", { name: "A2", exact: true }).count(),
      0,
    );
    assert.deepEqual(
      await snapshot(p),
      initial,
      "folder deletion must not mutate books, progress or words",
    );
    await p.reload();
    await p.getByRole("heading", { name: "All Books", exact: true }).waitFor();
    assert.equal(
      await p.getByRole("tab", { name: "A2", exact: true }).count(),
      0,
      "deletion persists",
    );
    for (const name of ["B1", "B2", "Finished"]) {
      await p.getByRole("tab", { name, exact: true }).click();
      await p.locator(".delete-library-folder").click();
      await p
        .getByRole("dialog", { name: `Delete folder ${name}?` })
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await p
        .getByRole("heading", { name: "All Books", exact: true })
        .waitFor();
    }
    assert.equal(
      await p.getByRole("tab").count(),
      1,
      "only All Books root remains",
    );
    assert.deepEqual(await snapshot(p), initial);
    console.log(
      `${width}px: cancel, delete all built-in folders, persistence and unchanged books/words/progress passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
