import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import assert from "node:assert/strict";
const files = unzipSync(
  await readFile("books/die-bremer-stadtmusikanten-demo.fbook"),
);
const content = JSON.parse(strFromU8(files["book.json"])),
  manifest = JSON.parse(strFromU8(files["manifest.json"]));
const first = content.c[0][0],
  translation = content.t[0][0];
const long = Array.from({ length: 14 }, (_, i) =>
  i ? [" ", ...first] : first,
).flat();
content.c = [
  [long, first],
  [first, long],
];
content.t = [
  [Array.from({ length: 14 }, () => translation).flat(), translation],
  [translation, Array.from({ length: 14 }, () => translation).flat()],
];
manifest.id = "abbaabba-1234-4567-8abc-123456789abc";
manifest.title = "Das Lesebuch";
manifest.chapters = [
  ["Erstes Kapitel", 2],
  ["Zweites Kapitel", 2],
];
manifest.stats = {
  fragments: 4,
  words: content.c.flat().reduce(
    (n, chunks) =>
      n +
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
  mimetype: [files.mimetype, { level: 0 }],
  "manifest.json": strToU8(JSON.stringify(manifest)),
  "book.json": strToU8(JSON.stringify(content)),
});
const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/german-frank-read/`;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/pages", { recursive: true });
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      colorScheme: "dark",
      hasTouch: true,
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGEERROR", error.message);
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .waitFor();
  assert.equal(await page.locator(".library-sidebar").count(), 1);
  assert.ok((await page.locator(".book-cover").count()) >= 3);
  await page.screenshot({ path: ".test-results/pages/library-desktop.png" });
  await page.getByLabel("Поиск в библиотеке", { exact: true }).fill("Kafka");
  await page.getByRole("heading", { name: "Тексты", exact: true }).waitFor();
  assert.equal(await page.locator(".book-card").count(), 1);
  await page.getByLabel("Поиск в библиотеке", { exact: true }).fill("");
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "pages.fbook",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture),
  });
  await page
    .getByText("Книга добавлена: Das Lesebuch", { exact: true })
    .waitFor();
  await page.evaluate(
    (id) => (location.hash = `/read/${id}/1.1/frank`),
    manifest.id,
  );
  const ready = () => page.locator(".books-reader[data-ready=true]").waitFor();
  await ready();
  assert.equal(
    await page.locator(".books-reader").getAttribute("data-columns"),
    "2",
  );
  assert.equal(await page.locator(".reader-header,.reader-layout").count(), 0);
  assert.equal(
    await page
      .locator(".folio-toolbar")
      .evaluate((el) => getComputedStyle(el).opacity),
    "0",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
    true,
  );
  await page.screenshot({ path: ".test-results/pages/spread-dark.png" });
  const index = () =>
    page
      .getByRole("slider", { name: "Место в книге", exact: true })
      .inputValue()
      .then(Number);
  const bookmark = async () =>
    page.evaluate(async (id) => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("franka-v2");
        r.onsuccess = () => resolve(r.result);
      });
      return new Promise((resolve) => {
        const r = db.transaction("progress").objectStore("progress").get(id);
        r.onsuccess = () => {
          resolve(r.result);
          db.close();
        };
      });
    }, manifest.id);
  const anchorVisible = async (p) =>
    page.evaluate((p) => {
      const el = document.querySelector(
        `[data-reading-at="${p.at}"] [data-book-char="${p.offset || 0}"]`,
      );
      if (!el) return false;
      const area = document
        .querySelector(".folio-viewport")
        .getBoundingClientRect();
      return [...el.getClientRects()].some(
        (r) =>
          r.left >= area.left - 2 &&
          r.left < area.right &&
          r.top >= area.top - 2 &&
          r.bottom <= area.bottom + 2,
      );
    }, p);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector(".folio-slider input").value === "1",
  );
  await page.waitForTimeout(150);
  const saved = await bookmark();
  assert.equal(saved.at, "1.1", "A page turn stays inside a long excerpt");
  assert.ok(
    saved.offset > 0,
    "Position includes the character within the excerpt",
  );
  assert.ok(await anchorVisible(saved));
  await page.reload();
  await ready();
  assert.equal(await index(), 1);
  assert.ok(
    await anchorVisible(saved),
    "The exact source word is on the restored spread",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator(".books-reader").getAttribute("data-columns"),
    "1",
  );
  assert.ok(
    await anchorVisible(saved),
    "Reflow keeps the source word on the visible page",
  );
  const beforeSwipe = await index();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 320, y: 420 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 120, y: 423 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForFunction(
    (n) => +document.querySelector(".folio-slider input").value === n,
    beforeSwipe + 1,
  );
  // Tap reveals controls; a double click opens the actual word dictionary.
  await page.mouse.click(195, 60);
  await page
    .getByRole("button", { name: "Параметры чтения", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Параметры чтения", exact: true })
    .waitFor();
  const fontAnchor = await bookmark();
  await page
    .getByRole("slider", { name: "Размер текста", exact: true })
    .evaluate((el) => {
      el.value = "26";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.waitForTimeout(150);
  assert.ok(
    await anchorVisible(fontAnchor),
    "Font reflow preserves the bookmarked source word",
  );
  await page.getByRole("tab", { name: "Оригинал", exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(
    await anchorVisible(fontAnchor),
    "Changing hint format preserves source position",
  );
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  const visibleWord = await page
    .locator(".folio-columns .word")
    .evaluateAll((nodes) => {
      const v = document
        .querySelector(".folio-viewport")
        .getBoundingClientRect();
      const n = nodes.find((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.left >= v.left &&
          r.right <= v.right &&
          r.top > v.top + 30 &&
          r.bottom < v.bottom - 10
        );
      });
      const r = n.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  await page.mouse.dblclick(visibleWord.x, visibleWord.y);
  await page
    .getByRole("complementary", { name: "Подсказка к слову", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "В мои слова", exact: true }).click();
  await page
    .getByRole("button", { name: "Слово сохранено", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".word-panel").count(), 0);
  // Every source word must appear on a readable page, not beyond a clipped column.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForTimeout(100);
  await page.mouse.click(720, 60);
  await page
    .getByRole("button", { name: "Параметры чтения", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "Размер текста", exact: true })
    .evaluate((el) => {
      el.value = "19";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.waitForTimeout(100);
  const count = await page
      .locator(".folio-slider input")
      .getAttribute("max")
      .then((n) => +n + 1),
    seen = new Set();
  for (let i = 0; i < count; i++) {
    await page.locator(".folio-slider input").evaluate((el, i) => {
      el.value = String(i);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, i);
    const words = await page
      .locator(".folio-columns .word")
      .evaluateAll((nodes) => {
        const v = document
          .querySelector(".folio-viewport")
          .getBoundingClientRect();
        return nodes
          .filter((n) =>
            [...n.getClientRects()].some(
              (r) =>
                r.left >= v.left - 2 &&
                r.left < v.right &&
                r.top >= v.top - 2 &&
                r.bottom <= v.bottom + 2,
            ),
          )
          .map(
            (n) =>
              n.closest("[data-reading-at]").dataset.readingAt +
              ":" +
              n.dataset.bookChar,
          );
      });
    words.forEach((word) => seen.add(word));
  }
  const all = await page
    .locator(".folio-columns .word")
    .evaluateAll((nodes) =>
      nodes.map(
        (n) =>
          n.closest("[data-reading-at]").dataset.readingAt +
          ":" +
          n.dataset.bookChar,
      ),
    );
  assert.deepEqual(
    [...seen].sort(),
    [...new Set(all)].sort(),
    "No source words are skipped between pages",
  );
  // Reflow and all available formats remain within the viewport, in either theme.
  for (const [width, height] of [
    [1876, 1312],
    [1024, 768],
    [834, 1194],
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    await page.mouse.click(width / 2, 60);
    await page
      .getByRole("button", { name: "Параметры чтения", exact: true })
      .click();
    for (const mode of ["Франк", "Паралель", "Оригинал"]) {
      await page.getByRole("tab", { name: mode, exact: true }).click();
      await page.waitForTimeout(80);
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
        true,
        `${width} ${mode} fits the window`,
      );
    }
    await page.getByLabel("Тема", { exact: true }).selectOption("light");
    await page.waitForTimeout(80);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    if (width === 390 || width === 1876)
      await page.screenshot({
        path: `.test-results/pages/reader-${width}.png`,
      });
  }
  // Exit exposes the library again and restores ordinary page scrolling.
  await page.mouse.click(160, 60);
  await page.getByRole("link", { name: "Назад", exact: true }).click();
  await page.locator(".hero").waitFor();
  assert.equal(await page.locator("html").getAttribute("class"), "");
  const contrast = await page.evaluate(() => {
    const color = (value) =>
      value
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((n) => {
          n /= 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
    const foreground = color(
      getComputedStyle(document.querySelector(".library-home h1")).color,
    );
    const background = color(
      getComputedStyle(document.querySelector(".books-shell")).backgroundColor,
    );
    return (
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)
    );
  });
  assert.ok(
    contrast >= 4.5,
    "Library headings must remain legible when returning from a light book",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".test-results/pages/library-mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  // The book controls follow the app language, and keyboard/wheel/hold remain usable.
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Язык интерфейса").selectOption("de");
  await page
    .getByRole("link", { name: "Aktuelle Lektüre", exact: true })
    .click();
  await page.getByRole("button", { name: "Weiterlesen", exact: true }).click();
  await ready();
  await page.keyboard.press("Home");
  await page.waitForTimeout(100);
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 140);
  await page.waitForFunction(
    () => document.querySelector(".folio-slider input").value === "1",
  );
  await page.mouse.click(195, 60);
  await page.getByRole("button", { name: "Leseoptionen", exact: true }).click();
  assert.deepEqual(await page.getByRole("tab").allTextContents(), [
    "Frank",
    "Parallel",
    "Original",
  ]);
  const labels = await page
    .locator(".folio-popover button,.folio-popover label")
    .allTextContents();
  assert.deepEqual(
    labels.filter((label) => /[А-Яа-яЁё]/.test(label)),
    [],
  );
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  const touchWord = await page
    .locator(".folio-columns .word")
    .evaluateAll((nodes) => {
      const area = document
        .querySelector(".folio-viewport")
        .getBoundingClientRect();
      const el = nodes.find((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.left >= area.left &&
          r.right <= area.right &&
          r.top > area.top + 30 &&
          r.bottom < area.bottom - 10
        );
      });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchWord],
  });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page
    .getByRole("complementary", { name: "Worthilfe", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await page.waitForTimeout(100);
  await page.mouse.click(195, 60);
  await page
    .getByRole("button", { name: "Buch abschließen", exact: true })
    .click();
  await page.locator(".hero").waitFor();
  assert.equal(await page.locator(".books-reader").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: library/search, default spreads, page-by-page coverage, intra-paragraph bookmarks, reload, resize, fonts, modes, touch, word lookup and mobile layouts",
  );
} finally {
  await browser.close();
  server.close();
}
