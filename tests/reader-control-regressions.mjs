import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { revealReader } from "./reader-helpers.mjs";

const html = await readFile("index.html");
const server = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const touch of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: touch,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      process.env.TEST_READER_URL ||
        `http://127.0.0.1:${server.address().port}`,
    );
    await page.locator(".continue-open").first().click();
    await page.locator(".books-reader[data-ready=true]").waitFor();
    await revealReader(page, touch);
    const activate = (locator) => (touch ? locator.tap() : locator.click());
    await activate(page.locator(".reader-tools-button"));
    const menu = page.locator(".reading-menu");
    await menu.waitFor();
    await menu.evaluate((node) =>
      Promise.all(node.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    const row = menu.locator(".contents-progress");
    const cdp = await context.newCDPSession(page);
    const pointer = async (type, x, y) => {
      if (touch)
        await cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: type === "touchEnd" ? [] : [{ x, y }],
        });
      else if (type === "touchStart") {
        await page.mouse.move(x, y);
        await page.mouse.down();
      } else if (type === "touchEnd") await page.mouse.up();
      else await page.mouse.move(x, y);
    };
    for (let repeat = 0; repeat < 8; repeat++) {
      const box = await row.boundingBox();
      const right = repeat % 2 === 0;
      const start = box.x + box.width * (right ? 0.2 : 0.8);
      const end = box.x + box.width * (right ? 1 : 0);
      // Leave the top edge before the horizontal drag threshold is reached.
      await pointer("touchStart", start, box.y + 2);
      await pointer("touchMove", start + (right ? 2 : -2), box.y - 2);
      await pointer("touchMove", end, box.y - 2);
      await pointer("touchEnd", end, box.y - 2);
      await page.waitForFunction(
        ({ right }) => {
          const input = document.querySelector(".contents-progress input");
          return input && +input.value === (right ? +input.max : 0);
        },
        { right },
      );
      assert(await menu.isVisible(), "an edge drag must keep Contents usable");
    }
    await activate(menu.getByRole("button", { name: "Contents", exact: true }));
    await page.locator(".folio-popover.contents").waitFor();
    await page.keyboard.press("Escape");
    await revealReader(page, touch);
    await activate(page.locator(".reader-tools-button"));
    await activate(menu.getByRole("button", { name: "Themes", exact: true }));
    const panel = page.locator(".folio-popover.type");
    const system = panel.getByRole("button", {
      name: "Follow system appearance",
      exact: true,
    });
    await activate(panel.getByRole("button", { name: "Forest", exact: true }));
    await activate(system);
    for (const [colorScheme, name] of [
      ["dark", "Night"],
      ["light", "Paper"],
      ["dark", "Night"],
    ]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(
        (name) =>
          document
            .querySelector(`.theme-tile[aria-label="${name}"]`)
            ?.getAttribute("aria-pressed") === "true",
        name,
      );
      assert.equal(
        await panel.locator('.theme-tile[aria-pressed="true"]').count(),
        1,
      );
      assert.equal(await system.getAttribute("aria-pressed"), "true");
    }
    for (const name of ["Paper", "Night"]) {
      await activate(panel.getByRole("button", { name, exact: true }));
      assert.equal(
        await panel
          .getByRole("button", { name, exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(await system.getAttribute("aria-pressed"), "false");
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS: ${touch ? "touch" : "mouse"} repeated edge drags, Contents tap, system and explicit theme selection`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
