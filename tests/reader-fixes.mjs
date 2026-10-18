import { revealReader } from "./reader-helpers.mjs";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html");
const server = createServer((q, s) => {
  s.setHeader("Content-Type", "text/html;charset=utf-8");
  s.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/reader-fixes", { recursive: true });
try {
  const p = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await p.evaluate(
    () =>
      (location.hash = "/read/9b597927-66e7-4b7a-a540-ae3e0583fc22/2.7/frank"),
  );
  await p.locator(".books-reader[data-ready=true]").waitFor();
  await p.waitForTimeout(200);
  const timing = [];
  await revealReader(p);
  await p.locator(".reader-tools-button").click();
  // Real full-story mode changes must reuse the same source-word DOM nodes.
  await p.evaluate(
    () =>
      (window.firstWord = document.querySelector(
        ".folio-columns [data-book-char]",
      )),
  );
  for (const mode of [
    "clean",
    "parallel",
    "frank",
    "parallel",
    "clean",
    "frank",
  ]) {
    const ms = await p.evaluate(async (mode) => {
      const start = performance.now();
      [...document.querySelectorAll(".reader-mode-tabs button")]
        .find((b) => b.textContent.toLowerCase() === mode)
        .click();
      await new Promise((r) => {
        let n = 0;
        const f = () => {
          if (
            document.querySelector(".books-reader").dataset.mode === mode &&
            ++n === 4
          )
            r();
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      return performance.now() - start;
    }, mode);
    timing.push([mode, Math.round(ms)]);
    assert.ok(ms < 1800, `Immensee ${mode} took ${ms} ms`);
    assert.ok(
      await p.evaluate(
        () =>
          window.firstWord ===
          document.querySelector(".folio-columns [data-book-char]"),
      ),
    );
    if (mode === "parallel") {
      const orphan = await p
        .locator(".sentence-original")
        .evaluateAll((nodes) =>
          nodes
            .filter((n) => !/[\p{L}\p{N}]/u.test(n.textContent))
            .map((n) => n.textContent),
        );
      assert.deepEqual(orphan, []);
    }
  }
  await p.evaluate(
    () =>
      (location.hash =
        "/read/9b597927-66e7-4b7a-a540-ae3e0583fc22/2.7/parallel"),
  );
  await p.waitForTimeout(200);
  await p.screenshot({ path: ".test-results/reader-fixes/quotes.png" });
  // Only a held word inverts the paper/ink pair; hovering stays neutral.
  for (const theme of ["night", "paper"]) {
    await p.evaluate(async (theme) => {
      const d = await new Promise((r) => {
        const q = indexedDB.open("franka-v2");
        q.onsuccess = () => r(q.result);
      });
      await new Promise((r) => {
        const tx = d.transaction("settings", "readwrite"),
          s = tx.objectStore("settings"),
          q = s.get("app");
        q.onsuccess = () =>
          s.put(
            { ...q.result, readingTheme: theme, followSystem: false },
            "app",
          );
        tx.oncomplete = r;
      });
      d.close();
    }, theme);
    await p.reload();
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await p.waitForTimeout(100);
    const point = await p
      .locator(".folio-columns [data-book-char]")
      .evaluateAll((nodes) => {
        const v = document
          .querySelector(".folio-viewport")
          .getBoundingClientRect();
        const n = nodes.find((n) => {
          const b = n.getBoundingClientRect();
          return (
            b.left >= v.left &&
            b.right <= v.right &&
            b.top >= v.top &&
            b.bottom <= v.bottom
          );
        });
        const b = n.getBoundingClientRect();
        n.dataset.hoverTest = "yes";
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
    await p.mouse.move(point.x, point.y);
    assert.equal(await p.locator(".word.chosen").count(), 0);
    assert.equal(await p.getByLabel("Word details").count(), 0);
    await p.mouse.down();
    await p.waitForTimeout(650);
    await p.mouse.up();
    const colors = await p.locator("[data-hover-test=yes]").evaluate((n) => {
      const s = getComputedStyle(n),
        root = getComputedStyle(document.querySelector(".books-reader"));
      const canvas = document.createElement("canvas"),
        c = canvas.getContext("2d");
      const normalize = (x) => {
        c.fillStyle = x;
        return c.fillStyle;
      };
      return {
        fg: normalize(s.color),
        bg: normalize(s.backgroundColor),
        ink: normalize(root.getPropertyValue("--folio-ink").trim()),
        paper: normalize(root.getPropertyValue("--folio-paper").trim()),
      };
    });
    assert.equal(colors.fg, colors.paper);
    assert.equal(colors.bg, colors.ink);
    assert.notEqual(colors.fg, colors.bg);
  }
  await p.evaluate(() => (location.hash = "/words"));
  await p.getByRole("heading", { name: "All words", exact: true }).waitFor();
  for (const width of [320, 390, 834, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    const button = p.locator(".word-selection-toggle");
    assert.ok(
      await button.evaluate((n) => {
        const b = n.getBoundingClientRect(),
          r = document.createRange();
        r.selectNodeContents(n);
        const t = r.getBoundingClientRect();
        return (
          t.left >= b.left &&
          t.right <= b.right &&
          t.top >= b.top &&
          t.bottom <= b.bottom
        );
      }),
    );
    await button.click();
    assert.equal(await button.textContent(), "Done");
    await button.click();
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await p.screenshot({ path: ".test-results/reader-fixes/select.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS Immensee quotes, held-word highlight in night/paper, Select at 4 sizes, and stable DOM across all reading modes:",
    JSON.stringify(timing),
  );
} finally {
  await browser.close();
  server.close();
}
