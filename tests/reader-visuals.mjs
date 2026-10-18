import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { revealReader, choosePageTurn } from "./reader-helpers.mjs";

const html = await readFile("index.html");
const server = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/reader-visuals", { recursive: true });
try {
  for (const [width, height, motion] of [
    [390, 844, "no-preference"],
    [834, 1194, "no-preference"],
    [1440, 1024, "no-preference"],
    [834, 1194, "reduce"],
  ]) {
    if (
      process.env.TEST_READER_WIDTH &&
      width !== Number(process.env.TEST_READER_WIDTH)
    )
      continue;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 1000,
      reducedMotion: motion,
    });
    const p = await context.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    assert.equal(
      await p.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
      0,
      "library has no motion",
    );
    const id = await p
      .locator(".continue-card")
      .filter({
        has: p.getByRole("heading", { name: "Die Verwandlung", exact: true }),
      })
      .getAttribute("data-book");
    await p.evaluate((id) => (location.hash = `/read/${id}/1.1/frank`), id);
    const reader = p.locator(".books-reader"),
      menu = p.locator(".reading-menu"),
      themes = p.locator(".folio-popover.type");
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await p.evaluate(() => document.fonts.ready);
    const area = await p.locator(".folio-viewport").boundingBox();
    assert(
      area.y >= 16 && area.y <= 30 && area.y + area.height <= height - 40,
      "paginated text leaves margins and space for its page number",
    );
    const openMenu = async () => {
      await p.keyboard.press("Escape");
      await revealReader(p);
      await p.locator(".reader-tools-button").click();
      await menu.waitFor();
    };
    const openThemes = async () => {
      await openMenu();
      await menu.getByRole("button", { name: "Themes", exact: true }).click();
      await themes.waitFor();
    };
    const inverted = async (button) => {
      await p.waitForTimeout(120);
      assert(
        await button.evaluate((n) => {
          const root = n.closest(".books-reader"),
            s = getComputedStyle(n),
            r = getComputedStyle(root);
          const probe = document.createElement("i");
          root.append(probe);
          probe.style.color = r.getPropertyValue("--folio-ink");
          const ink = getComputedStyle(probe).color;
          probe.style.color = r.getPropertyValue("--folio-paper");
          const paper = getComputedStyle(probe).color;
          probe.remove();
          return s.backgroundColor === ink && s.color === paper;
        }),
        "selected/held button swaps paper and ink colors",
      );
    };
    await openMenu();
    assert.deepEqual(
      await p.locator(".folio-viewport").boundingBox(),
      area,
      "showing controls does not resize the text",
    );
    const bookmark = menu.getByRole("button", {
      name: "Bookmark",
      exact: true,
    });
    await bookmark.click();
    await inverted(
      menu.getByRole("button", { name: "Remove bookmark", exact: true }),
    );
    await inverted(menu.getByRole("tab", { name: "Frank", exact: true }));
    const clean = menu.getByRole("tab", { name: "Clean", exact: true });
    const cb = await clean.boundingBox();
    await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await p.mouse.down();
    await inverted(clean);
    await p.mouse.up();
    await p.waitForFunction(
      () => document.querySelector(".books-reader").dataset.mode === "clean",
    );
    await openThemes();
    await themes.getByRole("button", { name: "Paper", exact: true }).click();
    await openMenu();
    await inverted(menu.getByRole("tab", { name: "Clean", exact: true }));
    await p.screenshot({
      path: `.test-results/reader-visuals/selected-${width}-${motion}.png`,
    });
    await menu
      .getByRole("button", { name: "Search Book", exact: true })
      .click();
    const search = p.locator(".folio-popover.search"),
      input = search.getByRole("textbox", { name: "Search Book", exact: true });
    await input.fill("Gregor");
    await search.locator(".page-entry").first().waitFor();
    await search.evaluate((n) =>
      Promise.all(n.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    assert(
      await input.evaluate(
        (n) =>
          parseFloat(getComputedStyle(n).fontSize) >= 18 &&
          n.getBoundingClientRect().height >= 56,
      ),
    );
    const searchBox = await search.boundingBox();
    assert(searchBox.x >= 0 && searchBox.x + searchBox.width <= width + 1);
    assert(
      Math.abs(searchBox.width - Math.min(420 * 1.08, width - 36 * 1.08)) < 1,
      "search and reading tools share a width",
    );
    await p.screenshot({
      path: `.test-results/reader-visuals/search-${width}-${motion}.png`,
    });
    const result = search.locator(".page-entry").first(),
      resultBox = await result.boundingBox();
    await p.mouse.move(resultBox.x + 20, resultBox.y + 20);
    await p.mouse.down();
    await inverted(result);
    assert(
      await result.evaluate((n) =>
        [...n.querySelectorAll("strong,small")].every(
          (child) =>
            getComputedStyle(child).color === getComputedStyle(n).color,
        ),
      ),
      "all result text stays readable while pressed",
    );
    await p.mouse.move(width - 2, height - 2);
    await p.mouse.up();
    for (const [kind, label] of [
      ["slide", "Slide"],
      ["curl", "Curl"],
      ["fade", "Fast Fade"],
    ]) {
      await openThemes();
      await choosePageTurn(themes, label);
      await p.keyboard.press("Escape");
      await reader.focus();
      await p.keyboard.press("Home");
      const before = Number(
        (await p.locator(".folio-page-number").textContent()).match(/\d+/)[0],
      );
      await p.keyboard.press("ArrowRight");
      const frames = await p.evaluate(() => {
        const root = document.querySelector(".books-reader"),
          canvas = root.querySelector(".folio-columns");
        const animations = [
          ...canvas.getAnimations(),
          ...root.querySelectorAll(".reader-page-layer"),
        ].flatMap((n) =>
          n instanceof Animation ? [n] : n.getAnimations({ subtree: true }),
        );
        const result = {
          kind: root.dataset.turning,
          running: animations.filter((a) => a.playState === "running").length,
          canvas: canvas.getAnimations().map((a) => a.effect.getKeyframes()),
          front: root
            .querySelector(".curl-front")
            ?.getAnimations()
            .map((a) => a.effect.getKeyframes()),
          back: root
            .querySelector(".curl-back")
            ?.getAnimations()
            .map((a) => a.effect.getKeyframes()),
          copied: root.querySelectorAll(
            ".reader-page-layer .curl-snapshot span",
          ).length,
        };
        for (const a of animations) {
          a.pause();
          a.currentTime =
            Number(a.effect.getTiming().duration) *
            (root.dataset.turning === "curl" ? 0.25 : 0.45);
        }
        window.turnAnimations = animations;
        return result;
      });
      assert.equal(frames.kind, kind);
      assert(
        frames.running > 0,
        "selected transition starts, including with reduced motion",
      );
      if (kind === "slide")
        assert(
          frames.canvas.some((f) => f[0].transform !== f.at(-1).transform),
          "Slide moves the page horizontally",
        );
      if (kind === "curl") {
        assert(
          frames.front.length && frames.back.length,
          "Curl has a continuous front and reflected back",
        );
        assert(frames.copied > 0, "Curl contains actual outgoing text");
        assert(
          frames.front[0][0].clipPath !== frames.front[0].at(-1).clipPath,
          "the fold moves across the page",
        );
        assert.equal(
          await p.locator(".curl-strip").count(),
          0,
          "no segmented sheet",
        );
      }
      if (kind === "fade")
        assert(
          frames.canvas.some(
            (f) => Number(f[0].opacity) === 0 && Number(f.at(-1).opacity) === 1,
          ),
          "Fast Fade crossfades pages",
        );
      await p.screenshot({
        path: `.test-results/reader-visuals/${kind}-${width}-${motion}.png`,
      });
      await p.evaluate(() => window.turnAnimations.forEach((a) => a.play()));
      await p.waitForFunction(
        () => !document.querySelector(".books-reader[data-turning]"),
      );
      assert.equal(
        await p.locator(".reader-page-layer").count(),
        0,
        "transition layers are removed after finishing",
      );
      const after = Number(
        (await p.locator(".folio-page-number").textContent()).match(/\d+/)[0],
      );
      assert(after > before);
      await p.keyboard.press("ArrowLeft");
      await p.waitForFunction(
        () => !document.querySelector(".books-reader[data-turning]"),
      );
      assert.equal(
        Number(
          (await p.locator(".folio-page-number").textContent()).match(/\d+/)[0],
        ),
        before,
      );
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("ArrowRight");
      await p.waitForFunction(
        () => !document.querySelector(".books-reader[data-turning]"),
      );
      assert.equal(
        await p.locator(".reader-page-layer").count(),
        0,
        "rapid navigation does not leave stale layers",
      );
    }
    await revealReader(p);
    await p.locator(".reader-exit").click();
    await p.waitForURL(/#\/home$/);
    assert.equal(
      await p.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
      0,
      "all reading motion stops on exit",
    );
    assert.deepEqual(errors, []);
    console.log(
      `${width}px ${motion}: page margins, overlaid controls, inverted buttons, large search, distinct forward/back/rapid Slide/Curl/Fade and cleanup passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
