import { revealReader } from "./reader-helpers.mjs";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Frank + original: each Frank paragraph is followed by the same paragraph
// without hints as a quotation. It is reached by pressing the Frank tab again.
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
const out = ".test-results/frank-original";
await mkdir(out, { recursive: true });
const IMMENSEE = "9b597927-66e7-4b7a-a540-ae3e0583fc22";
const mode = (p) => p.locator(".books-reader").getAttribute("data-mode");
const frankTab = (p) =>
  p.locator('.reader-mode-tabs button[data-reading-mode="frank"]');
try {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    const p = await browser.newPage({
        viewport,
        colorScheme: "dark",
        reducedMotion: "reduce",
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await p.evaluate(
      (id) => (location.hash = `/read/${id}/2.7/frank`),
      IMMENSEE,
    );
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await revealReader(p);
    await p.locator(".reader-tools-button").click();
    assert.equal(await p.locator(".reader-mode-tabs button").count(), 3);
    assert.equal((await frankTab(p).textContent()).trim(), "Frank");
    assert.equal(await p.locator(".original-quote").count(), 0);

    // Second press on the active Frank tab switches to Frank+.
    await frankTab(p).click();
    await p.waitForFunction(
      () =>
        document.querySelector(".books-reader").dataset.mode ===
          "frank-original" &&
        document.querySelector(".books-reader").dataset.ready === "true",
    );
    assert.equal((await frankTab(p).textContent()).trim(), "Frank+");
    assert.equal(await frankTab(p).getAttribute("aria-selected"), "true");
    assert.match(await p.evaluate(() => location.hash), /\/frank-original$/);

    const check = await p.evaluate(() => {
      const fragments = [...document.querySelectorAll(".folio-fragment")];
      const bad = [];
      let quotes = 0;
      for (const f of fragments) {
        const main = f.querySelector(".reading-panel > p");
        const quote = f.querySelector(".original-quote");
        const mainWords = [...main.querySelectorAll("[data-book-char]")].map(
          (n) => n.textContent,
        );
        if (!mainWords.length) continue;
        if (!quote) {
          bad.push(f.dataset.readingAt + ": no quote");
          continue;
        }
        quotes++;
        if (quote.querySelector(".hint"))
          bad.push(f.dataset.readingAt + ": hint in quote");
        const quoteWords = [...quote.querySelectorAll("[data-book-char]")];
        if (
          quoteWords.map((n) => n.textContent).join(" ") !== mainWords.join(" ")
        )
          bad.push(f.dataset.readingAt + ": words differ");
        // The repeat uses a second copy of the source offsets.
        const length = Math.max(
          ...[...main.querySelectorAll("[data-book-char]")].map(
            (n) => +n.dataset.bookChar + n.textContent.length,
          ),
        );
        if (quoteWords.some((n) => +n.dataset.bookChar <= length))
          bad.push(f.dataset.readingAt + ": offsets overlap");
      }
      const q = document.querySelector(".original-quote");
      const qs = getComputedStyle(q),
        ink = getComputedStyle(
          document.querySelector(".reading-panel > p .word"),
        ).color;
      return {
        bad,
        quotes,
        fragments: fragments.length,
        border: qs.borderLeftStyle,
        borderColor: qs.borderLeftColor,
        color: getComputedStyle(q.querySelector(".word")).color,
        ink,
        hintsVisible: [
          ...document.querySelectorAll(".reading-panel > p .hint"),
        ].some((n) => getComputedStyle(n).display !== "none"),
      };
    });
    assert.deepEqual(check.bad, []);
    assert.ok(check.quotes > 100, `quotes: ${check.quotes}`);
    assert.equal(check.border, "solid");
    assert.equal(check.borderColor, check.ink);
    assert.equal(check.color, check.ink);
    assert.ok(check.hintsVisible, "hints stay visible in Frank+");

    // Hide the menu, then turn pages forward and back without errors.
    await p.keyboard.press("Escape");
    for (let i = 0; i < 4; i++) await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(700);
    await p.screenshot({
      path: `${out}/frank-original-${viewport.width}.png`,
    });
    for (let i = 0; i < 4; i++) await p.keyboard.press("ArrowLeft");

    // Without hints → Clean → back to Frank+ (the variant we came from).
    await revealReader(p);
    await p.locator(".reader-tools-button").click();
    await p.getByRole("button", { name: "Without hints" }).click();
    await p.waitForFunction(
      () => document.querySelector(".books-reader").dataset.mode === "clean",
    );
    assert.equal(await p.locator(".original-quote").count(), 0);
    assert.equal((await frankTab(p).textContent()).trim(), "Frank");
    await p.getByRole("button", { name: "Without hints" }).click();
    await p.waitForFunction(
      () =>
        document.querySelector(".books-reader").dataset.mode ===
        "frank-original",
    );

    // Pressing Frank+ again returns to plain Frank.
    await frankTab(p).click();
    await p.waitForFunction(
      () => document.querySelector(".books-reader").dataset.mode === "frank",
    );
    assert.equal(await p.locator(".original-quote").count(), 0);
    assert.equal(await mode(p), "frank");

    // From Clean the first press gives Frank, the second Frank+.
    await p
      .locator('.reader-mode-tabs button[data-reading-mode="clean"]')
      .click();
    await frankTab(p).click();
    assert.equal(await mode(p), "frank");
    await frankTab(p).click();
    assert.equal(await mode(p), "frank-original");

    // Book search reports matches from the Frank paragraph only, so the
    // hint-free repeat does not double the result list.
    const hits = async () => {
      await p.getByRole("button", { name: "Search Book" }).click();
      await p.locator(".book-search").fill("Elisabeth");
      await p.waitForTimeout(150);
      const n = await p.locator("nav .page-entry").count();
      await p.keyboard.press("Escape");
      await revealReader(p);
      await p.locator(".reader-tools-button").click();
      return n;
    };
    const original = await hits();
    await frankTab(p).click();
    await p.waitForFunction(
      () =>
        document.querySelector(".books-reader").dataset.mode === "frank" &&
        document.querySelector(".books-reader").dataset.ready === "true",
    );
    const frank = await hits();
    assert.ok(frank > 10, `frank hits ${frank}`);
    assert.ok(
      original <= frank * 1.3 + 1,
      `Frank+ ${original} vs Frank ${frank} search hits`,
    );

    assert.deepEqual(errors, []);
    await p.close();
  }

  // The default reading mode can be Frank + original.
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await p
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  const select = p.getByLabel("Default mode");
  await select.waitFor();
  await select.selectOption("frank-original");
  await p.reload();
  await p
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await select.waitFor();
  assert.equal(await select.inputValue(), "frank-original");
  console.log("frank-original: ok");
} finally {
  await browser.close();
  server.close();
}
