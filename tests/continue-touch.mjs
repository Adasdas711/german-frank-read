import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { readBook } from "../src/core.ts";

const html = await readFile("index.html");
const server = createServer((_, response) => {
  response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/continue-touch", { recursive: true });

async function state(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("franka-v2");
      r.onsuccess = () => resolve(r.result);
    });
    const read = (name, key) =>
      new Promise((resolve) => {
        const store = db.transaction(name).objectStore(name);
        const r = key ? store.get(key) : store.getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const [books, progress, words, settings, collections] = await Promise.all([
      read("books"),
      read("progress"),
      read("words"),
      read("settings", "app"),
      read("settings", "collections"),
    ]);
    db.close();
    return {
      books: books.map((b) => ({ ...b, bytes: Array.from(b.bytes) })),
      progress,
      words,
      settings,
      collections,
    };
  });
}

try {
  for (const width of [390, 834, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const id = await page
      .locator(".continue-card")
      .first()
      .getAttribute("data-book");
    if (width === 390) {
      const ids = await page
        .locator(".continue-card")
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.book));
      await page.evaluate(async (ids) => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open("franka-v2");
          r.onsuccess = () => resolve(r.result);
        });
        await new Promise((resolve) => {
          const tx = db.transaction(["progress", "words"], "readwrite");
          ids.forEach((book, i) =>
            tx
              .objectStore("progress")
              .put(
                {
                  book,
                  at: "1.1",
                  offset: 20,
                  percent: 10 + i,
                  mode: "frank",
                  updatedAt: "2026-01-01T12:00:00Z",
                  bookmarks: [
                    {
                      at: "1.1",
                      offset: 20,
                      createdAt: "2026-01-01T12:00:00Z",
                    },
                  ],
                },
                book,
              ),
          );
          tx.objectStore("words").put(
            {
              key: "saved-test-word",
              book: ids[0],
              at: "1.1",
              lemma: "der Esel",
              form: "Esel",
              ru: "осёл",
              ipa: "ˈeːzəl",
              context: "Es hatte ein Mann einen Esel.",
              savedAt: "2026-01-01T12:00:00Z",
              inAnki: false,
            },
            "saved-test-word",
          );
          tx.oncomplete = resolve;
        });
        db.close();
      }, ids);
      await page.reload();
      await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    }
    const original = await state(page);
    const card = page.locator(`.continue-card[data-book="${id}"]`);
    const menu = page.getByRole("menu", { name: "Book options", exact: true });
    const client = await context.newCDPSession(page);
    const touch = (type, points) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const point = async () => {
      const r = await card.boundingBox();
      return { x: r.x + 42, y: r.y + r.height / 2 };
    };
    const hold = async () => {
      await touch("touchStart", [await point()]);
      await page.waitForTimeout(620);
      await menu.waitFor();
      await touch("touchEnd", []);
      await page.waitForTimeout(120);
      assert(
        !page.url().includes("#/read/"),
        "releasing a long press must not open the reader",
      );
    };

    // A native touch swipe must cancel the timer and preserve shelf scrolling.
    const shelf = page.locator(".continue-shelf");
    const rect = await shelf.boundingBox();
    const x = rect.x + Math.min(rect.width - 30, 260),
      y = rect.y + 50;
    await touch("touchStart", [{ x, y }]);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", [{ x: x - i * 20, y }]);
      await page.waitForTimeout(22);
    }
    await touch("touchEnd", []);
    await page.waitForTimeout(650);
    assert.equal(await menu.count(), 0, "swiping must not open options");
    if (width === 390)
      assert(
        await shelf.evaluate((n) => n.scrollLeft > 0),
        "touch scrolling must remain native",
      );
    await shelf.evaluate((n) => (n.scrollLeft = 0));
    await page.waitForTimeout(400);

    await hold();
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
    const bounds = await menu.boundingBox();
    assert(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 1000,
    );
    await page.screenshot({
      path: `.test-results/continue-touch/menu-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    // A second finger and navigation while held must also cancel pending menus.
    const p = await point();
    await touch("touchStart", [{ ...p, id: 1 }]);
    await touch("touchStart", [
      { ...p, id: 1 },
      { x: p.x + 30, y: p.y, id: 2 },
    ]);
    await page.waitForTimeout(620);
    await touch("touchEnd", []);
    assert.equal(await menu.count(), 0);
    await touch("touchStart", [await point()]);
    await page.evaluate(() => (location.hash = "/library"));
    await page.waitForTimeout(620);
    await touch("touchEnd", []);
    assert.equal(await menu.count(), 0);
    await page.evaluate(() => (location.hash = "/home"));
    await card.waitFor();

    if (width === 390) {
      const open = async () => {
        await card.locator(".continue-more").tap();
        await menu.waitFor();
      };
      await page.evaluate(() => {
        window.__shares = [];
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: () => true,
        });
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data) =>
            window.__shares.push({
              name: data.files[0].name,
              size: data.files[0].size,
            }),
        });
      });
      await open();
      await menu.getByRole("menuitem", { name: "Share", exact: true }).tap();
      const shares = await page.evaluate(() => window.__shares);
      assert.equal(shares.length, 1);
      assert(shares[0].name.endsWith(".fbook") && shares[0].size > 0);
      await page.evaluate(() =>
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: () => false,
        }),
      );
      await open();
      const downloaded = page.waitForEvent("download");
      await menu.getByRole("menuitem", { name: "Share", exact: true }).tap();
      assert(
        (await downloaded).suggestedFilename().endsWith(".fbook"),
        "browsers without file sharing download the book",
      );

      await open();
      await menu
        .getByRole("menuitem", { name: "Want to Read", exact: true })
        .tap();
      await page.waitForFunction(() =>
        document.querySelector('[data-collection="want-to-read"]'),
      );
      assert(
        (await state(page)).collections
          .find((c) => c.id === "want-to-read")
          .bookIds.includes(id),
      );
      await open();
      await menu
        .getByRole("menuitem", { name: "Add to Collection", exact: true })
        .tap();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "New Collection", exact: true })
        .tap();
      await page
        .getByRole("textbox", { name: "Collection name", exact: true })
        .fill("My favorites");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Done", exact: true })
        .tap();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      let current = await state(page);
      assert(
        current.collections
          .find((c) => c.name === "My favorites")
          .bookIds.includes(id),
      );
      assert(
        current.collections
          .find((c) => c.id === "want-to-read")
          .bookIds.includes(id),
        "adding a collection preserves existing memberships",
      );
      await open();
      await menu
        .getByRole("menuitem", { name: "Add to Collection", exact: true })
        .tap();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "My favorites", exact: true })
        .tap();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Add", exact: true })
        .tap();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert(
        (await state(page)).collections
          .find((c) => c.id === "want-to-read")
          .bookIds.includes(id),
      );
      await open();
      await menu
        .getByRole("menuitem", {
          name: "Remove from Want to Read",
          exact: true,
        })
        .tap();
      await menu.waitFor({ state: "detached" });
      current = await state(page);
      assert(
        !current.collections
          .find((c) => c.id === "want-to-read")
          .bookIds.includes(id),
      );
      assert(
        current.collections
          .find((c) => c.name === "My favorites")
          .bookIds.includes(id),
      );

      await open();
      await menu.getByRole("menuitem", { name: "Rename…", exact: true }).tap();
      await page
        .getByRole("textbox", { name: "Book title", exact: true })
        .fill("My renamed book");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Save", exact: true })
        .tap();
      await card
        .getByRole("heading", { name: "My renamed book", exact: true })
        .waitFor();
      current = await state(page);
      const renamed = current.books.find((b) => b.manifest.id === id);
      const old = original.books.find((b) => b.manifest.id === id);
      const oldBook = readBook(new Uint8Array(old.bytes));
      const newBook = readBook(new Uint8Array(renamed.bytes));
      assert.equal(newBook.manifest.title, "My renamed book");
      assert.equal(newBook.manifest.revision, oldBook.manifest.revision + 1);
      assert.deepEqual(newBook.content, oldBook.content);
      assert.deepEqual(current.progress, original.progress);
      assert.deepEqual(current.words, original.words);

      await open();
      await menu.getByRole("menuitem", { name: "Remove…", exact: true }).tap();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .tap();
      assert.equal((await state(page)).books.length, original.books.length);

      await open();
      await menu
        .getByRole("menuitem", { name: "Remove from Collection", exact: true })
        .tap();
      assert(
        !(await state(page)).collections
          .find((c) => c.name === "My favorites")
          .bookIds.includes(id),
      );

      await open();
      await menu
        .getByRole("menuitem", { name: "Remove from Continue", exact: true })
        .tap();
      await card.waitFor({ state: "detached" });
      current = await state(page);
      assert(current.settings.hiddenContinueBooks.includes(id));
      assert.equal(current.books.length, original.books.length);
      assert.deepEqual(current.progress, original.progress);
      await page.reload();
      await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
      assert.equal(await card.count(), 0, "Continue removal survives restart");

      await page.evaluate(() => (location.hash = "/library"));
      await page.locator(`.shelf-book[data-book="${id}"] .cover-open`).tap();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Read", exact: true })
        .tap();
      await page.waitForURL(/#\/read\//);
      await page.evaluate(() => (location.hash = "/home"));
      await card.waitFor();
      assert(!(await state(page)).settings.hiddenContinueBooks.includes(id));
      // A short tap opens the book normally, without an options menu.
      await card.locator(".continue-open").tap();
      await page.waitForURL(/#\/read\//);
      await page.evaluate(() => (location.hash = "/home"));
      await card.waitFor();
      await open();
      await menu
        .getByRole("menuitem", { name: "Mark as Finished", exact: true })
        .tap();
      await card.waitFor({ state: "detached" });
      assert.equal(
        (await state(page)).progress.find((p) => p.book === id).percent,
        100,
      );
      await page.reload();
      await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
      assert.equal(
        await card.count(),
        0,
        "Finished stays outside Continue after restart",
      );
      const other = page.locator(".continue-card").first();
      const otherId = await other.getAttribute("data-book");
      await other.locator(".continue-more").tap();
      await menu.getByRole("menuitem", { name: "Remove…", exact: true }).tap();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Done", exact: true })
        .tap();
      await page
        .locator(`.continue-card[data-book="${otherId}"]`)
        .waitFor({ state: "detached" });
      current = await state(page);
      assert(!current.books.some((b) => b.manifest.id === otherId));
      assert.equal(current.books.length, original.books.length - 1);
      assert.deepEqual(current.words, original.words);
    }
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: real touch hold, swipe, multitouch, release suppression and menu layout passed${width === 390 ? "; sharing, collections, rename, hide, finish and persistence passed" : ""}`,
    );
    await client.detach();
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
