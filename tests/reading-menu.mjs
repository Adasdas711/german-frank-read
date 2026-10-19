import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
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
await mkdir(".test-results/reading-menu", { recursive: true });
async function state(p) {
  return p.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    const all = (s) =>
      new Promise((r) => {
        const q = db.transaction(s).objectStore(s).getAll();
        q.onsuccess = () => r(q.result);
      });
    const books = await all("books"),
      words = await all("words"),
      progress = await all("progress");
    const q = db
      .transaction("settings")
      .objectStore("settings")
      .get("collections");
    const collections = await new Promise(
      (r) => (q.onsuccess = () => r(q.result)),
    );
    db.close();
    return {
      books: books.map((b) => ({
        manifest: b.manifest,
        length: b.bytes.length,
      })),
      words,
      progress,
      collections,
    };
  });
}
try {
  for (const width of [1440, 834, 390, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 960 },
        hasTouch: width < 1000,
        reducedMotion: "reduce",
      }),
      p = await context.newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const id = await p.evaluate(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("franka-v2");
        q.onsuccess = () => r(q.result);
      });
      const books = await new Promise((r) => {
        const q = db.transaction("books").objectStore("books").getAll();
        q.onsuccess = () => r(q.result);
      });
      await new Promise((r) => {
        const tx = db.transaction(
          ["settings", "progress", "words"],
          "readwrite",
        );
        for (const b of books)
          tx.objectStore("progress").put(
            {
              book: b.manifest.id,
              at: "1.1",
              percent: 10,
              mode: "frank",
              updatedAt: new Date().toISOString(),
            },
            b.manifest.id,
          );
        tx.objectStore("settings").put(
          ["one", "two"].map((id) => ({
            id,
            name: id,
            bookIds: [books[0].manifest.id],
            updatedAt: new Date().toISOString(),
          })),
          "collections",
        );
        tx.objectStore("words").put(
          {
            key: "test",
            book: books[0].manifest.id,
            at: "1.1",
            lemma: "Wort",
            form: "Wort",
            ru: "слово",
            ipa: "vɔrt",
            context: "Ein Wort.",
            savedAt: new Date().toISOString(),
            inAnki: false,
          },
          "test",
        );
        tx.oncomplete = r;
      });
      db.close();
      return books[0].manifest.id;
    });
    await p.reload();
    await p.locator(".continue-card").nth(3).waitFor();
    const shelf = p.getByRole("region", { name: "Reading", exact: true });
    const layout = await shelf.evaluate((n) => ({
      width: n.clientWidth,
      scroll: n.scrollWidth,
      tops: [...n.children].map((c) => c.getBoundingClientRect().top),
      details: [...n.children].map((c) =>
        [
          ".book-cover",
          ".continue-meta",
          ".continue-copy h3",
          ".continue-copy p",
        ].every((s) => getComputedStyle(c.querySelector(s)).display !== "none"),
      ),
    }));
    assert.equal(new Set(layout.tops).size, 1, "all books on one row");
    assert.ok(layout.scroll > layout.width);
    assert.ok(
      layout.details.every(Boolean),
      "every book shows cover, level, title and author",
    );
    const box = await shelf.boundingBox();
    await p.mouse.move(box.x + 30, box.y + 30);
    await p.mouse.wheel(0, 500);
    await p.waitForTimeout(250);
    assert.ok(
      await shelf.evaluate((n) => n.scrollLeft > 0),
      "vertical mouse wheel scrolls shelf horizontally",
    );
    await shelf.evaluate((n) => (n.scrollLeft = 0));
    await shelf.focus();
    await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(100);
    assert.ok(
      await shelf.evaluate((n) => n.scrollLeft > 0),
      "keyboard moves shelf",
    );
    await shelf.evaluate((n) => (n.scrollLeft = 0));
    await p.waitForTimeout(100);
    if (width === 390) {
      const client = await context.newCDPSession(p);
      const startX = box.x + box.width * 0.85,
        endX = box.x + box.width * 0.15,
        y = box.y + 40;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: startX, y }],
      });
      for (let i = 1; i <= 10; i++) {
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: startX + ((endX - startX) * i) / 10, y }],
        });
        await p.waitForTimeout(18);
      }
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await p.waitForTimeout(250);
      assert.ok(
        await shelf.evaluate((n) => n.scrollLeft > 0),
        "native touch swipe moves Reading row",
      );
      const settle = () =>
        shelf.evaluate(
          (n) =>
            new Promise((resolve) => {
              let previous = n.scrollLeft,
                stable = 0;
              const frame = () => {
                const value = n.scrollLeft;
                stable = Math.abs(value - previous) < 0.1 ? stable + 1 : 0;
                previous = value;
                if (stable >= 12) resolve();
                else requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            }),
        );
      await settle();
      await shelf.evaluate((n) => (n.scrollLeft = 0));
      await settle();
      await client.detach();
    }
    const card = p.locator(".continue-card").first();
    const r = await card.boundingBox();
    const point = { x: r.x + 25, y: r.y + 25 };
    await p.mouse.click(point.x, point.y, { button: "right" });
    const menu = p.getByRole("menu", { name: "Book options", exact: true });
    await menu.waitFor();
    const m = await menu.boundingBox();
    assert.ok(
      m.x >= 0 && m.x + m.width <= width && m.y >= 0 && m.y + m.height <= 960,
    );
    assert.ok(
      (point.x + m.width > width - 8 || Math.abs(m.x - point.x) < 2) &&
        Math.abs(m.y - point.y) < 2,
      "menu starts at cursor when room allows",
    );
    assert.equal(
      await p.getByRole("dialog").count(),
      0,
      "right click opens compact menu, not details sheet",
    );
    for (const name of [
      "Share",
      "Want to Read",
      "Add to Collection",
      "Mark as Finished",
      "Rename…",
      "Remove from Continue",
      "Remove…",
    ])
      assert.equal(
        await menu.getByRole("menuitem", { name, exact: true }).count(),
        1,
      );
    await p.screenshot({
      path: `.test-results/reading-menu/menu-${width}.png`,
    });
    await p.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    if (width === 1440) {
      await p
        .locator(".library-sidebar")
        .getByRole("button", { name: "All Books", exact: true })
        .click();
      const book = p.locator(`.shelf-book[data-book="${id}"]`);
      await book.click({ button: "right" });
      const download = p.waitForEvent("download");
      await menu
        .getByRole("menuitem", { name: "Export .fbook file", exact: true })
        .click();
      assert.ok((await download).suggestedFilename().endsWith(".fbook"));
      await book.click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "Book words to Anki", exact: true })
        .click();
      await p.getByRole("dialog").waitFor();
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await book.click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "Move to Collection", exact: true })
        .click();
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await p.locator("[data-collection=one] .sidebar-item").click();
      const before = await state(p);
      await book.click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "Remove from Collection", exact: true })
        .click();
      await book.waitFor({ state: "detached" });
      const after = await state(p);
      assert.deepEqual(after.books, before.books);
      assert.deepEqual(after.words, before.words);
      assert.deepEqual(after.progress, before.progress);
      assert.equal(
        after.collections.find((c) => c.id === "one").bookIds.length,
        0,
      );
      assert.ok(
        after.collections.find((c) => c.id === "two").bookIds.includes(id),
        "other folder preserved",
      );
      await p.locator("[data-collection=two] .sidebar-item").click();
      await book.click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "Remove from Library", exact: true })
        .click();
      await p
        .getByRole("dialog", { name: "Remove book?", exact: true })
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.equal((await state(p)).books.length, 4);
    }
    console.log(
      `${width}px: single scrollable Reading row, complete book cards and cursor menu passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
