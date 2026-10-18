import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import assert from "node:assert/strict";
const files = unzipSync(
  await readFile("books/die-bremer-stadtmusikanten-demo.fbook"),
);
const content = JSON.parse(strFromU8(files["book.json"])),
  manifest = JSON.parse(strFromU8(files["manifest.json"]));
const first = content.c[0][0],
  translation = content.t[0][0];
const long = Array.from({ length: 14 }, (_, i) =>
  i ? [" ", ...first] : first,
).flat();
content.c = [
  [long, first],
  [first, long],
];
content.t = [
  [Array.from({ length: 14 }, () => translation).flat(), translation],
  [translation, Array.from({ length: 14 }, () => translation).flat()],
];
manifest.id = "abbaabba-1234-4567-8abc-123456789abc";
manifest.title = "Das Lesebuch";
manifest.chapters = [
  ["Erstes Kapitel", 2],
  ["Zweites Kapitel", 2],
];
manifest.stats = {
  fragments: 4,
  words: content.c.flat().reduce(
    (n, chunks) =>
      n +
      (
        chunks
          .map((c) => (typeof c === "string" ? c : c[0]))
          .join("")
          .match(/[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*/gu) || []
      ).length,
    0,
  ),
};
const fixture = zipSync({
  mimetype: [files.mimetype, { level: 0 }],
  "manifest.json": strToU8(JSON.stringify(manifest)),
  "book.json": strToU8(JSON.stringify(content)),
});
const html = await readFile("index.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/german-frank-read/`;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "long.fbook",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture),
  });
  await page.getByRole("button", { name: "Add to Library" }).click();
  await page.getByText("Book added", { exact: true }).waitFor();
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const mode of ["frank", "clean", "parallel"]) {
      await page.evaluate(
        ({ id, mode }) => (location.hash = `/read/${id}/1.1/${mode}`),
        { id: manifest.id, mode },
      );
      await page.locator(".books-reader[data-ready=true]").waitFor();
      await page.waitForTimeout(150);
      await page.keyboard.press("Home");
      await page.waitForTimeout(80);
      const allIds = await page
        .locator(".folio-columns [data-book-char]")
        .evaluateAll((nodes) =>
          nodes.map(
            (n) =>
              n.closest("[data-reading-at]").dataset.readingAt +
              ":" +
              n.dataset.bookChar,
          ),
        );
      const seen = new Set();
      let last = "",
        iterations = 0;
      while (iterations++ < 100) {
        await page.waitForFunction(
          () => !document.querySelector(".books-reader[data-turning]"),
        );
        await page.waitForTimeout(30);
        const ids = await page
          .locator(".folio-columns [data-book-char]")
          .evaluateAll((nodes) => {
            const v = document
              .querySelector(".folio-viewport")
              .getBoundingClientRect();
            return nodes
              .filter((n) => {
                return [...n.getClientRects()].some(
                  (r) =>
                    r.left >= v.left - 1 &&
                    r.right <= v.right + 1 &&
                    r.top >= v.top - 1 &&
                    r.bottom <= v.bottom + 1,
                );
              })
              .map(
                (n) =>
                  n.closest("[data-reading-at]").dataset.readingAt +
                  ":" +
                  n.dataset.bookChar,
              );
          });
        for (const id of ids) seen.add(id);
        const number = await page.locator(".folio-page-number").textContent();
        if (number === last) break;
        last = number;
        await page.keyboard.press("ArrowRight");
      }
      const missing = [...new Set(allIds)].filter((id) => !seen.has(id));
      assert.deepEqual(
        missing,
        [],
        `${mode} ${viewport.width}: every source word must be reachable`,
      );
      console.log(
        `PASS pagination ${mode} at ${viewport.width}: ${seen.size} word positions across ${iterations - 1} screens`,
      );
    }
  }
  // A real touch swipe turns the page, and long press opens a Frank-mode word card.
  await page.evaluate(
    (id) => (location.hash = `/read/${id}/1.1/frank`),
    manifest.id,
  );
  await page.locator(".books-reader[data-ready=true]").waitFor();
  await page.keyboard.press("Home");
  const before = await page.locator(".folio-page-number").textContent();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 330, y: 400 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 80, y: 405 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(100);
  assert.notEqual(
    await page.locator(".folio-page-number").textContent(),
    before,
  );
  const point = await page
    .locator(".folio-columns [data-book-char]")
    .evaluateAll((nodes) => {
      const v = document
        .querySelector(".folio-viewport")
        .getBoundingClientRect();
      const n = nodes.find((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.left > v.left &&
          r.right < v.right &&
          r.top > v.top + 30 &&
          r.bottom < v.bottom - 30
        );
      });
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.getByLabel("Word details").waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS actual touch swipe and word long press");
} finally {
  await browser.close();
  server.close();
}
