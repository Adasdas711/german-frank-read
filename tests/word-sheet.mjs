import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html");
const server = createServer((q, s) => s.end(html));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/word-note", { recursive: true });
try {
  for (const [width, height, touch] of [
    [320, 720, true],
    [390, 844, true],
    [834, 1194, true],
    [1366, 1024, true],
    [1366, 900, false],
  ]) {
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
    await p.evaluate(
      () =>
        (location.hash =
          "/read/9b597927-66e7-4b7a-a540-ae3e0583fc22/1.1/clean"),
    );
    await p.locator(".books-reader[data-ready=true]").waitFor();
    const client = await context.newCDPSession(p);
    const event = (type, x, y) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
      });
    const point = async (edge = "middle") =>
      p.evaluate((edge) => {
        document
          .querySelector("[data-note-target]")
          ?.removeAttribute("data-note-target");
        const v = document
          .querySelector(".folio-viewport")
          .getBoundingClientRect();
        const candidates = [
          ...document.querySelectorAll(".folio-columns [data-book-char]"),
        ]
          .map((n) => ({ n, r: n.getBoundingClientRect() }))
          .filter(
            ({ r }) =>
              r.width &&
              r.left > innerWidth * 0.15 &&
              r.right < innerWidth * 0.85 &&
              r.top > v.top + 8 &&
              r.bottom < v.bottom - 8,
          );
        candidates.sort((a, b) =>
          edge === "bottom"
            ? b.r.top - a.r.top
            : edge === "top"
              ? a.r.top - b.r.top
              : Math.abs(a.r.top - (v.top + v.height * 0.5)) -
                Math.abs(b.r.top - (v.top + v.height * 0.5)),
        );
        const { n, r } = candidates[0];
        n.dataset.noteTarget = "true";
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, edge);
    const card = p.getByLabel("Word details");
    const hold = async (pos) => {
      if (touch) {
        await event("touchStart", pos.x, pos.y);
        await p.waitForTimeout(650);
        await event("touchEnd");
      } else {
        await p.mouse.move(pos.x, pos.y);
        await p.mouse.down();
        await p.waitForTimeout(650);
        await p.mouse.up();
      }
      await card.waitFor();
    };
    const bounds = async () => {
      const r = await card.boundingBox(),
        source = await p.locator("[data-note-target]").boundingBox();
      assert(
        r.x >= 11 &&
          r.x + r.width <= width - 11 &&
          r.y >= 11 &&
          r.y + r.height <= height - 11,
        JSON.stringify(r),
      );
      const gap =
        r.y >= source.y + source.height
          ? r.y - source.y - source.height
          : source.y - r.y - r.height;
      assert(gap >= 6 && gap <= 10, `note must be beside the word, gap=${gap}`);
      assert(
        r.width <= 385 && r.height <= Math.min(418, height * 0.65),
        `compact note: ${JSON.stringify(r)}`,
      );
    };
    const pos = await point();
    await p.mouse.move(pos.x, pos.y);
    assert.equal(
      await p.locator(".word.chosen").count(),
      0,
      "hover cannot select a word",
    );
    assert.equal(
      await p
        .locator("[data-note-target]")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    if (touch) {
      await event("touchStart", pos.x, pos.y);
      await event("touchEnd");
    } else await p.mouse.click(pos.x, pos.y);
    await p.waitForTimeout(120);
    assert.equal(
      await card.count(),
      0,
      "a normal tap/click cannot open the note",
    );
    assert.equal(await p.locator(".word.chosen").count(), 0);
    await hold(pos);
    await bounds();
    assert.equal(await p.locator(".word.chosen").count(), 1);
    assert(
      await p
        .locator("[data-note-target]")
        .evaluate((n) => n.classList.contains("chosen")),
    );
    assert.equal(await p.evaluate(() => getSelection().toString()), "");
    assert.equal(await card.locator("details").getAttribute("open"), null);
    await p.screenshot({
      path: `.test-results/word-note/${width}-${touch ? "touch" : "mouse"}.png`,
    });
    await card.locator("summary").click();
    await p.waitForTimeout(100);
    assert(await card.locator(".word-context[open] p").first().isVisible());
    const expanded = await card.boundingBox();
    assert(
      expanded.y >= 11 && expanded.y + expanded.height <= height - 11,
      "expanded context remains on screen",
    );
    await card
      .getByRole("button", { name: "Save to My Words", exact: true })
      .click();
    await card.getByRole("button", { name: "Remove from My Words", exact: true }).waitFor();
    await card.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(
      await p.locator(".word.chosen").count(),
      0,
      "closing clears the selection",
    );
    for (const edge of ["top", "bottom"]) {
      const at = await point(edge);
      await hold(at);
      await bounds();
      await p.keyboard.press("Escape");
      assert.equal(await p.locator(".word.chosen").count(), 0);
    }
    // A small drag cancels lookup without turning a page or selecting text.
    const at = await point();
    if (touch) {
      await event("touchStart", at.x, at.y);
      await event("touchMove", at.x + 24, at.y);
      await p.waitForTimeout(650);
      await event("touchEnd");
    } else {
      await p.mouse.move(at.x, at.y);
      await p.mouse.down();
      await p.mouse.move(at.x + 24, at.y, { steps: 4 });
      await p.waitForTimeout(650);
      await p.mouse.up();
    }
    assert.equal(await card.count(), 0, "moving cancels hold");
    assert.equal(await p.locator(".word.chosen").count(), 0);
    assert.equal(await p.evaluate(() => getSelection().toString()), "");
    // Switching pages closes both the note and its highlight.
    await hold(await point());
    await p.locator(".books-reader").focus();
    await p.keyboard.press("ArrowRight");
    await card.waitFor({ state: "detached" });
    assert.equal(await p.locator(".word.chosen").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `${width}x${height} ${touch ? "touch" : "mouse"}: neutral tap/hover, hold-only lookup, anchored compact note, context, save, cancellation and dismissal passed`,
    );
    await client.detach();
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
