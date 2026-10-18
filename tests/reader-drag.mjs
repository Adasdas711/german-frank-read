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
await mkdir(".test-results/reader-drag", { recursive: true });
try {
  for (const [width, motion] of [
    [390, "no-preference"],
    [834, "reduce"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 1194 },
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
        has: p.getByRole("heading", {
          name: "Die Bremer Stadtmusikanten",
          exact: true,
        }),
      })
      .getAttribute("data-book");
    await p.evaluate((id) => (location.hash = `/read/${id}/1.1/frank`), id);
    await p.locator(".books-reader[data-ready=true]").waitFor();
    const settle = () =>
      p.waitForFunction(
        () => !document.querySelector(".books-reader[data-turning]"),
      );
    const number = () => p.locator(".folio-page-number").textContent();
    const menu = p.locator(".reading-menu"),
      tools = p.locator(".reader-tools-button");
    const open = async () => {
      await p.keyboard.press("Escape");
      await revealReader(p, true);
      await tools.tap();
      await menu.waitFor();
    };
    await open();
    assert(
      await menu.evaluate((n) =>
        n.getAnimations().some((a) => a.playState === "running"),
      ),
      "menu animates on entry",
    );
    await p.keyboard.press("Escape");
    assert(
      await menu.evaluate(
        (n) =>
          n.inert && n.getAnimations().some((a) => a.playState === "running"),
      ),
      "closing menu animates and immediately stops accepting input",
    );
    await menu.waitFor({ state: "detached" });
    const cdp = await context.newCDPSession(p);
    const touch = (type, x) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y: 590 }],
      });
    for (const [kind, label] of [
      ["slide", "Slide"],
      ["curl", "Curl"],
      ["fade", "Fast Fade"],
    ]) {
      await open();
      await menu.getByRole("button", { name: "Themes", exact: true }).tap();
      await choosePageTurn(p.locator(".themes-panel"), label, (n) => n.tap());
      await p.keyboard.press("Escape");
      await p.locator(".books-reader").focus();
      await p.keyboard.press("Home");
      await p.waitForTimeout(200);
      const before = await number();
      await touch("touchStart", width * 0.85);
      await touch("touchMove", width * 0.65);
      const frame = await p.locator(".reader-page-layer").evaluate((n) => ({
        rect: n.getBoundingClientRect().x,
        times: [...n.getAnimations({ subtree: true })].map(
          (a) => a.currentTime,
        ),
        paused: n
          .getAnimations({ subtree: true })
          .every((a) => a.playState === "paused"),
        kind: n.closest(".books-reader").dataset.turning,
      }));
      assert.equal(frame.kind, kind);
      assert(
        frame.paused && frame.times.some((t) => t > 0),
        "page follows the finger before release",
      );
      await touch("touchMove", width * 0.45);
      await p.waitForFunction(
        (previous) =>
          document
            .querySelector(".reader-page-layer")
            ?.getAnimations({ subtree: true })[0]?.currentTime > previous,
        frame.times[0],
        { timeout: 3000 },
      );
      const advanced = await p
        .locator(".reader-page-layer")
        .evaluate((n) => n.getAnimations({ subtree: true })[0].currentTime);
      assert(
        advanced > frame.times[0],
        "moving further changes the visible fold/slide/fade",
      );
      await p.screenshot({
        path: `.test-results/reader-drag/${kind}-${width}.png`,
      });
      await touch("touchMove", width * 0.82);
      await touch("touchEnd");
      await settle();
      assert.equal(
        await number(),
        before,
        "returning the finger cancels the turn",
      );
      assert.equal(await p.locator(".reader-page-layer").count(), 0);
      await touch("touchStart", width * 0.85);
      await touch("touchMove", width * 0.3);
      await touch("touchEnd");
      await settle();
      assert.notEqual(
        await number(),
        before,
        "completed swipe advances one page",
      );
      await touch("touchStart", width * 0.15);
      await touch("touchMove", width * 0.75);
      await touch("touchEnd");
      await settle();
      assert.equal(
        await number(),
        before,
        "backwards swipe returns to the same source page",
      );
      await touch("touchStart", width * 0.85);
      await touch("touchMove", width * 0.6);
      await touch("touchCancel");
      await settle();
      assert.equal(
        await number(),
        before,
        "pointer cancellation restores the original page",
      );
      assert.equal(
        await p.locator(".word-panel").count(),
        0,
        "swiping never opens a word note",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      `${width}px ${motion}: menu entry/exit, finger tracking, completion, reversal and cancellation passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
