import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { revealReader, choosePageTurn } from "./reader-helpers.mjs";

const html = await readFile("index.html");
const server = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/reader-settings", { recursive: true });
try {
  for (const [width, height, motion] of [
    [390, 844, "no-preference"],
    [834, 1194, "reduce"],
    [1440, 1024, "no-preference"],
  ]) {
    if (
      process.env.TEST_SETTINGS_WIDTH &&
      width !== Number(process.env.TEST_SETTINGS_WIDTH)
    )
      continue;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      reducedMotion: motion,
    });
    const p = await context.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const id = await p
      .locator(".continue-card")
      .filter({
        has: p.getByRole("heading", { name: "Die Verwandlung", exact: true }),
      })
      .getAttribute("data-book");
    await p.evaluate((id) => (location.hash = `/read/${id}/1.1/frank`), id);
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await p.evaluate(() => document.fonts.ready);
    await revealReader(p, true);
    assert.equal(
      await p.locator(".folio-toolbar input").count(),
      0,
      "the footer contains only the page count",
    );
    assert.match(
      (await p.locator(".reader-page-count").textContent()).trim(),
      /^\d+ of \d+$/,
    );
    const tools = p.locator(".reader-tools-button"),
      menu = p.locator(".reading-menu"),
      themes = p.locator(".folio-popover.type");
    await tools.tap();
    await menu.waitFor();
    assert.equal(
      await tools.isVisible(),
      false,
      "the menu button disappears while tools are open",
    );
    const panelWidth = (n) => parseFloat(getComputedStyle(n).width);
    const menuWidth = await menu.evaluate(panelWidth);
    const alpha = (n) =>
      Number(getComputedStyle(n).backgroundColor.match(/[\d.]+/g)?.[3] ?? 1);
    assert.equal(
      await menu.evaluate(alpha),
      0,
      "the menu has no opaque backing rectangle",
    );
    const row = p.locator(".contents-progress");
    assert((await row.evaluate(alpha)) < 1, "Contents is translucent");
    const cdp = await context.newCDPSession(p);
    const box = await row.boundingBox(),
      y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width * 0.15, y }],
    });
    for (let i = 2; i <= 6; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: box.x + (box.width * i) / 10, y }],
      });
    const heldFill = await row.evaluate((n) => ({
      ratio: parseFloat(getComputedStyle(n, "::before").width) / n.clientWidth,
      buttonAlpha: Number(
        getComputedStyle(n.querySelector("button")).backgroundColor.match(
          /[\d.]+/g,
        )?.[3] ?? 1,
      ),
      dragging: n.dataset.dragging,
    }));
    assert.equal(heldFill.dragging, "true");
    assert(
      Math.abs(heldFill.ratio - 0.6) < 0.05,
      "Contents fills while the finger is still down",
    );
    assert.equal(
      heldFill.buttonAlpha,
      0,
      "the held button does not hide the fill",
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert(await menu.isVisible(), "seeking keeps the menu open");
    const progress = Number(
      await menu
        .getByRole("slider", { name: "Reading position", exact: true })
        .inputValue(),
    );
    assert(progress > 1, "dragging Contents changes the current page");
    const filled = await row.evaluate((n) => ({
      width: parseFloat(getComputedStyle(n, "::before").width),
      total: n.getBoundingClientRect().width,
    }));
    assert(
      Math.abs(filled.width / filled.total - 0.6) < 0.05,
      "progress fills the Contents row",
    );
    const contentsButton = menu.getByRole("button", {
      name: "Contents",
      exact: true,
    });
    if (width === 1440) {
      await contentsButton.focus();
      await contentsButton.press("Enter");
    } else await contentsButton.tap();
    await p.locator(".folio-popover.contents").waitFor();
    assert(
      await p
        .getByRole("navigation", { name: "Chapters", exact: true })
        .isVisible(),
      "tapping Contents opens chapters",
    );
    const contents = p.locator(".folio-popover.contents");
    assert(Math.abs((await contents.evaluate(panelWidth)) - menuWidth) < 1);
    assert.equal(await contents.evaluate(alpha), 0);
    await p.keyboard.press("Escape");
    await revealReader(p, true);
    await tools.tap();
    await menu.getByRole("button", { name: "Themes", exact: true }).tap();
    await themes.waitFor();
    await p.waitForFunction(() =>
      document
        .querySelector(".folio-popover.type")
        ?.getAnimations()
        .some((a) => a.playState === "running"),
    );
    const frames = await themes.evaluate((n) => {
      const a = n.getAnimations()[0];
      a.pause();
      a.currentTime = Number(a.effect.getTiming().duration) * 0.25;
      const start = Number(getComputedStyle(n).opacity);
      a.currentTime = Number(a.effect.getTiming().duration) * 0.75;
      const end = Number(getComputedStyle(n).opacity);
      a.play();
      return { start, end };
    });
    assert(frames.end > frames.start, "settings visibly animate into view");
    await themes.evaluate((n) =>
      Promise.all(n.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    assert.equal(
      await themes.evaluate(alpha),
      0,
      "Themes has no backing rectangle",
    );
    assert(Math.abs((await themes.evaluate(panelWidth)) - menuWidth) < 1);
    assert.equal(
      await themes.evaluate((n) => getComputedStyle(n).backdropFilter),
      "none",
    );
    assert.equal(await tools.isVisible(), false);
    await p.screenshot({
      path: `.test-results/reader-settings/themes-overlay-${width}.png`,
    });
    assert(
      await themes
        .locator(".appearance-tools")
        .evaluate((n) => getComputedStyle(n).backdropFilter.includes("blur")),
      "only individual settings controls blur the text underneath",
    );
    assert(
      await themes
        .locator(".themes-panel")
        .evaluate((n) =>
          n.lastElementChild.classList.contains("interface-size"),
        ),
      "Reading controls is the final settings section",
    );
    await p.evaluate(() => {
      window.settingsMeasures = 0;
      new MutationObserver((rs) => {
        for (const r of rs)
          for (const n of r.addedNodes)
            if (n instanceof Element && n.matches(".sentence-measure"))
              window.settingsMeasures++;
      }).observe(document.querySelector(".folio-viewport"), {
        childList: true,
      });
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (const [name, color] of [
      ["Paper", "rgb(255, 254, 249)"],
      ["Dusk", "rgb(40, 39, 45)"],
      ["Night", "rgb(8, 9, 9)"],
    ]) {
      const latency = await themes
        .getByRole("button", { name, exact: true })
        .evaluate(
          (n) =>
            new Promise((resolve) => {
              const begin = performance.now();
              n.click();
              requestAnimationFrame(() =>
                resolve({
                  ms: performance.now() - begin,
                  paper: getComputedStyle(n.closest(".books-reader"))
                    .backgroundColor,
                }),
              );
            }),
        );
      assert.equal(latency.paper, color, "the theme paints on the next frame");
      assert(
        latency.ms < 500,
        `theme response must not take seconds (${latency.ms}ms at 4x CPU)`,
      );
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    assert.equal(
      await p.evaluate(() => window.settingsMeasures),
      0,
      "color changes never repaginate the novel",
    );
    const scale = themes.getByRole("slider", {
      name: "Reading controls",
      exact: true,
    });
    await scale.scrollIntoViewIfNeeded();
    await scale.evaluate((n) => {
      n.value = "120";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert(
      await p
        .locator(".books-reader")
        .evaluate(
          (n) =>
            Math.abs(
              parseFloat(n.style.getPropertyValue("--ui-scale")) - 1.296,
            ) < 0.001,
        ),
      "interface size applies on input, without waiting for release",
    );
    await p.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await p.evaluate(() => window.settingsMeasures),
      0,
      "interface scaling never repaginates the book",
    );
    await scale.evaluate((n) => {
      n.value = "100";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await themes.getByRole("button", { name: "Customize", exact: true }).tap();
    const bold = themes.getByRole("checkbox", {
      name: "Bold Text",
      exact: true,
    });
    await bold.check();
    assert.equal(
      await p
        .locator(".folio-columns")
        .evaluate((n) => getComputedStyle(n).fontWeight),
      "650",
      "custom typography applies before Done",
    );
    const hint = themes.getByRole("slider", { name: "Hint size", exact: true });
    await hint.evaluate((n) => {
      n.value = "1.1";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(
      await p
        .locator(".books-reader")
        .evaluate((n) => n.style.getPropertyValue("--hint-size")),
      "1.1em",
    );
    await themes.getByRole("button", { name: /^Font/ }).tap();
    await themes.getByRole("button", { name: "System", exact: true }).tap();
    assert(
      (
        await p
          .locator(".folio-columns")
          .evaluate((n) => getComputedStyle(n).fontFamily)
      ).includes("system-ui"),
      "font selection applies immediately",
    );
    await themes.getByRole("button", { name: "Done", exact: true }).tap();
    await themes.screenshot({
      path: `.test-results/reader-settings/themes-${width}.png`,
    });
    const recordTransition = () =>
      p.evaluate(() => {
        window.modeSample = new Promise((resolve, reject) => {
          let frame;
          const timeout = setTimeout(() => {
            cancelAnimationFrame(frame);
            reject(new Error("mode change did not animate the reader"));
          }, 5000);
          const sample = () => {
            const n = document.querySelector(".folio-viewport");
            const a = n?.dataset.modeTransition && n.getAnimations()[0];
            if (!a) {
              frame = requestAnimationFrame(sample);
              return;
            }
            clearTimeout(timeout);
            a.pause();
            a.currentTime = Number(a.effect.getTiming().duration) * 0.2;
            const start = Number(getComputedStyle(n).opacity);
            a.currentTime = Number(a.effect.getTiming().duration) * 0.8;
            const end = Number(getComputedStyle(n).opacity);
            a.play();
            resolve({
              start,
              end,
              duration: Number(a.effect.getTiming().duration),
            });
          };
          frame = requestAnimationFrame(sample);
        });
      });
    const checkTransition = async () => {
      const transition = await p.evaluate(() => window.modeSample);
      assert(
        transition.end > transition.start && transition.duration <= 300,
        "changing the mode briefly animates the book",
      );
      await p.waitForFunction(
        () =>
          !document.querySelector(".folio-viewport")?.dataset.modeTransition,
      );
    };
    for (const kind of ["Curl", "Fast Fade", "Scroll", "Slide"]) {
      await recordTransition();
      await choosePageTurn(themes, kind, (n) => n.tap());
      await checkTransition();
    }
    await themes.getByRole("button", { name: "Close", exact: true }).tap();
    await menu.waitFor();
    await menu.getByRole("button", { name: "Contents", exact: true }).tap();
    await contents.waitFor();
    await contents.getByRole("button", { name: "Close", exact: true }).tap();
    await menu.waitFor();
    assert.equal(await tools.isVisible(), false);
    await menu.getByRole("button", { name: "Search Book", exact: true }).tap();
    const search = p.locator(".folio-popover.search");
    await search.waitFor();
    assert(Math.abs((await search.evaluate(panelWidth)) - menuWidth) < 1);
    assert.equal(await search.evaluate(alpha), 0);
    await search.getByRole("button", { name: "Close", exact: true }).tap();
    await menu.waitFor();
    await menu.getByRole("button", { name: "Book words", exact: true }).tap();
    const words = p.locator(".folio-popover.words");
    await words.waitFor();
    assert(Math.abs((await words.evaluate(panelWidth)) - menuWidth) < 1);
    assert.equal(await words.evaluate(alpha), 0);
    await words.getByRole("button", { name: "Close", exact: true }).tap();
    await menu.waitFor();
    await recordTransition();
    await menu.getByRole("tab", { name: "Clean", exact: true }).tap();
    await checkTransition();
    await recordTransition();
    await menu.getByRole("tab", { name: "Frank", exact: true }).tap();
    await checkTransition();
    const outsideWord = await p
      .locator(".folio-columns [data-book-char]")
      .evaluateAll((nodes) => {
        const menu = document
          .querySelector(".reading-menu")
          .getBoundingClientRect();
        for (const n of nodes) {
          const range = document.createRange();
          range.selectNodeContents(n);
          const r = range.getClientRects()[0];
          if (
            r &&
            r.left > 10 &&
            r.right < innerWidth - 10 &&
            r.top > 10 &&
            r.bottom < Math.min(menu.top, innerHeight / 3)
          )
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        throw new Error("no visible word outside settings");
      });
    const positionBeforeDismiss = await p
      .locator(".reader-page-count")
      .textContent();
    await p.touchscreen.tap(outsideWord.x, outsideWord.y);
    assert.equal(
      await p.locator(".reader-page-count").textContent(),
      positionBeforeDismiss,
      "dismissing settings does not turn a page",
    );
    await p.waitForFunction(
      () =>
        !document
          .querySelector(".books-reader")
          ?.classList.contains("settings-open"),
    );
    assert.equal(
      await p.locator(".word-panel").count(),
      0,
      "outside dismissal never opens a word underneath",
    );
    await revealReader(p, true);
    await tools.tap();
    await menu.getByRole("button", { name: "Themes", exact: true }).tap();
    await themes.waitFor();
    await themes.evaluate((n) =>
      Promise.all(n.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    await p.keyboard.press("Escape");
    assert(
      await themes.evaluate((n) => n.inert && n.getAnimations().length > 0),
      "settings remain mounted and inert while animating out",
    );
    await themes.waitFor({ state: "detached" });
    await revealReader(p, true);
    await tools.tap();
    await menu.evaluate((n) =>
      Promise.all(n.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    await p.screenshot({
      path: `.test-results/reader-settings/menu-${width}.png`,
    });
    assert.deepEqual(errors, []);
    await p.reload();
    await p.locator(".books-reader[data-ready=true]").waitFor();
    assert.equal(
      await p
        .locator(".folio-columns")
        .evaluate((n) => getComputedStyle(n).fontWeight),
      "650",
    );
    assert(
      (
        await p
          .locator(".folio-columns")
          .evaluate((n) => getComputedStyle(n).fontFamily)
      ).includes("system-ui"),
    );
    console.log(
      `${width}px: animated translucent settings, Contents seeking, footer count, bottom fill slider, live colors/type/font and persistence passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
