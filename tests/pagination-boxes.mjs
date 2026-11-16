import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Reproduce the algorithmic failure independently of browser-specific element
// boxes: the document overflows into many columns, but inline-element boxes
// describe their first-column flow positions. Text Range geometry stays intact.
const html = await readFile(process.env.READER_HTML || "index.html");
const server = createServer((_, res) => res.end(html));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  // CI sets CHROME_PATH to the runner's browser.
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const p = await browser.newPage({
    viewport: { width: 834, height: 1194 },
    reducedMotion: "reduce",
  });
  await p.addInitScript(() => {
    const rects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function () {
      const list = Array.from(rects.call(this));
      const canvas = this.closest(".folio-columns");
      if (
        !canvas ||
        !this.matches(
          "[data-book-char],.reading-panel p,.folio-chapter-title",
        ) ||
        this.closest(".scroll-reader")
      )
        return list;
      const origin = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      const stride =
        (origin.width + parseFloat(style.columnGap)) /
        Number(style.columnCount);
      return list.map(
        (r) =>
          new DOMRect(
            origin.left +
              ((((r.left - origin.left) % stride) + stride) % stride),
            r.top,
            r.width,
            r.height,
          ),
      );
    };
  });
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
  const id = await p
    .locator(".continue-card")
    .filter({
      has: p.getByRole("heading", { name: "Die Verwandlung", exact: true }),
    })
    .getAttribute("data-book");
  await p.evaluate((id) => (location.hash = `/read/${id}/1.1/clean`), id);
  await p.locator(".books-reader[data-ready=true]").waitFor();
  const total = Number(
    (await p.locator(".reader-page-count").textContent()).match(/\d+/g)[1],
  );
  assert(
    total > 10,
    `element boxes must not replace a multi-page novel with ${total} page`,
  );
  await p.locator(".books-reader").focus();
  await p.keyboard.press("End");
  await p.waitForTimeout(100);
  const lastVisible = await p
    .locator("[data-book-char]")
    .last()
    .evaluate((n) => {
      const range = document.createRange();
      range.selectNodeContents(n);
      const v = document
        .querySelector(".folio-viewport")
        .getBoundingClientRect();
      return Array.from(range.getClientRects()).some(
        (r) =>
          r.left >= v.left - 1 &&
          r.right <= v.right + 1 &&
          r.top >= v.top - 1 &&
          r.bottom <= v.bottom + 1,
      );
    });
  if (!lastVisible) {
    // Diagnostics for CI, where the browser version differs from local runs.
    await mkdir(".test-results/pagination-boxes", { recursive: true });
    await p.screenshot({
      path: ".test-results/pagination-boxes/last-page.png",
    });
    console.log(
      JSON.stringify(
        await p.evaluate(() => {
          const word = [...document.querySelectorAll("[data-book-char]")].at(
            -1,
          );
          const range = document.createRange();
          range.selectNodeContents(word);
          return {
            browser: navigator.userAgent,
            counter: document.querySelector(".reader-page-count")?.textContent,
            paginated:
              document.querySelector(".books-reader")?.dataset.paginated,
            word: word.textContent,
            rects: [...range.getClientRects()].map((r) =>
              [r.left, r.top, r.right, r.bottom].map(Math.round),
            ),
            viewport: (({ left, top, right, bottom }) =>
              [left, top, right, bottom].map(Math.round))(
              document.querySelector(".folio-viewport").getBoundingClientRect(),
            ),
            transform:
              document.querySelector(".folio-columns")?.style.transform,
            chapters: [...document.querySelectorAll(".folio-chapter")].map(
              (c) => c.getAttribute("style"),
            ),
          };
        }),
      ),
    );
  }
  assert(
    lastVisible,
    "final source word must actually be visible on the last page",
  );
  console.log(
    `PASS: ${total} pages and last word reachable with incorrect inline-element fragment boxes`,
  );
} finally {
  await browser.close();
  server.close();
}
