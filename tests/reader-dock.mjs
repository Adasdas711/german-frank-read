import { revealReader } from "./reader-helpers.mjs";
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
    ["pc", 1366, 900, false, true],
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
      await revealReader(p);
      await p.locator(".folio-toolbar.visible").waitFor();
    };
    assert.equal(
      await p
        .locator(".folio-bottom")
        .evaluate((n) => getComputedStyle(n).pointerEvents),
      "none",
      "hidden controls cannot intercept text taps",
    );
    await show();
    const toolbar = await p.locator(".folio-toolbar").boundingBox(),
      dock = await p.locator(".folio-bottom").boundingBox(),
      book = await p.locator(".folio-viewport").boundingBox();
    const exit = await p
      .getByRole("link", { name: "Exit reading", exact: true })
      .boundingBox();
    const tools = await p
      .getByRole("button", { name: "Reading tools", exact: true })
      .boundingBox();
    assert(
      exit.x > width / 2 &&
        exit.y < 80 &&
        exit.width >= 48 &&
        exit.height >= 48,
      name + " exit at top right",
    );
    assert(
      tools.x > width / 2 &&
        tools.y > height / 2 &&
        tools.width >= 48 &&
        tools.height >= 48,
      name + " single tools button at bottom right",
    );
    assert.equal(await p.locator(".folio-toolbar button").count(), 0);
    assert.ok(
      Math.abs(tools.y + tools.height / 2 - dock.y - dock.height / 2) < 1,
    );
    assert.equal(toolbar.y > height / 2, bottom, name + " toolbar location");
    assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= width);
    assert.ok(
      dock.width < 250 && dock.y + dock.height <= height && dock.x >= 0,
    );
    assert.equal(await p.locator(".folio-bottom button").count(), 0);
    assert.ok(
      Math.abs(dock.y + dock.height / 2 - toolbar.y - toolbar.height / 2) < 1,
      name + " navigation and tools share one row",
    );
    assert.match(
      (await p.locator(".folio-slider span").textContent()).trim(),
      /^\d+ of \d+$/,
    );
    assert.ok(
      Math.abs(book.y) < 1 && Math.abs(book.y + book.height - height) < 1,
      name + " text covers the full height behind the toolbar",
    );
    await p.getByLabel("Reading position", { exact: true }).click();
    await p.waitForTimeout(80);
    assert.ok(
      +(await p.locator(".folio-slider span").textContent()).match(/\d+/)[0] >
        1,
      name + " slider navigates in the shared row",
    );
    await p.screenshot({ path: `.test-results/reader-dock/${name}.png` });
    if (await p.locator(".folio-toolbar .folio-aa").isVisible())
      await p.locator(".folio-toolbar .folio-aa").click();
    else {
      await p.locator(".mobile-reader-menu").click();
      await p.getByRole("button", { name: "Themes", exact: true }).click();
    }
    const panel = await p.locator(".folio-popover.type").boundingBox();
    const setting = p.locator(".folio-popover.type .range-row").first();
    assert.ok(
      await setting.evaluate(
        (n) => parseFloat(getComputedStyle(n).fontSize) >= 12,
      ),
    );
    assert.ok(
      await p
        .locator(".theme-tile")
        .first()
        .evaluate((n) => n.getBoundingClientRect().height >= 75),
    );
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
    assert.equal(
      await p
        .getByRole("button", { name: "Finish reading", exact: true })
        .count(),
      0,
    );
    const chapters = p.locator(".chapter-entry");
    assert.equal(await chapters.count(), 10);
    for (const node of await chapters.all()) {
      assert.ok(!/^\d+\./.test(await node.locator("strong").textContent()));
      assert.equal(await node.locator("small,em").count(), 0);
      assert(
        await node
          .locator("strong")
          .evaluate((n) => parseFloat(getComputedStyle(n).fontSize) >= 18),
      );
    }
    await p.screenshot({
      path: `.test-results/reader-dock/contents-${name}.png`,
    });
    if (name === "pc") {
      await p.keyboard.press("Escape");
      await p.evaluate(() => {
        const original = Range.prototype.getClientRects;
        window.wordReads = 0;
        Range.prototype.getClientRects = function (...args) {
          if (this.startContainer.parentElement?.closest("[data-book-char]"))
            window.wordReads++;
          return original.apply(this, args);
        };
      });
      await revealReader(p);
      await p.locator(".reader-tools-button").click();
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
