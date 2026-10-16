import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import assert from "node:assert/strict";
const entries = unzipSync(
  await readFile("books/die-bremer-stadtmusikanten-demo.fbook"),
);
const content = JSON.parse(strFromU8(entries["book.json"]));
const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
const original = content.c[0],
  translation = content.t[0];
content.c = Array.from({ length: 2 }, () =>
  Array.from({ length: 30 }, (_, i) => original[i % 3]),
);
content.t = Array.from({ length: 2 }, () =>
  Array.from({ length: 30 }, (_, i) => translation[i % 3]),
);
manifest.id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
manifest.title = "Lesebuch";
manifest.chapters = [
  ["Erstes Kapitel", 30],
  ["Zweites Kapitel", 30],
];
manifest.stats = {
  fragments: 60,
  words: content.c.flat().reduce(
    (sum, chunks) =>
      sum +
      (
        chunks
          .map((c) => (typeof c === "string" ? c : c[0]))
          .join("")
          .match(/[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*/gu) || []
      ).length,
    0,
  ),
};
const fixture = zipSync({
  mimetype: [entries.mimetype, { level: 0 }],
  "manifest.json": strToU8(JSON.stringify(manifest)),
  "book.json": strToU8(JSON.stringify(content)),
});
const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((resolve) => server.listen(4178, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/book", { recursive: true });
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      colorScheme: "light",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGEERROR", error.message);
  });
  await page.goto("http://127.0.0.1:4178/german-frank-read/");
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .waitFor();
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "long.fbook",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture),
  });
  await page.getByText("Книга добавлена: Lesebuch", { exact: true }).waitFor();
  await page.evaluate(
    (id) => (location.hash = `/read/${id}/1.1/frank`),
    manifest.id,
  );
  await page.locator(".book-page").waitFor();
  assert.equal(await page.locator(".book-fragment").count(), 1);
  await page
    .getByRole("button", { name: "Сплошной текст", exact: true })
    .click();
  await page.locator(".book-flow.continuous").waitFor();
  assert.equal(await page.locator(".book-fragment").count(), 60);
  assert.deepEqual(await page.locator(".chapter-heading").allTextContents(), [
    "Erstes Kapitel",
    "Zweites Kapitel",
  ]);
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Текст без подсказок", exact: true })
      .isChecked(),
    false,
  );
  const scrollTo = async (at) =>
    page.evaluate((at) => {
      const node = document.querySelector(`[data-reading-at="${at}"]`);
      const top =
        document.querySelector(".reader-header")?.getBoundingClientRect()
          .height || 40;
      scrollTo(0, scrollY + node.getBoundingClientRect().top - top - 24);
    }, at);
  const bookmark = async (at) => {
    await page.waitForFunction((at) => location.hash.split("/")[3] === at, at);
    await page.waitForFunction(
      async ({ id, at }) => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open("franka-v2");
          r.onsuccess = () => resolve(r.result);
        });
        return new Promise((resolve) => {
          const r = db.transaction("progress").objectStore("progress").get(id);
          r.onsuccess = () => {
            resolve(r.result?.at === at);
            db.close();
          };
        });
      },
      { id: manifest.id, at },
    );
  };
  await scrollTo("2.8");
  await bookmark("2.8");
  const y = await page.evaluate(() => scrollY);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => scrollY),
    y,
    "Bookmark update must not move the text",
  );
  await page.reload();
  await page.locator(".book-flow.continuous").waitFor();
  await bookmark("2.8");
  assert.ok(
    Math.abs(
      (await page
        .locator('[data-reading-at="2.8"]')
        .evaluate(
          (el) =>
            el.getBoundingClientRect().top -
            document.querySelector(".reader-header").getBoundingClientRect()
              .height,
        )) - 24,
    ) < 3,
    "Restore scroll to the saved fragment",
  );
  await page.getByRole("button", { name: "По отрывкам", exact: true }).click();
  await page.locator(".book-flow.blocks").waitFor();
  assert.equal(await page.locator(".book-fragment").count(), 1);
  assert.equal(
    await page.locator(".book-fragment").getAttribute("data-reading-at"),
    "2.8",
  );
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page
    .getByRole("button", { name: "Сплошной текст", exact: true })
    .click();
  await page.locator(".book-flow.continuous").waitFor();
  await bookmark("2.8");
  // The slider and contents must jump within the book, without resetting to the top.
  await page.locator("#book-position").evaluate((el) => {
    el.value = "42";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await bookmark("2.13");
  await page
    .getByRole("button", { name: "Показать отрывки", exact: true })
    .click();
  await page.locator(".toc button").nth(5).click();
  await bookmark("1.6");
  await page
    .getByRole("button", { name: "Скрыть отрывки", exact: true })
    .click();
  await bookmark("1.6");
  // All formats render the same complete book, including parallel translation.
  for (const mode of ["Паралель", "Оригинал", "Франк"]) {
    await page.getByRole("tab", { name: mode, exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".book-fragment").length === 60,
    );
    await bookmark("1.6");
    if (mode === "Паралель")
      assert.ok((await page.locator(".parallel-row").count()) >= 60);
  }
  // A word belongs to the paragraph clicked, even if the reader scrolls elsewhere.
  await scrollTo("2.13");
  await bookmark("2.13");
  await page
    .locator('[data-reading-at="2.13"] .word')
    .filter({ hasText: /^Esel$/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "В мои слова", exact: true })
    .waitFor();
  await scrollTo("2.14");
  await bookmark("2.14");
  await page.getByRole("button", { name: "В мои слова", exact: true }).click();
  const saved = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("franka-v2");
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise((resolve) => {
      const r = db.transaction("words").objectStore("words").getAll();
      r.onsuccess = () => {
        resolve(r.result);
        db.close();
      };
    });
  });
  assert.equal(saved[0].at, "2.13");
  await page
    .getByRole("button", { name: "Закрыть подсказку", exact: true })
    .click();
  await page.getByRole("button", { name: "Режим чтения", exact: true }).click();
  await page.locator(".focus-reader .continuous").waitFor();
  assert.equal(await page.locator(".focus-reader .book-fragment").count(), 60);
  await scrollTo("2.19");
  await bookmark("2.19");
  await page.keyboard.press("Escape");
  await page.locator(".reader-header").waitFor();
  await bookmark("2.19");
  // Themes, language, hints and widths remain usable with a complete flowing book.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(() => (location.hash = "/settings"));
    await page.getByLabel("Тема", { exact: true }).selectOption(theme);
    await page.evaluate(
      (id) => (location.hash = `/read/${id}/2.19/frank`),
      manifest.id,
    );
    await page.locator(".continuous").waitFor();
    for (const width of [1440, 834, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await scrollTo("2.19");
      await bookmark("2.19");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `No overflow in ${theme} ${width}`,
      );
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: `.test-results/book/${theme}-${width}.png`,
        });
    }
  }
  await page.evaluate(() => (location.hash = "/settings"));
  await page.getByLabel("Язык интерфейса").selectOption("de");
  await page.getByLabel("Leseansicht").selectOption("blocks");
  await page.evaluate(
    (id) => (location.hash = `/read/${id}/2.19/frank`),
    manifest.id,
  );
  await page.locator(".book-flow.blocks").waitFor();
  await page.getByRole("button", { name: "Fortlaufend", exact: true }).click();
  await page.locator(".continuous").waitFor();
  await bookmark("2.19");
  await page.reload();
  await page.locator(".continuous").waitFor();
  await bookmark("2.19");
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: full-book flow, chapter navigation, scroll bookmarks, reload and layout restoration, word addresses, focus mode, languages, themes and mobile layouts",
  );
  await context.close();
} finally {
  await browser.close();
  server.close();
}
