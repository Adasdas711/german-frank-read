import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html");
assert(
  html.length < 5 * 1024 * 1024,
  "reader must not embed the speech engine",
);
const server = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/reading-controls", { recursive: true });
try {
  for (const width of [390, 834, 1440]) {
    const height = width === 390 ? 844 : 1024;
    const touch = width < 1000;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: touch,
      reducedMotion: "reduce",
    });
    const p = await context.newPage();
    const errors = [];
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
    const root = p.locator(".books-reader");
    await p.locator(".books-reader[data-ready=true]").waitFor();
    const tools = p.locator(".reader-tools-button");
    const menu = p.locator(".reading-menu");
    const activate = async (target) => (touch ? target.tap() : target.click());
    const openMenu = async () => {
      await p.keyboard.press("Escape");
      await activate(tools);
      await menu.waitFor();
    };
    const openThemes = async () => {
      await openMenu();
      await activate(menu.getByRole("button", { name: "Themes", exact: true }));
      await p.locator(".folio-popover.type").waitFor();
    };
    const total = async () =>
      Number(
        (await p.locator(".folio-page-number").textContent()).match(/\d+/g)[1],
      );
    for (const turn of ["slide", "curl", "fade", "scroll"]) {
      await openThemes();
      await p
        .getByRole("combobox", { name: "Page turning", exact: true })
        .selectOption(turn);
      await p.waitForFunction(
        (turn) =>
          document
            .querySelector(".books-reader")
            .classList.contains("turn-" + turn),
        turn,
      );
      for (const [mode, label] of [
        ["frank", "Frank"],
        ["clean", "Clean"],
        ["parallel", "Parallel"],
      ]) {
        await openMenu();
        await activate(menu.getByRole("tab", { name: label, exact: true }));
        await p.waitForFunction(
          (mode) =>
            document.querySelector(".books-reader").dataset.mode === mode,
          mode,
        );
        await p.waitForTimeout(180);
        assert(
          (await total()) > 10,
          `${width} ${turn} ${mode}: complete novel must have many pages`,
        );
        if (turn !== "scroll")
          assert(
            await p
              .locator(".folio-columns")
              .evaluate(
                (n) =>
                  n.style.height.endsWith("px") &&
                  Math.abs(n.clientHeight - n.parentElement.clientHeight) < 2,
              ),
            "paginated canvas has definite physical height",
          );
        await p.keyboard.press("Escape");
        await root.focus();
        await p.keyboard.press("End");
        await p.waitForTimeout(100);
        assert(
          Number(
            (await p.locator(".folio-page-number").textContent()).match(
              /\d+/,
            )[0],
          ) > 1,
          `${turn}/${mode}: final page reachable`,
        );
        await p.keyboard.press("Home");
      }
    }
    await openThemes();
    const themes = p.locator(".folio-popover.type");
    assert.equal(
      await p
        .locator(
          'button[aria-label="Pronounce word"],button[aria-label="Listen to page"],button[aria-label="Stop audio"]',
        )
        .count(),
      0,
    );
    assert.equal(await p.locator("#espeak-wasm,#ipa-wasm").count(), 0);
    const box = await themes.boundingBox();
    assert(box.width <= 440 && box.x + box.width <= width);
    // Interleave native toggles, range input, select and buttons repeatedly.
    for (let i = 0; i < 3; i++) {
      await activate(
        themes.getByRole("button", { name: "Larger", exact: true }),
      );
      const checkbox = themes.getByRole("checkbox").first();
      const before = await checkbox.isChecked();
      await activate(checkbox);
      assert.equal(await checkbox.isChecked(), !before);
      const slider = themes.getByRole("slider", {
        name: "Reading controls",
        exact: true,
      });
      await slider.focus();
      const old = Number(await slider.inputValue());
      await slider.press("ArrowRight");
      assert.equal(Number(await slider.inputValue()), old + 1);
      await themes
        .getByRole("combobox", { name: "Page turning", exact: true })
        .selectOption(i % 2 ? "slide" : "curl");
      await activate(
        themes.getByRole("button", { name: "Smaller", exact: true }),
      );
      await activate(checkbox);
      assert.equal(await checkbox.isChecked(), before);
    }
    const range = themes.getByRole("slider", {
      name: "Reading controls",
      exact: true,
    });
    await range.scrollIntoViewIfNeeded();
    const r = await range.boundingBox();
    const initial = Number(await range.inputValue());
    const x = r.x + (r.width * (initial - 80)) / 80,
      y = r.y + r.height / 2;
    if (touch) {
      const client = await context.newCDPSession(p);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 4; step++)
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + step * r.width * 0.05, y }],
        });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await client.detach();
    } else {
      await p.mouse.move(x, y);
      await p.mouse.down();
      await p.mouse.move(x + r.width * 0.2, y, { steps: 4 });
      await p.mouse.up();
    }
    assert(
      Number(await range.inputValue()) > initial,
      "range still responds to physical dragging after neighboring buttons and toggles",
    );
    await themes
      .getByRole("button", { name: "Reset interface size", exact: true })
      .click();
    await themes
      .getByRole("combobox", { name: "Page turning", exact: true })
      .selectOption("slide");
    await p.screenshot({
      path: `.test-results/reading-controls/themes-${width}.png`,
    });
    await openMenu();
    await activate(menu.getByRole("button").first());
    const contents = p.locator(".folio-popover.contents");
    await contents.waitFor();
    const c = await contents.boundingBox();
    assert(
      width - c.x - c.width < 30 && c.x >= 0,
      "contents opens at right edge",
    );
    await p.screenshot({
      path: `.test-results/reading-controls/contents-${width}.png`,
    });
    await openMenu();
    await activate(
      menu.getByRole("button", { name: "Search Book", exact: true }),
    );
    await contents
      .getByRole("textbox", { name: "Search Book", exact: true })
      .fill("Gregor");
    assert(
      (await contents.locator(".page-entry").count()) > 0,
      "search current full book",
    );
    await p.keyboard.press("Escape");
    await openMenu();
    await activate(menu.getByRole("tab", { name: "Clean", exact: true }));
    await p.keyboard.press("Escape");
    await root.focus();
    await p.keyboard.press("Home");
    await p.waitForTimeout(150);
    const point = await p
      .locator(".folio-columns [data-book-char]")
      .evaluateAll((nodes) => {
        const v = document
          .querySelector(".folio-viewport")
          .getBoundingClientRect();
        const n = nodes.find((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.width > 10 &&
            r.left > v.left + 30 &&
            r.right < v.right - 30 &&
            r.top > v.top + 20 &&
            r.bottom < v.bottom - 90
          );
        });
        const r = n.getBoundingClientRect();
        n.dataset.controlsWord = "yes";
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    const lookup = async () => {
      await p.mouse.move(point.x, point.y);
      await p.mouse.down();
      await p.waitForTimeout(650);
      await p.mouse.up();
      await p.getByLabel("Word details").waitFor();
    };
    await lookup();
    const note = p.getByLabel("Word details");
    await note
      .getByRole("button", { name: "Save to My Words", exact: true })
      .click();
    await note
      .getByRole("button", { name: "Remove from My Words", exact: true })
      .click();
    await note
      .getByRole("button", { name: "Save to My Words", exact: true })
      .click();
    const route = p.url();
    await openMenu();
    await activate(
      menu.getByRole("button", { name: "Book words", exact: true }),
    );
    const words = p.getByRole("dialog", { name: "Book words", exact: true });
    await words.waitFor();
    assert.equal(
      p.url(),
      route,
      "words open inside reading without changing route",
    );
    assert.equal(await words.locator(".reader-saved-word").count(), 1);
    await words.locator("summary").click();
    assert(await words.locator("blockquote").isVisible());
    await p.screenshot({
      path: `.test-results/reading-controls/words-${width}.png`,
    });
    await activate(words.getByRole("button", { name: /^Remove word / }));
    assert.equal(await words.locator(".reader-saved-word").count(), 0);
    assert.equal(p.url(), route);
    await activate(words.getByRole("button", { name: "Close", exact: true }));
    await lookup();
    assert(
      await note
        .getByRole("button", { name: "Save to My Words", exact: true })
        .isVisible(),
      "deletion updates word card immediately",
    );
    await p.keyboard.press("Escape");
    await activate(p.locator(".reader-exit"));
    await p.waitForURL(/#\/home$/);
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: 12 turn/mode combinations, real page counts, right panels, compact Themes, repeated native controls, in-reader words and deletion passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
