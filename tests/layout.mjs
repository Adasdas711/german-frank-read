import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
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
await mkdir(".test-results/adaptive", { recursive: true });
let cases = 0;
try {
  for (const [name, width, height] of [
    ["small", 320, 720],
    ["phone", 390, 844],
    ["ipad", 834, 1194],
    ["mac", 1440, 960],
    ["tall", 1440, 1800],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      for (const route of ["home", "library", "words", "search"]) {
        await page.evaluate((route) => (location.hash = "/" + route), route);
        await page.waitForTimeout(60);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${name} ${theme} ${route}: no horizontal overflow`,
        );
        assert.ok(
          await page
            .locator("#app")
            .evaluate((n) => n.getBoundingClientRect().height >= innerHeight),
          `${name}: fills viewport`,
        );
        const colors = await page.evaluate(() => ({
          root: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
        }));
        assert.equal(colors.root, colors.body);
        cases++;
      }
    }
    await (
      width <= 1100
        ? page.locator(".mobile-settings")
        : page
            .locator(".library-sidebar")
            .getByRole("button", { name: "Settings", exact: true })
    ).click();
    await page.getByRole("dialog", { name: "Settings" }).waitFor();
    const rect = await page.getByRole("dialog").boundingBox();
    assert.ok(
      rect.x >= 0 &&
        rect.x + rect.width <= width + 1 &&
        rect.y >= 0 &&
        rect.y + rect.height <= height + 1,
    );
    await page.screenshot({
      path: `.test-results/adaptive/settings-${name}.png`,
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .click();
    for (const mode of ["frank", "clean", "parallel"]) {
      const id = await page.evaluate(async () => {
        const d = await new Promise((r) => {
          const q = indexedDB.open("franka-v2");
          q.onsuccess = () => r(q.result);
        });
        return new Promise((r) => {
          const q = d.transaction("books").objectStore("books").getAll();
          q.onsuccess = () => r(q.result[0].manifest.id);
        });
      });
      await page.evaluate(
        ({ id, mode }) => (location.hash = `/read/${id}/1.1/${mode}`),
        { id, mode },
      );
      await page.locator(".books-reader[data-ready=true]").waitFor();
      await page.waitForTimeout(60);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.equal(
        await page
          .locator(".books-reader")
          .evaluate((n) => Math.round(n.getBoundingClientRect().height)),
        height,
      );
      assert.ok(
        await page.locator(".folio-viewport").evaluate((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            r.left >= 0 &&
            r.right <= innerWidth
          );
        }),
      );
      cases++;
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    `PASS ${cases} route/theme/size and reader layout combinations, including 320px and tall windows.`,
  );
} finally {
  await browser.close();
  server.close();
}
