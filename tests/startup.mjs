import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html", "utf8");
const marker = html.indexOf("<!--\nНемецкий");
assert.ok(
  marker > 0 && marker < 4000000,
  "startup code must precede the legal notices",
);
assert.ok(html.startsWith("<!doctype html>"), "doctype must be first");
const prefix = html.slice(0, marker),
  tail = html.slice(marker);
const held = new Set();
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/german-frank-read/slow/") {
    // Keep the legal notices undelivered until the UI has opened.
    res.write(prefix);
    held.add(res);
    res.on("close", () => held.delete(res));
    return;
  }
  res.end(html);
});
await new Promise((r) => server.listen(4174, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4174/german-frank-read/slow/", {
    waitUntil: "commit",
  });
  await page.locator(".continue-open").first().waitFor({ timeout: 15000 });
  assert.equal(await page.evaluate(() => document.readyState), "loading");
  assert.equal(await page.locator("#espeak-wasm").count(), 0);
  for (const res of held) res.end(tail);
  await page.waitForLoadState("load");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: library usable during streaming startup at a GitHub Pages subpath; no speech payload",
  );
  const denied = await browser.newPage();
  await denied.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, "open", {
      value() {
        throw new DOMException("Storage blocked for test", "SecurityError");
      },
    });
  });
  await denied.goto("http://127.0.0.1:4174/german-frank-read/");
  await denied
    .getByRole("alert")
    .filter({ hasText: "Storage blocked for test" })
    .waitFor();
  await denied.clock.install();
  await denied.clock.fastForward(15000);
  assert.ok(
    await denied
      .getByRole("alert")
      .filter({ hasText: "Storage blocked for test" })
      .isVisible(),
  );
  assert.ok(
    await denied
      .getByRole("button", { name: "Try again", exact: true })
      .isVisible(),
  );
  console.log(
    "PASS: denied storage leaves a persistent error with retry, not an eternal loader",
  );
  const stalled = await browser.newPage();
  await stalled.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, "open", {
      value() {
        return {};
      },
    });
  });
  await stalled.clock.install();
  await stalled.goto("http://127.0.0.1:4174/german-frank-read/");
  await stalled.waitForTimeout(300);
  await stalled.clock.fastForward(11000);
  await stalled
    .getByRole("alert")
    .filter({ hasText: "did not respond within 10 seconds" })
    .waitFor();
  console.log("PASS: stalled IndexedDB opening times out visibly");
} finally {
  for (const res of held) res.end();
  await browser.close();
  await new Promise((r) => server.close(r));
}
