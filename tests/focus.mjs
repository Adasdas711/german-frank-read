import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(4176, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/focus", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4176/german-frank-read/");
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .click();
  await page.locator(".reader-layout").waitFor();
  const book = await page.evaluate(() => location.hash.split("/")[2]);
  await page.clock.install();
  let cases = 0;
  for (const theme of ["light", "dark"]) {
    await page.evaluate(() => (location.hash = "/settings"));
    await page.getByLabel("Тема", { exact: true }).selectOption(theme);
    await page.waitForFunction(
      (t) => document.documentElement.dataset.theme === t,
      theme,
    );
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 834, height: 1194 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const [mode, label] of [
        ["frank", "Франк"],
        ["clean", "Оригинал"],
        ["parallel", "Паралель"],
      ]) {
        await page.evaluate(
          ({ book, mode }) => (location.hash = `/read/${book}/1.1/${mode}`),
          { book, mode },
        );
        await page
          .getByRole("button", { name: "Режим чтения", exact: true })
          .waitFor();
        await page.waitForFunction(
          (label) =>
            document.querySelector("[role=tab][aria-selected=true]")
              ?.textContent === label,
          label,
        );
        const text = await page
          .locator(".reading-panel p[lang=de]")
          .allTextContents();
        await page
          .getByRole("button", { name: "Режим чтения", exact: true })
          .click();
        await page
          .getByRole("main", { name: "Чтение без отвлечений", exact: true })
          .waitFor();
        await page.waitForFunction(
          () =>
            document.activeElement === document.querySelector(".focus-reader"),
        );
        assert.deepEqual(
          await page.locator(".focus-reader p[lang=de]").allTextContents(),
          text,
          "Selected reading format must be preserved",
        );
        assert.equal(
          await page
            .locator(
              ".reader-header,.reader-layout,.word-panel,.reader-info,.reader-actions",
            )
            .count(),
          0,
        );
        assert.equal(
          await page.locator(".focus-reader button").count(),
          0,
          "Text itself has no interface controls",
        );
        await page.clock.fastForward(2100);
        assert.equal(
          await page
            .locator(".focus-toolbar")
            .evaluate((e) => getComputedStyle(e).opacity),
          "0",
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        if (mode === "clean")
          await page.screenshot({
            path: `.test-results/focus/${theme}-${viewport.width}.png`,
            fullPage: true,
          });
        await page.keyboard.press("ArrowRight");
        await page.waitForURL(new RegExp(`1\\.2/${mode}$`));
        await page.locator(".focus-reader").waitFor();
        await page.waitForFunction(async (book) => {
          return new Promise((resolve, reject) => {
            const r = indexedDB.open("franka-v2", 1);
            r.onerror = () => reject(r.error);
            r.onsuccess = () => {
              const d = r.result,
                q = d.transaction("progress").objectStore("progress").get(book);
              q.onsuccess = () => {
                resolve(q.result?.at === "1.2");
                d.close();
              };
              q.onerror = () => reject(q.error);
            };
          });
        }, book);
        await page.keyboard.press("ArrowLeft");
        await page.waitForURL(new RegExp(`1\\.1/${mode}$`));
        await page.keyboard.press("Escape");
        await page.locator(".reader-header").waitFor();
        assert.equal(await page.locator(".focus-view").count(), 0);
        await page.waitForFunction(
          () =>
            document.activeElement === document.querySelector(".focus-entry"),
        );
        assert.equal(
          await page
            .getByRole("tab", { name: label, exact: true })
            .getAttribute("aria-selected"),
          "true",
        );
        cases++;
      }
    }
  }
  // Pointer reveal, automatic hiding and an explicit exit on a phone.
  await page.getByRole("button", { name: "Режим чтения", exact: true }).click();
  await page.locator(".focus-reader").waitFor();
  await page.mouse.move(10, 100);
  await page.waitForFunction(() =>
    document.querySelector(".focus-toolbar").classList.contains("is-visible"),
  );
  await page.clock.fastForward(2100);
  assert.equal(
    await page
      .locator(".focus-toolbar")
      .evaluate((e) => getComputedStyle(e).opacity),
    "0",
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 300, y: 280 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 80, y: 282 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForURL(/1\.2\/parallel$/);
  assert.equal(await page.locator(".focus-view").count(), 1);
  await page.mouse.move(12, 120);
  await page.waitForFunction(() =>
    document.querySelector(".focus-toolbar").classList.contains("is-visible"),
  );
  await page
    .getByRole("button", { name: "Выйти из режима чтения", exact: true })
    .click();
  await page.locator(".reader-header").waitFor();
  // Hidden controls remain reachable with the keyboard, including Escape while a button has focus.
  await page.getByRole("button", { name: "Режим чтения", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement === document.querySelector(".focus-reader"),
  );
  await page.clock.fastForward(2100);
  await page.keyboard.press("Tab");
  assert.ok(
    await page
      .locator(".focus-toolbar")
      .evaluate((e) => e.contains(document.activeElement)),
  );
  assert.equal(
    await page
      .locator(".focus-toolbar")
      .evaluate((e) => getComputedStyle(e).opacity),
    "1",
  );
  await page.keyboard.press("Escape");
  await page.locator(".reader-header").waitFor();
  // Completing the last fragment returns to the normal library.
  const total = await page
    .locator("#book-position")
    .getAttribute("max")
    .then((n) => Number(n) + 1);
  await page.evaluate(
    ({ book, total }) => (location.hash = `/read/${book}/1.${total}/clean`),
    { book, total },
  );
  await page
    .locator(".reader-title")
    .filter({ hasText: `отрывок ${total} из ${total}` })
    .waitFor();
  await page.getByRole("button", { name: "Режим чтения", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement === document.querySelector(".focus-reader"),
  );
  await page.keyboard.press("ArrowRight");
  await page.locator(".hero").waitFor();
  assert.equal(await page.locator(".focus-view").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${cases} reading-format/theme/viewport cases; only text at rest, arrow navigation, saved progress, Escape and focus restoration, pointer/touch reveal, swipe, keyboard-accessible controls, book completion`,
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
