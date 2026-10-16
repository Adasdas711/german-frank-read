import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
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
await mkdir(".test-results/collections", { recursive: true });
const errors = [],
  requests = [];
async function snapshot(page) {
  return page.evaluate(async () => {
    const d = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    const all = (store) =>
      new Promise((r) => {
        const q = d.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => r(q.result);
      });
    const get = (key) =>
      new Promise((r) => {
        const q = d.transaction("settings").objectStore("settings").get(key);
        q.onsuccess = () => r(q.result);
      });
    const result = {
      books: await all("books"),
      collections: (await get("collections")) || [],
    };
    d.close();
    return result;
  });
}
async function fresh(viewport = { width: 1440, height: 960 }) {
  const context = await browser.newContext({
    viewport,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(base) && !/^(blob:|data:)/.test(r.url()))
      requests.push(r.url());
  });
  await page.goto(base);
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  return { context, page };
}
const close = async (page) =>
  page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
const route = async (page, path) =>
  page.evaluate((path) => (location.hash = path), path);
const show = async (page) => {
  await page.keyboard.press("Escape");
  await page.mouse.click(page.viewportSize().width / 2, 60);
  await page.locator(".folio-toolbar.visible").waitFor();
};
const contents = async (page) => {
  await show(page);
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.locator(".chapter-entry").first().waitFor();
};
const noBars = async (page) => {
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((n) => getComputedStyle(n).scrollbarWidth !== "none")
        .map((n) => n.tagName)
        .slice(0, 5),
    ),
    [],
  );
};
try {
  const { context, page } = await fresh();
  const initial = await snapshot(page);
  assert.equal(initial.books.length, 4);
  const story = initial.books.find((b) => b.manifest.title === "Immensee");
  assert.equal(story.manifest.chapters.length, 10);
  assert.equal(story.manifest.stats.words, 9484);
  await noBars(page);

  // Chapter contents come from the manifest for EVERY fbook, including old demos.
  for (const book of initial.books) {
    await route(page, `/read/${book.manifest.id}/1.1/frank`);
    await page.locator(".books-reader[data-ready=true]").waitFor();
    await contents(page);
    assert.equal(
      await page.locator(".chapter-entry").count(),
      book.manifest.chapters.length,
    );
    assert.equal(
      await page.locator(".page-entry").count(),
      book.manifest.chapters.length,
    );
    for (let i = 0; i < book.manifest.chapters.length; i++)
      assert.ok(
        (
          await page.locator(".chapter-entry strong").nth(i).textContent()
        ).includes(book.manifest.chapters[i][0]),
      );
    if (book.manifest.title === "Immensee") {
      await page.locator('.chapter-entry[data-chapter="10"]').click();
      await page.waitForFunction(() => location.hash.includes("/10.1/"));
      await page.waitForTimeout(150);
      await contents(page);
      assert.equal(
        await page
          .locator('.chapter-entry[aria-current="location"]')
          .getAttribute("data-chapter"),
        "10",
      );
      await page.screenshot({
        path: ".test-results/collections/immensee-chapters.png",
      });
    }
    await page.keyboard.press("Escape");
  }
  await route(page, "/library");
  await page.locator(".shelf-book").first().waitFor();
  async function create(name, title) {
    await page.locator(".new-collection").click();
    await page.getByLabel("Collection name", { exact: true }).fill(name);
    if (title)
      await page.getByRole("checkbox", { name: new RegExp(title) }).check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  await create("Someday", "Immensee");
  assert.equal(await page.locator(".shelf-book").count(), 1);
  await create("Reading", "Rotkäppchen");
  await create("German");
  const manage = async (name) =>
    page
      .getByRole("button", { name: `Manage collection ${name}`, exact: true })
      .click();
  await manage("German");
  await page.getByRole("button", { name: "Move Up", exact: true }).click();
  assert.deepEqual(
    (await snapshot(page)).collections.map((c) => c.name),
    ["Someday", "German", "Reading"],
  );
  await page.getByRole("button", { name: "Move Down", exact: true }).click();
  assert.deepEqual(
    (await snapshot(page)).collections.map((c) => c.name),
    ["Someday", "Reading", "German"],
  );
  await close(page);
  const ids = Object.fromEntries(
    (await snapshot(page)).collections.map((c) => [c.name, c.id]),
  );
  await page
    .locator(`[data-collection="${ids.German}"]`)
    .dragTo(page.locator(`[data-collection="${ids.Someday}"]`));
  assert.deepEqual(
    (await snapshot(page)).collections.map((c) => c.name),
    ["German", "Someday", "Reading"],
  );
  await manage("Someday");
  await page.getByLabel("Collection name", { exact: true }).fill("Next books");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Next books", exact: true })
    .waitFor();

  await page.getByRole("button", { name: "Immensee", exact: true }).click();
  await page
    .getByRole("button", { name: "Move to Collection", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reading", exact: true })
    .click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await close(page);
  let state = await snapshot(page);
  assert.ok(
    state.collections
      .find((c) => c.name === "Reading")
      .bookIds.includes(story.manifest.id),
  );
  assert.equal(
    state.collections.find((c) => c.name === "Next books").bookIds.length,
    0,
  );
  await route(page, "/library");
  await page
    .locator(".filter-tabs")
    .getByRole("tab", { name: "All", exact: true })
    .click();
  await page
    .locator(".shelf-book")
    .filter({
      has: page.getByRole("button", { name: "Immensee", exact: true }),
    })
    .dragTo(page.locator(`[data-collection="${ids.German}"]`));
  state = await snapshot(page);
  assert.ok(
    state.collections
      .find((c) => c.name === "German")
      .bookIds.includes(story.manifest.id),
  );
  assert.ok(
    !state.collections
      .find((c) => c.name === "Reading")
      .bookIds.includes(story.manifest.id),
  );

  // Delete a non-empty collection while retaining all books.
  await manage("Reading");
  await page
    .getByRole("button", { name: "Delete Collection", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete collection Reading?" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  state = await snapshot(page);
  assert.equal(state.books.length, 4);
  assert.deepEqual(
    state.collections.map((c) => c.name),
    ["German", "Next books"],
  );
  await page.reload();
  await page.locator(".collection-nav-row").first().waitFor();
  assert.deepEqual((await snapshot(page)).collections, state.collections);
  await page.screenshot({ path: ".test-results/collections/desktop.png" });

  // Collections and ordering survive a full ZIP backup and a separate installation.
  await page
    .locator(".library-sidebar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Back Up/ }).click();
  const bytes = await readFile(await (await downloading).path());
  const data = JSON.parse(strFromU8(unzipSync(bytes)["backup.json"]));
  assert.deepEqual(data.collections, state.collections);
  const { context: phoneContext, page: phone } = await fresh({
    width: 390,
    height: 844,
  });
  await phone.locator('input[type=file][accept=".json,.zip"]').setInputFiles({
    name: "backup.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await phone
    .getByRole("dialog", { name: "Restore backup?" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await phone.getByText("Restore complete", { exact: true }).waitFor();
  assert.deepEqual((await snapshot(phone)).collections, state.collections);
  await route(phone, "/library");
  await phone
    .locator(".collection-chips")
    .getByRole("button", { name: "German", exact: true })
    .click();
  assert.equal(await phone.locator(".shelf-book").count(), 1);
  await phone
    .getByRole("button", { name: "Manage Collection", exact: true })
    .click();
  await phone.getByRole("button", { name: "Move Down", exact: true }).click();
  await phone.getByLabel("Collection name", { exact: true }).fill("Deutsch");
  await phone
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await phone.getByRole("heading", { name: "Deutsch", exact: true }).waitFor();
  assert.deepEqual(
    (await snapshot(phone)).collections.map((c) => c.name),
    ["Next books", "Deutsch"],
  );
  await noBars(phone);
  await phone.screenshot({ path: ".test-results/collections/phone.png" });
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );

  await phone
    .locator(".collection-strip")
    .getByRole("button", { name: "New Collection", exact: true })
    .click();
  await phone
    .getByLabel("Collection name", { exact: true })
    .fill("Evening stories");
  await phone.getByRole("checkbox", { name: /Immensee/ }).check();
  await phone
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await phone
    .getByRole("heading", { name: "Evening stories", exact: true })
    .waitFor();
  assert.equal((await snapshot(phone)).collections.length, 3);
  for (const viewport of [
    { width: 834, height: 1194 },
    { width: 320, height: 720 },
  ]) {
    await phone.setViewportSize(viewport);
    await phone
      .getByRole("button", { name: "Manage Collection", exact: true })
      .click();
    const bounds = await phone.getByRole("dialog").boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width + 1 &&
        bounds.y + bounds.height <= viewport.height + 1,
    );
    await noBars(phone);
    await phone.screenshot({
      path: `.test-results/collections/editor-${viewport.width}.png`,
    });
    await close(phone);
  }
  await phone.setViewportSize({ width: 390, height: 844 });

  // Hiding the scrollbar must not disable vertical book scrolling.
  await phone.evaluate(async () => {
    const d = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    await new Promise((r) => {
      const tx = d.transaction("settings", "readwrite"),
        s = tx.objectStore("settings"),
        q = s.get("app");
      q.onsuccess = () => s.put({ ...q.result, pageTurn: "scroll" }, "app");
      tx.oncomplete = r;
    });
    d.close();
  });
  await phone.reload();
  await route(phone, `/read/${story.manifest.id}/1.1/clean`);
  await phone.locator(".scroll-reader[data-ready=true]").waitFor();
  await phone
    .locator(".folio-columns")
    .getByRole("button", { name: "Spätherbstnachmittage", exact: true })
    .first()
    .click();
  const word = phone.getByLabel("Word details");
  await word.waitFor();
  assert.ok((await word.textContent()).includes("однажды поздней осенью"));
  await word.getByRole("button", { name: "Close", exact: true }).click();
  await phone.locator(".folio-viewport").hover();
  await phone.mouse.wheel(0, 700);
  await phone.waitForFunction(
    () => document.querySelector(".folio-viewport").scrollTop > 100,
  );
  await noBars(phone);
  await phone.screenshot({
    path: ".test-results/collections/immensee-scroll.png",
  });

  // An oversized merged backup must fail without partially changing the database.
  await route(phone, "/library");
  await phone.evaluate(async () => {
    const d = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    await new Promise((r) => {
      const tx = d.transaction("settings", "readwrite");
      tx.objectStore("settings").put(
        Array.from({ length: 200 }, (_, i) => ({
          id: `local-${i}`,
          name: `Collection ${i}`,
          bookIds: [],
          updatedAt: "2026-01-01",
        })),
        "collections",
      );
      tx.oncomplete = r;
    });
    d.close();
  });
  await phone
    .locator('input[type=file][accept=".json,.zip"]')
    .setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await phone
    .getByRole("dialog", { name: "Restore backup?" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await phone
    .getByRole("alert")
    .filter({ hasText: "Collection limit reached" })
    .waitFor();
  assert.equal((await snapshot(phone)).collections.length, 200);
  assert.equal((await snapshot(phone)).books.length, 4);

  await close(page);
  await route(page, "/library");
  await page
    .locator(".filter-tabs")
    .getByRole("tab", { name: "All", exact: true })
    .click();
  await page.getByRole("button", { name: "Immensee", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove from Library", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Remove book?" })
    .waitFor({ state: "hidden" });
  await page.reload();
  await page.locator(".shelf-book").first().waitFor();
  assert.equal((await snapshot(page)).books.length, 3);
  assert.ok(
    (await snapshot(page)).collections.every(
      (c) => !c.bookIds.includes(story.manifest.id),
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await phoneContext.close();
  await context.close();
  console.log(
    "Collections CRUD, native drag/drop, book moves, backup, phone management, hidden scrollbars, full Immensee and chapter contents for every fbook passed.",
  );
} finally {
  await browser.close();
  server.close();
}
