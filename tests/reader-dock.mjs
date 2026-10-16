import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html"),
  server = createServer((q, s) => {
    s.setHeader("Content-Type", "text/html;charset=utf-8");
    s.end(html);
  });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/reader-dock", { recursive: true });
try {
  for (const [name, width, height, touch, bottom] of [
    ["phone", 390, 844, true, true],
    ["small", 320, 720, true, true],
    ["tablet", 834, 1194, true, true],
    ["tablet-landscape", 1366, 1024, true, true],
    ["pc", 1366, 900, false, false],
  ]) {
    const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: touch,
        colorScheme: "dark",
        reducedMotion: "reduce",
      }),
      p = await context.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await p.evaluate(
      () =>
        (location.hash =
          "/read/9b597927-66e7-4b7a-a540-ae3e0583fc22/1.1/frank"),
    );
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await p.waitForTimeout(100);
    const show = async () => {
      await p.keyboard.press("Escape");
      await p.mouse.click(width / 2, 60);
      await p.locator(".folio-toolbar.visible").waitFor();
    };
    await show();
    const toolbar = await p.locator(".folio-toolbar").boundingBox(),
      dock = await p.locator(".folio-bottom").boundingBox(),
      book = await p.locator(".folio-viewport").boundingBox();
    assert.equal(toolbar.y > height / 2, bottom, name + " toolbar location");
    assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= width);
    assert.ok(
      dock.width < 250 && dock.y + dock.height <= height && dock.x >= 0,
    );
    assert.equal(await p.locator(".folio-bottom button").count(), 0);
    assert.match(
      (await p.locator(".folio-slider span").textContent()).trim(),
      /^\d+ of \d+$/,
    );
    assert.ok(
      book.y + book.height < toolbar.y || !bottom,
      name + " reserved toolbar space",
    );
    await p.screenshot({ path: `.test-results/reader-dock/${name}.png` });
    if (await p.locator(".folio-toolbar .folio-aa").isVisible())
      await p.locator(".folio-toolbar .folio-aa").click();
    else {
      await p.locator(".mobile-reader-menu").click();
      await p
        .getByRole("button", { name: "Themes & Voice", exact: true })
        .click();
    }
    const panel = await p.locator(".folio-popover.type").boundingBox();
    assert.ok(
      panel.y >= 0 && panel.y + panel.height <= height,
      name + " settings bounds",
    );
    if (bottom)
      assert.ok(
        panel.y + panel.height <= toolbar.y + 1,
        name + " settings from bottom",
      );
    await p.keyboard.press("Escape");
    await p.keyboard.press("End");
    await show();
    if (await p.locator(".desktop-contents").isVisible())
      await p.locator(".desktop-contents").click();
    else {
      await p.locator(".mobile-reader-menu").click();
      await p.locator(".reading-menu").getByRole("button").first().click();
    }
    assert.ok(
      await p
        .getByRole("button", { name: "Finish reading", exact: true })
        .isVisible(),
    );
    if (name === "pc") {
      await p.keyboard.press("Escape");
      await p.evaluate(() => {
        const original = Element.prototype.getClientRects;
        window.wordReads = 0;
        Element.prototype.getClientRects = function (...args) {
          if (
            this.hasAttribute("data-book-char") &&
            this.closest(".books-reader:not(.pagination-probe)")
          )
            window.wordReads++;
          return original.apply(this, args);
        };
      });
      for (const [i, mode] of [
        "clean",
        "parallel",
        "frank",
        "clean",
        "parallel",
        "frank",
      ].entries()) {
        const reads = await p.evaluate(async (mode) => {
          window.wordReads = 0;
          [...document.querySelectorAll(".reader-mode-tabs button")]
            .find((b) => b.textContent.toLowerCase() === mode)
            .click();
          await new Promise((r) => {
            let n = 0;
            const tick = () => {
              if (
                document.querySelector(".books-reader").dataset.mode === mode &&
                ++n === 4
              )
                r();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return window.wordReads;
        }, mode);
        assert.ok(
          reads < (i >= 3 ? 50 : 4000),
          `${mode}: ${reads} word layout reads`,
        );
      }
      await p.evaluate(() => (location.hash = "/home"));
      await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
      await p.evaluate(() => {
        window.wordReads = 0;
        location.hash = "/read/9b597927-66e7-4b7a-a540-ae3e0583fc22/1.1/frank";
      });
      await p.locator(".books-reader[data-ready=true]").waitFor();
      await p.waitForTimeout(100);
      assert.ok(
        (await p.evaluate(() => window.wordReads)) < 50,
        "opening a measured book reuses its index",
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log("PASS compact reader dock " + name);
  }
} finally {
  await browser.close();
  server.close();
}
