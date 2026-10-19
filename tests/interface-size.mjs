import { revealReader } from "./reader-helpers.mjs";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/interface-size", { recursive: true });
const setRange = async (locator, value) => {
  await locator.evaluate((node, value) => {
    node.value = String(value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await locator.page().waitForTimeout(100);
  await locator.scrollIntoViewIfNeeded();
};
const bounded = async (locator, width, height) => {
  const r = await locator.boundingBox();
  assert(
    r &&
      r.x >= -1 &&
      r.y >= -1 &&
      r.x + r.width <= width + 1 &&
      r.y + r.height <= height + 1,
    `${await locator.getAttribute("class")} must fit ${width}x${height}: ${JSON.stringify(r)}`,
  );
};
const fontSize = (locator) =>
  locator.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
try {
  for (const width of [320, 390, 834, 1440]) {
    const height = width < 700 ? 844 : 1024;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 1000,
      reducedMotion: "reduce",
    });
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const heading = p.locator(".library-heading h1");
    const largeHeading = await fontSize(heading);
    const id = await p
      .locator(".continue-card")
      .first()
      .getAttribute("data-book");
    for (const route of ["library", "words", "search", "home"]) {
      await p.evaluate((route) => (location.hash = "/" + route), route);
      await p.waitForTimeout(80);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${width}: no horizontal overflow in ${route}`,
      );
    }
    await p.evaluate((id) => (location.hash = `/read/${id}/1.1/frank`), id);
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await revealReader(p);
    const tools = p.locator(".reader-tools-button");
    const text = p.locator(".folio-columns");
    const bookFont = await fontSize(text);
    const bookArea = await p.locator(".folio-viewport").boundingBox();
    assert(
      Math.abs((await fontSize(p.locator(".books-reader"))) - 14 * 1.08) < 0.1,
      "reader interface must not inherit the larger library font",
    );
    assert(
      Math.abs(
        (await tools.evaluate((n) => n.getBoundingClientRect().width)) -
          52 * 1.08,
      ) < 0.1,
      "reader default 100% includes the 8% increase",
    );
    await tools.click();
    await p
      .locator(".reading-menu")
      .getByRole("button", { name: "Themes", exact: true })
      .click();
    const panel = p.locator(".folio-popover.type");
    await bounded(panel, width, height);
    const readerRange = panel.getByRole("slider", {
      name: "Reading controls",
      exact: true,
    });
    assert.equal(await readerRange.inputValue(), "100");
    await p.screenshot({
      path: `.test-results/interface-size/reader-${width}.png`,
    });
    for (const value of [100, 160, 80]) {
      await setRange(readerRange, value);
      assert(
        Math.abs(
          (await tools.evaluate((n) => n.getBoundingClientRect().width)) -
            (52 * 1.08 * value) / 100,
        ) < 0.1,
      );
      assert.equal(
        await fontSize(text),
        bookFont,
        "interface scaling must not change the book font",
      );
      assert.deepEqual(
        await p.locator(".folio-viewport").boundingBox(),
        bookArea,
        "interface scaling must not resize the book viewport",
      );
      await bounded(panel, width, height);
      assert.equal(
        await tools.isVisible(),
        false,
        "the tools button stays hidden while a panel is open",
      );
      await panel
        .getByRole("button", { name: "Page turning", exact: true })
        .click();
      await bounded(
        panel.getByRole("menu", { name: "Page turning", exact: true }),
        width,
        height,
      );
      await panel
        .getByRole("menuitemradio", { name: "Slide", exact: true })
        .click();
    }
    assert.equal(
      await panel
        .getByRole("button", { name: "Reset interface size", exact: true })
        .count(),
      0,
    );
    await setRange(readerRange, 100);
    assert.equal(await readerRange.inputValue(), "100");
    await p.keyboard.press("Escape");
    await revealReader(p);
    await p.locator(".reader-exit").click();
    await heading.waitFor();
    await p
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click();
    const settings = p.getByRole("dialog", { name: "Settings", exact: true });
    const appRange = settings.getByRole("slider", {
      name: "App interface",
      exact: true,
    });
    assert.equal(await appRange.inputValue(), "100");
    assert.equal(
      await settings
        .getByRole("slider", { name: "Reading controls", exact: true })
        .inputValue(),
      "100",
    );
    await setRange(appRange, 80);
    assert(
      Math.abs(largeHeading / (await fontSize(heading)) - 1.25) < 0.01,
      "app default 100% includes the 25% increase",
    );
    for (const value of [80, 160, 150]) {
      await setRange(appRange, value);
      await bounded(settings, width, height);
      await bounded(appRange, width, height);
    }
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await p.reload();
    await heading.waitFor();
    await p
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click();
    assert.equal(
      await appRange.inputValue(),
      "150",
      "custom scale survives reload",
    );
    assert.equal(
      await settings
        .getByRole("button", { name: "Reset interface size", exact: true })
        .count(),
      0,
    );
    await setRange(appRange, 100);
    assert.equal(await appRange.inputValue(), "100");
    await p.screenshot({
      path: `.test-results/interface-size/settings-${width}.png`,
    });
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await p.evaluate(() => (location.hash = "/library"));
    await p.locator(".cover-open").first().click();
    await bounded(p.locator(".book-details-modal"), width, height);
    await p.screenshot({
      path: `.test-results/interface-size/details-${width}.png`,
    });
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: app and reader 100% (new baseline); independent sizes 80–160%, unchanged book font, persistence and manual return to 100% passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
