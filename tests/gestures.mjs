import { revealReader } from "./reader-helpers.mjs";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const errors = [];
const number = async (p) =>
  +(await p.locator(".folio-page-number").textContent()).match(/\d+/)[0];
const settle = async (p) => {
  await p.waitForFunction(
    () => !document.querySelector(".books-reader[data-turning]"),
  );
  await p.waitForTimeout(100);
};
const point = async (p) =>
  p.locator(".folio-columns [data-book-char]").evaluateAll((nodes) => {
    const v = document.querySelector(".folio-viewport").getBoundingClientRect();
    const n = nodes.find((n) => {
      const b = n.getBoundingClientRect();
      return (
        b.left > innerWidth * 0.2 &&
        b.right < innerWidth * 0.8 &&
        b.top > v.top + 90 &&
        b.bottom < v.bottom - 80
      );
    });
    const b = n.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
try {
  for (const turn of ["slide", "curl", "fade", "scroll"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      hasTouch: true,
      colorScheme: "dark",
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const id = await p.evaluate(async (turn) => {
      const d = await new Promise((r) => {
        const q = indexedDB.open("franka-v2");
        q.onsuccess = () => r(q.result);
      });
      const books = await new Promise((r) => {
        const q = d.transaction("books").objectStore("books").getAll();
        q.onsuccess = () => r(q.result);
      });
      await new Promise((r) => {
        const tx = d.transaction("settings", "readwrite"),
          s = tx.objectStore("settings"),
          q = s.get("app");
        q.onsuccess = () => s.put({ ...q.result, pageTurn: turn }, "app");
        tx.oncomplete = r;
      });
      d.close();
      return books.find((b) => b.manifest.title.includes("Bremer")).manifest.id;
    }, turn);
    await p.reload();
    await p.evaluate((id) => (location.hash = `/read/${id}/1.1/frank`), id);
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await settle(p);
    const start = await number(p),
      x = 1420,
      y = 450;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.waitForTimeout(650);
    await p.mouse.up();
    await settle(p);
    assert.equal(await number(p), start, turn + " mouse hold");
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x - 220, y, { steps: 15 });
    await p.mouse.up();
    await settle(p);
    assert.equal(await number(p), start, turn + " mouse drag");
    assert.equal(await p.evaluate(() => getSelection().toString()), "");
    assert.equal(
      await p
        .locator(".folio-columns p")
        .first()
        .evaluate((n) => getComputedStyle(n).userSelect),
      "none",
    );
    await p.mouse.click(x, y);
    await settle(p);
    const cols = +(await p
      .locator(".books-reader")
      .getAttribute("data-columns"));
    assert.equal(
      await number(p),
      start,
      turn + " tap shows controls instead of turning",
    );
    assert(
      await p.locator(".books-reader.controls-visible").count(),
      "stationary tap shows controls",
    );
    const before = await number(p);
    await p.mouse.move(700, 450);
    for (let i = 0; i < 20; i++) {
      await p.mouse.wheel(0, 12);
      await p.waitForTimeout(25);
    }
    await settle(p);
    if (turn !== "scroll")
      assert.equal(await number(p), before + cols, turn + " wheel momentum");
    else
      assert.ok(
        (await p.locator(".folio-viewport").evaluate((n) => n.scrollTop)) > 100,
      );
    // Text dragging cannot create a selection or a page transition.
    await p.keyboard.press("Home");
    await settle(p);
    const w = await point(p),
      n = await number(p);
    await p.mouse.move(w.x, w.y);
    await p.mouse.down();
    await p.mouse.move(w.x + 85, w.y + 40, { steps: 10 });
    await p.mouse.up();
    assert.equal(await p.evaluate(() => getSelection().toString()), "");
    assert.equal(await number(p), n);
    await p.mouse.move(w.x, w.y);
    await p.mouse.down();
    await p.waitForTimeout(650);
    await p.mouse.up();
    await p.getByLabel("Word details").waitFor();
    await p.keyboard.press("Escape");
    // Real touch swipe, stationary hold, movement cancellation and native scrolling.
    await p.setViewportSize({ width: 390, height: 844 });
    await settle(p);
    await p.keyboard.press("Home");
    await settle(p);
    const cdp = await context.newCDPSession(p);
    const touch = async (type, x, y) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
      });
    let old = await number(p);
    await touch("touchStart", 310, 400);
    for (const x of [275, 240, 200, 160, 120, 80]) {
      await touch("touchMove", x, 400);
      await p.waitForTimeout(20);
    }
    await touch("touchEnd");
    await settle(p);
    assert.equal(
      await number(p),
      turn === "scroll" ? old : old + 1,
      turn + " swipe once",
    );
    assert.equal(await p.getByLabel("Word details").count(), 0);
    assert.equal(
      await p.locator(".books-reader.controls-visible").count(),
      0,
      "swipe does not show controls",
    );
    await p.keyboard.press("Home");
    await settle(p);
    const q = await point(p);
    old = await number(p);
    await touch("touchStart", q.x, q.y);
    await p.waitForTimeout(650);
    await touch("touchEnd");
    await p.getByLabel("Word details").waitFor();
    assert.equal(await number(p), old, turn + " long press");
    assert.equal(await p.evaluate(() => getSelection().toString()), "");
    await p.keyboard.press("Escape");
    await touch("touchStart", q.x, q.y);
    await touch("touchMove", q.x + 20, q.y);
    await p.waitForTimeout(650);
    await touch("touchEnd");
    await settle(p);
    assert.equal(
      await p.getByLabel("Word details").count(),
      0,
      turn + " cancelled hold",
    );
    if (turn === "scroll") {
      const initial = await p
        .locator(".folio-viewport")
        .evaluate((n) => n.scrollTop);
      await touch("touchStart", 220, 600);
      for (const y of [550, 480, 400, 320, 240]) {
        await touch("touchMove", 220, y);
        await p.waitForTimeout(30);
      }
      await touch("touchEnd");
      await settle(p);
      assert.ok(
        (await p.locator(".folio-viewport").evaluate((n) => n.scrollTop)) >
          initial + 100,
      );
    }
    // Text fields and controls retain native editing and don't turn the book.
    await revealReader(p, true);
    await p.locator(".mobile-reader-menu").tap();
    await p
      .locator(".reading-menu")
      .getByRole("button", { name: "Search Book", exact: true })
      .tap();
    const search = p.getByRole("textbox", { name: "Search Book", exact: true });
    await search.fill("Esel");
    await search.press("Control+a");
    assert.equal(await search.inputValue(), "Esel");
    await context.close();
    console.log("PASS gestures " + turn);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
}
