import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html");
const server = createServer((q, s) => s.end(html));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
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
    });
    const p = await context.newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await p.evaluate(
      () =>
        (location.hash =
          "/read/9b597927-66e7-4b7a-a540-ae3e0583fc22/1.1/clean"),
    );
    await p.locator(".books-reader[data-ready=true]").waitFor();
    const pos = await p.evaluate(() => {
      const f = document
        .querySelector(".folio-viewport")
        .getBoundingClientRect();
      const n = [
        ...document.querySelectorAll(".folio-columns [data-book-char]"),
      ].find((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.left >= f.left &&
          r.right <= f.right &&
          r.top >= f.top &&
          r.bottom <= f.bottom
        );
      });
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.mouse.click(pos.x, pos.y);
    const card = p.getByLabel("Word details");
    await card.waitFor();
    const r = await card.boundingBox();
    assert.ok(
      r.x >= 0 &&
        r.x + r.width <= width &&
        r.y >= 0 &&
        r.y + r.height <= height,
    );
    assert.equal(
      await card.evaluate(
        (n) =>
          getComputedStyle(n).top === "auto" ||
          Math.abs(n.getBoundingClientRect().height - n.scrollHeight) < 4,
      ),
      true,
    );
    const empty = await card.evaluate(
      (n) =>
        n.getBoundingClientRect().bottom -
        n.lastElementChild.getBoundingClientRect().bottom,
    );
    assert.ok(empty < 30, `no stretched blank space: ${empty}`);
    if (touch)
      assert.ok(
        Math.abs(height - r.y - r.height - 12) < 3,
        "sheet anchored to bottom",
      );
    await card.getByRole("button", { name: "Save to My Words" }).click();
    await p.evaluate(() => (location.hash = "/words"));
    await p.locator(".word-selection-toggle").click();
    const check = p.getByRole("checkbox").first();
    await check.check();
    assert.ok(await check.isChecked());
    assert.equal(
      await check.evaluate((n) => getComputedStyle(n).appearance),
      "none",
    );
    assert.equal(await p.locator(".word-row.selected").count(), 1);
    await check.uncheck();
    assert.equal(await p.locator(".word-row.selected").count(), 0);
    console.log(
      `${width}x${height}: compact word card, bottom placement and word selection passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
