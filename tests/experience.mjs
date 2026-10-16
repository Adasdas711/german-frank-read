import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import assert from "node:assert/strict";
const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/german-frank-read/`;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/experience", { recursive: true });
const errors = [],
  requests = [];
async function db(page, fn, args) {
  return page.evaluate(
    async ({ source, args }) => {
      const d = await new Promise((resolve, reject) => {
        const r = indexedDB.open("franka-v2");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return await new Function("d", "args", `return (${source})(d,args)`)(
        d,
        args,
      );
    },
    { source: fn.toString(), args },
  );
}
const value = (page, store, key) =>
  db(
    page,
    (d, [store, key]) =>
      new Promise((r) => {
        const q = d.transaction(store).objectStore(store).get(key);
        q.onsuccess = () => r(q.result);
      }),
    [store, key],
  );
const all = (page, store) =>
  db(
    page,
    (d, store) =>
      new Promise((r) => {
        const q = d.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => r(q.result);
      }),
    store,
  );
const fresh = async (viewport = { width: 1440, height: 960 }) => {
  const context = await browser.newContext({
    viewport,
    colorScheme: "dark",
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith(base) &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      requests.push(r.url());
  });
  await page.goto(base);
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".pagination-probe"),
  );
  return { context, page };
};
const show = async (page) => {
  await page.keyboard.press("Escape");
  await page.mouse.click(page.viewportSize().width / 2, 60);
  await page.locator(".folio-toolbar.visible").waitFor();
};
const appearance = async (page) => {
  await show(page);
  if (page.viewportSize().width <= 700) {
    await page.locator(".mobile-reader-menu").click();
    await page
      .getByRole("button", { name: "Themes & Voice", exact: true })
      .click();
  } else
    await page
      .getByRole("button", { name: "Themes & Voice", exact: true })
      .click();
  await page.locator(".theme-grid").waitFor();
};
const openBook = async (page) => {
  await page
    .getByRole("button", { name: "Continue", exact: true })
    .first()
    .click();
  await page.locator(".books-reader[data-ready=true]").waitFor();
  await page.waitForTimeout(100);
};
const visibleWord = (page) =>
  page.locator(".folio-columns [data-book-char]").evaluateAll((nodes) => {
    const frame = document
      .querySelector(".folio-viewport")
      .getBoundingClientRect();
    return nodes
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.left >= frame.left - 1 &&
          r.right <= frame.right + 1 &&
          r.top >= frame.top - 1 &&
          r.bottom <= frame.bottom + 1
        );
      })
      .map((n) => ({
        form: n.textContent,
        at: n.closest("[data-reading-at]").dataset.readingAt,
        offset: +n.dataset.bookChar,
      }));
  });
try {
  const { context, page } = await fresh();
  assert.equal((await value(page, "settings", "app")).language, "en");
  assert.equal(await page.locator(".book-cover").count(), 5);
  await page.screenshot({ path: ".test-results/experience/home-mac.png" });
  const homeStatus = await page
    .locator(".continue-card")
    .first()
    .locator(".continue-copy>small")
    .last()
    .textContent();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  assert.equal(await page.locator(".library-sidebar").isVisible(), false);
  await page.reload();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.keyboard.press("Control+Meta+s");
  assert.equal(await page.locator(".library-sidebar").isVisible(), false);
  await page.keyboard.press("Control+Meta+s");
  await openBook(page);
  const initialPage = await page.locator(".folio-page-number").textContent();
  assert.ok(homeStatus.includes(initialPage.split(" of ")[1].split(" ")[0]));
  assert.equal(
    await page.locator(".books-reader").getAttribute("data-columns"),
    "2",
  );
  assert.equal(
    await page
      .locator(".folio-toolbar")
      .evaluate((n) => getComputedStyle(n).opacity),
    "0",
  );
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  const bookmark = (await all(page, "progress"))[0];
  assert.ok(bookmark.offset > 0 || bookmark.at !== "1.1");
  const before = await visibleWord(page);
  await page.reload();
  await page.locator(".books-reader[data-ready=true]").waitFor();
  const after = await visibleWord(page);
  assert.ok(
    after.some((w) => w.form === before[0].form && w.at === before[0].at),
  );
  await show(page);
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  assert.equal((await all(page, "progress"))[0].bookmarks.length, 1);
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  assert.equal(await page.locator(".page-entry").count(), 1);
  await page.keyboard.press("Escape");
  await show(page);
  await page.getByRole("tab", { name: "Clean", exact: true }).click();
  await page.waitForTimeout(100);
  const wordPos = await page
    .locator(".folio-columns [data-book-char]")
    .evaluateAll((nodes) => {
      const f = document
        .querySelector(".folio-viewport")
        .getBoundingClientRect();
      const n =
        nodes.find((n) => {
          const r = n.getBoundingClientRect();
          return (
            n.textContent === "Esel" &&
            r.left >= f.left &&
            r.right <= f.right &&
            r.top >= f.top &&
            r.bottom <= f.bottom
          );
        }) ||
        nodes.find((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.left >= f.left &&
            r.right <= f.right &&
            r.top >= f.top &&
            r.bottom <= f.bottom
          );
        });
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  await page.mouse.click(wordPos.x, wordPos.y);
  await page.getByLabel("Word details").waitFor();
  await page.getByRole("button", { name: "Save to My Words" }).click();
  assert.equal((await all(page, "words")).length, 1);
  assert.ok((await all(page, "words"))[0].contextTranslation);
  await page.keyboard.press("Escape");
  await appearance(page);
  assert.equal(await page.locator(".theme-tile").count(), 8);
  await page.getByRole("button", { name: "Sepia", exact: true }).click();
  assert.equal(
    await page
      .locator(".books-reader")
      .evaluate((n) => getComputedStyle(n).backgroundColor),
    "rgb(234, 217, 185)",
  );
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("button", { name: /^Font/ }).click();
  assert.equal(await page.locator(".font-list button").count(), 10);
  await page
    .locator(".font-list")
    .getByRole("button", { name: "Lora", exact: true })
    .click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByText("Bold Text", { exact: true }).click();
  await page.getByLabel("Hint size", { exact: true }).evaluate((n) => {
    n.value = "1";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal((await value(page, "settings", "app")).font, "Lora");
  assert.equal((await value(page, "settings", "app")).bold, true);
  await page.getByRole("button", { name: "Page turning", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Fast Fade" }).click();
  assert.equal((await value(page, "settings", "app")).pageTurn, "fade");
  await page.getByRole("button", { name: "Page turning", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Curl", exact: true }).click();
  assert.equal((await value(page, "settings", "app")).pageTurn, "curl");
  await page.getByRole("button", { name: "Page turning", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "Scroll", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page
    .locator(".folio-viewport")
    .evaluate((n) => (n.scrollTop = n.clientHeight * 1.5));
  await page.waitForTimeout(200);
  assert.ok(
    (await page.locator(".folio-viewport").evaluate((n) => n.scrollTop)) > 100,
  );
  await page.screenshot({ path: ".test-results/experience/scroll.png" });
  await appearance(page);
  await page.getByRole("button", { name: "Page turning", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Slide", exact: true }).click();
  await page.keyboard.press("Escape");
  await show(page);
  await page.getByRole("tab", { name: "Parallel", exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator(".books-reader").getAttribute("data-columns"),
    "1",
  );
  assert.equal(await page.locator(".folio-columns .eyebrow").count(), 0);
  await page.screenshot({ path: ".test-results/experience/parallel-mac.png" });
  await show(page);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page
    .locator(".library-sidebar")
    .getByRole("button", { name: "All words", exact: true })
    .click();
  await page.getByRole("heading", { name: "All words", exact: true }).waitFor();
  assert.equal(await page.locator(".word-row").count(), 1);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.keyboard.press("Meta+a");
  assert.equal(await page.locator(".word-row input:checked").count(), 1);
  await page
    .locator(".selection-bar")
    .getByRole("button", { name: "To Anki" })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download Anki file/ }).click();
  const dl = await downloadPromise;
  const exported = await readFile(await dl.path(), "utf8");
  assert.match(exported, /#guid column:5/);
  assert.match(exported, /#deck column:4/);
  assert.ok((await all(page, "words"))[0].inAnki);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .locator(".library-sidebar")
    .getByRole("button", { name: "Export to Anki" })
    .click();
  assert.equal(
    await page.getByRole("button", { name: /Download Anki file/ }).isEnabled(),
    false,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .locator(".library-sidebar")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await page.getByLabel("Search your library").fill("Kafka");
  assert.equal(await page.locator(".book-result").count(), 1);
  await page.getByRole("tab", { name: "Saved Words" }).click();
  const savedWord = (await all(page, "words"))[0];
  await page.getByLabel("Search your library").fill(savedWord.ru);
  assert.equal(await page.locator(".saved-result").count(), 1);
  assert.ok(await page.locator(".saved-result mark").count());
  await page.getByRole("tab", { name: "In Text" }).click();
  await page.getByLabel("Search your library").fill("Esel");
  assert.ok(await page.locator(".text-hit").count());
  assert.ok(await page.locator(".text-hit mark").count());
  await page
    .getByRole("button", { name: /Show all/ })
    .first()
    .click();
  assert.ok((await page.locator(".text-hit").count()) > 3);
  await page.waitForTimeout(850);
  assert.equal(
    (await value(page, "settings", "app")).recentSearches[0],
    "Esel",
  );
  await page.locator(".text-hit").first().click();
  await page.locator(".books-reader[data-ready=true]").waitFor();
  assert.ok((await visibleWord(page)).some((w) => w.form === "Esel"));
  await show(page);
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByLabel("Search Book").fill("Esel");
  assert.ok(await page.locator(".page-entry").count());
  await page.screenshot({ path: ".test-results/experience/book-search.png" });
  await page.keyboard.press("Escape");
  await show(page);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page
    .locator(".library-sidebar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: /^Language/ }).click();
  await page.getByRole("button", { name: "Русский Russian" }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "ru");
  await page.getByRole("button", { name: "Deutsch German" }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const backupPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Back Up/ }).click();
  const backup = await backupPromise;
  const backupBytes = await readFile(await backup.path());
  assert.ok(unzipSync(backupBytes)["backup.json"]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  // A staged import must validate before writing. Reject invalid extensions and duplicates.
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bad"),
  });
  await page.getByText("Choose an .fbook file.", { exact: true }).waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const raw = unzipSync(
      await readFile("books/die-bremer-stadtmusikanten-demo.fbook"),
    ),
    m = JSON.parse(strFromU8(raw["manifest.json"]));
  m.id = "ccddeeff-1234-4567-8abc-123456789abc";
  m.title = "Das neue Buch";
  raw["manifest.json"] = strToU8(JSON.stringify(m));
  const newBook = zipSync({ ...raw, mimetype: [raw.mimetype, { level: 0 }] });
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "new.fbook",
    mimeType: "application/zip",
    buffer: Buffer.from(newBook),
  });
  await page.getByRole("button", { name: "Add to Library" }).waitFor();
  assert.equal((await all(page, "books")).length, 3);
  await page.getByRole("button", { name: "Add to Library" }).click();
  await page.getByText("Book added", { exact: true }).waitFor();
  assert.equal((await all(page, "books")).length, 4);
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "new.fbook",
    mimeType: "application/zip",
    buffer: Buffer.from(newBook),
  });
  await page.getByText("Already in your library", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Add to Library" }).isEnabled(),
    false,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  // Restore into another installation and preserve word flags and source bookmarks.
  const { context: restoreContext, page: restorePage } = await fresh({
    width: 834,
    height: 1194,
  });
  await restorePage
    .locator('input[type=file][accept=".json,.zip"]')
    .setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: backupBytes,
    });
  await restorePage
    .getByRole("dialog", { name: "Restore backup?" })
    .getByRole("button", { name: "Done" })
    .click();
  await restorePage.getByText("Restore complete", { exact: true }).waitFor();
  assert.equal((await all(restorePage, "words")).length, 1);
  assert.equal((await all(restorePage, "progress"))[0].bookmarks.length, 1);
  await restorePage
    .locator(".bottom-nav")
    .getByRole("button", { name: "Words", exact: true })
    .click();
  await restorePage
    .getByRole("button", { name: "Select", exact: true })
    .click();
  await restorePage
    .locator(".selection-bar")
    .getByRole("button", { name: "Select All", exact: true })
    .click();
  await restorePage.keyboard.press("Delete");
  await restorePage
    .getByRole("dialog", { name: "Delete selected words?" })
    .getByRole("button", { name: "Done" })
    .click();
  assert.equal((await all(restorePage, "words")).length, 0);
  await restorePage.locator(".mobile-settings").click();
  await restorePage
    .getByRole("button", { name: "Erase All Data", exact: true })
    .click();
  await restorePage
    .getByRole("dialog", { name: "Erase all local data?" })
    .getByRole("button", { name: "Done" })
    .click();
  assert.equal((await all(restorePage, "books")).length, 0);
  await restorePage.reload();
  await restorePage
    .getByRole("heading", { name: "Home", exact: true })
    .waitFor();
  assert.equal((await all(restorePage, "books")).length, 0);
  await restoreContext.close();
  await context.close();
  // Device layouts, mode controls and theme sheets at both orientations.
  for (const [name, width, height] of [
    ["phone", 390, 844],
    ["small", 320, 720],
    ["ipad", 834, 1194],
    ["mac", 1440, 960],
  ]) {
    const { context, page } = await fresh({ width, height });
    await page.screenshot({
      path: `.test-results/experience/home-${name}.png`,
    });
    assert.equal(await page.locator(".bottom-nav").isVisible(), width <= 1100);
    assert.equal(
      await page.locator(".library-sidebar").isVisible(),
      width > 1100,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await openBook(page);
    await page.screenshot({
      path: `.test-results/experience/reader-${name}.png`,
    });
    await appearance(page);
    await page.screenshot({
      path: `.test-results/experience/themes-${name}.png`,
    });
    assert.ok(await page.locator(".theme-grid").isVisible());
    if (width <= 700) {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await show(page);
      await page.locator(".mobile-reader-menu").click();
      await page
        .getByRole("tab", { name: "Clean", exact: true })
        .last()
        .click();
      await page.keyboard.press("Escape");
      await page.waitForURL(/clean$/);
      const result = await page.waitForFunction(() => {
        if (!document.querySelector('.books-reader[data-mode="clean"]'))
          return null;
        const frame = document
          .querySelector(".folio-viewport")
          ?.getBoundingClientRect();
        if (!frame) return null;
        const word = [
          ...document.querySelectorAll(".folio-columns [data-book-char]"),
        ].find((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.left >= frame.left - 1 &&
            r.right <= frame.right + 1 &&
            r.top >= frame.top - 1 &&
            r.bottom <= frame.bottom + 1
          );
        });
        return word
          ? {
              at: word.closest("[data-reading-at]").dataset.readingAt,
              offset: +word.dataset.bookChar,
            }
          : null;
      });
      const w = await result.jsonValue();
      await page
        .locator(
          `.folio-columns [data-reading-at="${w.at}"] [data-book-char="${w.offset}"]`,
        )
        .first()
        .click();
      await page.getByLabel("Word details").waitFor();
    }
    await context.close();
  }
  const motion = await fresh({ width: 1440, height: 960 });
  await motion.page.emulateMedia({ reducedMotion: "no-preference" });
  await openBook(motion.page);
  await appearance(motion.page);
  await motion.page
    .getByRole("button", { name: "Page turning", exact: true })
    .click();
  await motion.page
    .getByRole("menuitemradio", { name: "Curl", exact: true })
    .click();
  await motion.page.keyboard.press("Escape");
  await motion.page.keyboard.press("ArrowRight");
  await motion.page.waitForTimeout(60);
  assert.equal(await motion.page.locator(".curl-leaf").count(), 1);
  await motion.page.waitForTimeout(520);
  assert.equal(await motion.page.locator(".curl-leaf").count(), 0);
  await motion.context.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Books v2: library, real pages, bookmarks, lookup, themes, scroll, search, Anki, import, backup, localization and 4 layouts passed. No runtime network requests.",
  );
} finally {
  await browser.close();
  server.close();
}
