import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

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
await mkdir(".test-results/touch-library", { recursive: true });
try {
  for (const width of process.env.TOUCH_WIDTHS
    ? process.env.TOUCH_WIDTHS.split(",").map(Number)
    : [390, 834, 1366]) {
    const context = await browser.newContext({
      viewport: { width, height: 1024 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    assert.equal(
      await p.locator(".pagination-probe,[data-book-char]").count(),
      0,
      "browsing must not render or paginate any book text",
    );
    const id = await p.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("franka-v2");
        r.onsuccess = () => resolve(r.result);
      });
      const books = await new Promise((resolve) => {
        const r = db.transaction("books").objectStore("books").getAll();
        r.onsuccess = () => resolve(r.result);
      });
      const book = books.find((b) => b.manifest.title === "Die Verwandlung");
      await new Promise((resolve) => {
        const tx = db.transaction(["settings", "words"], "readwrite");
        tx.objectStore("settings").put(
          [
            {
              id: "test-collection",
              name: "Favorites",
              bookIds: [book.manifest.id],
              updatedAt: new Date().toISOString(),
            },
          ],
          "collections",
        );
        tx.objectStore("words").put(
          {
            key: "test-word",
            book: book.manifest.id,
            at: "1.1",
            lemma: "Gregor",
            form: "Gregor",
            ru: "Грегор",
            context: "Gregor Samsa",
            ipa: "ˈɡʁeːɡoːɐ",
            inAnki: false,
            savedAt: new Date().toISOString(),
          },
          "test-word",
        );
        tx.oncomplete = resolve;
      });
      db.close();
      return book.manifest.id;
    });
    await p.reload();
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const client = await context.newCDPSession(p);
    const touch = (type, points) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const menu = p.getByRole("menu", { name: "Book options", exact: true });
    const hold = async (target) => {
      await target.scrollIntoViewIfNeeded();
      const r = await target.boundingBox();
      const before = p.url();
      await touch("touchStart", [
        { x: r.x + r.width / 2, y: r.y + r.height / 2 },
      ]);
      await menu.waitFor({ timeout: 1800 });
      await p.waitForTimeout(240);
      await touch("touchEnd", []);
      await p.waitForTimeout(100);
      assert.equal(
        p.url(),
        before,
        "hold release must not follow the book's normal action",
      );
      assert.equal(await p.locator(".book-details-modal").count(), 0);
      assert.equal(
        await menu
          .getByRole("menuitem", { name: "Share", exact: true })
          .count(),
        1,
      );
      await p.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    };
    await p.evaluate(() => (location.hash = "/library"));
    const book = p.locator(`.shelf-book[data-book="${id}"]`);
    await hold(book.locator(".cover-open"));
    // Moving the same touch must scroll, with no delayed hold menu afterwards.
    const r = await book.boundingBox();
    await touch("touchStart", [{ x: r.x + 30, y: r.y + 60 }]);
    await touch("touchMove", [{ x: r.x + 30, y: r.y + 90 }]);
    await touch("touchEnd", []);
    await p.waitForTimeout(500);
    assert.equal(await menu.count(), 0);
    const opened = performance.now();
    await book.locator(".cover-open").tap();
    const details = p.locator(".book-details-modal");
    await details.waitFor();
    const detailsMs = Math.round(performance.now() - opened);
    assert(
      detailsMs < 1200,
      `preview should not wait for pagination (${detailsMs}ms)`,
    );
    assert.equal(
      await p.locator("[data-book-char],.pagination-probe").count(),
      0,
    );
    const bounds = await details.boundingBox();
    assert(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 1024,
    );
    if (width >= 800)
      assert(
        bounds.width >= 700,
        "tablet book preview must be larger than the old 480px sheet",
      );
    const read = details.getByRole("button", { name: "Read", exact: true });
    assert(
      await read.evaluate(
        (n) =>
          parseFloat(getComputedStyle(n).fontSize) >= 16 &&
          n.getBoundingClientRect().height >= 48,
      ),
    );
    await p.screenshot({
      path: `.test-results/touch-library/details-${width}.png`,
    });
    await details.getByRole("button", { name: "Close", exact: true }).tap();
    await details.waitFor({ state: "detached" });

    await p
      .locator('[data-collection="test-collection"] .sidebar-item')
      .evaluate((n) => n.click());
    await hold(book.locator(".cover-open"));
    await p.evaluate(() => (location.hash = "/search"));
    await p
      .getByRole("textbox", { name: "Search your library", exact: true })
      .fill("Verwandlung");
    await hold(p.locator(".search-book-cover").first());
    await p
      .getByRole("textbox", { name: "Search your library", exact: true })
      .fill("");
    await hold(p.locator(".recently-viewed-list .search-book-cover").first());
    await p
      .getByRole("textbox", { name: "Search your library", exact: true })
      .fill("Gregor");
    await p.getByRole("tab", { name: "In Text", exact: true }).tap();
    await hold(p.locator(".result-book-heading").first());
    await p.evaluate(() => (location.hash = "/words"));
    await hold(p.locator(".word-book").first());
    await p
      .getByRole("main")
      .getByRole("button", { name: "By Book", exact: true })
      .tap();
    await hold(p.locator(".word-group > header").first());

    // Use the full Kafka story, and slow the CPU on the tablet: controls must
    // remain independent of the novel's word count and activate exactly once.
    if (width === 834)
      await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await p.evaluate((id) => (location.hash = `/read/${id}/1.1/frank`), id);
    await p.locator(".books-reader[data-ready=true]").waitFor();
    const tools = p.locator(".reader-tools-button");
    const dialog = p.locator(".reading-menu");
    const timings = [];
    for (let i = 0; i < 8; i++) {
      const started = performance.now();
      await tools.tap();
      await dialog.waitFor({ timeout: 900 });
      timings.push(Math.round(performance.now() - started));
      await tools.tap();
      await dialog.waitFor({ state: "detached", timeout: 900 });
    }
    await tools.tap();
    await dialog
      .getByRole("button", { name: "Themes & Voice", exact: true })
      .tap();
    const themes = p.locator(".folio-popover.type");
    await themes.waitFor({ timeout: 900 });
    await themes.getByRole("button", { name: "Close", exact: true }).tap();
    await themes.waitFor({ state: "detached", timeout: 900 });
    await tools.tap();
    await dialog.waitFor();
    await dialog.getByRole("button").first().tap();
    const contents = p.locator(".folio-popover.contents");
    await contents.waitFor({ timeout: 900 });
    await contents.getByRole("button", { name: "Close", exact: true }).tap();
    await contents.waitFor({ state: "detached", timeout: 900 });
    // Dragging a control away before release must never activate it.
    const t = await tools.boundingBox();
    await touch("touchStart", [{ x: t.x + 20, y: t.y + 20 }]);
    await touch("touchMove", [{ x: t.x - 25, y: t.y + 20 }]);
    await touch("touchEnd", []);
    assert.equal(await dialog.count(), 0);
    await p.locator(".reader-exit").tap();
    await p.waitForURL(/#\/home$/, { timeout: 2500 });
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: hold in library/collection/search/recent/text/words; large instant preview ${detailsMs}ms; reader menu first-tap timings ${JSON.stringify(timings)}${width === 834 ? " (4x CPU slowdown)" : ""}`,
    );
    await client.detach();
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
