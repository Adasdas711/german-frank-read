import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { revealReader, choosePageTurn } from "./reader-helpers.mjs";

const html = await readFile("index.html");
const server = createServer((_, res) => res.end(html));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [390, 834, 1440]) {
    const p = await browser.newPage({
      viewport: { width, height: 1194 },
      hasTouch: true,
    });
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
    for (const mode of ["frank", "clean", "parallel"]) {
      await p.evaluate(
        ({ id, mode }) => (location.hash = `/read/${id}/1.1/${mode}`),
        { id, mode },
      );
      await p.locator(".books-reader[data-ready=true]").waitFor();
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(100);
      const result = await p.evaluate(() => {
        const canvas = document.querySelector(".folio-columns"),
          v = document.querySelector(".folio-viewport").getBoundingClientRect();
        const origin = canvas.getBoundingClientRect(),
          s = getComputedStyle(canvas),
          range = document.createRange();
        const stride =
          (origin.width + parseFloat(s.columnGap)) / Number(s.columnCount);
        const leaf = (r) =>
          Math.max(0, Math.floor((r.left - origin.left + 1) / stride));
        const clipped = [],
          split = [],
          words = [];
        for (const row of canvas.querySelectorAll(".sentence-row")) {
          range.selectNodeContents(row);
          const rects = [...range.getClientRects()].filter(
            (r) => r.width > 0 && r.height > 0,
          );
          if (!rects.length) continue;
          const first = rects[0],
            last = rects.at(-1);
          if (rects.some((r) => leaf(r) !== leaf(first))) {
            // Independently typeset the entire sentence without page columns.
            // Only sentences taller than a whole page may be split.
            const scratch = document.createElement("main");
            scratch.className = "folio-columns";
            Object.assign(scratch.style, {
              position: "fixed",
              left: "-300vw",
              top: "0",
              visibility: "hidden",
              width: stride - parseFloat(s.columnGap) + "px",
              height: "auto",
              columnCount: "auto",
              columnWidth: "auto",
              transform: "none",
            });
            const copy = row.cloneNode(true);
            delete copy.dataset.pageStart;
            const panel = document.createElement("section"),
              paragraph = document.createElement("p");
            panel.className = "reading-panel";
            paragraph.style.textIndent = "0";
            paragraph.append(copy);
            panel.append(paragraph);
            scratch.append(panel);
            canvas.parentElement.append(scratch);
            range.selectNodeContents(copy);
            const fullHeight = range.getBoundingClientRect().height;
            scratch.remove();
            if (fullHeight <= v.height + 1)
              split.push({
                text: row.textContent.slice(0, 90),
                height: fullHeight,
                page: v.height,
              });
          }
        }
        for (const node of canvas.querySelectorAll("[data-book-char]")) {
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (
              r.width &&
              r.height &&
              (r.top < v.top - 1 || r.bottom > v.bottom + 1)
            )
              clipped.push(node.textContent);
          }
          words.push(node.textContent);
        }
        return {
          clipped: clipped.slice(0, 10),
          split: split.slice(0, 10),
          words: words.length,
          breaks: canvas.querySelectorAll("[data-page-start]").length,
          top: v.top,
          bottom: v.bottom,
          number: document
            .querySelector(".folio-page-number")
            .textContent.trim(),
        };
      });
      console.log(width, mode, JSON.stringify(result));
      assert.deepEqual(
        result.clipped,
        [],
        "all source glyphs fit vertically on their pages",
      );
      assert.deepEqual(
        result.split,
        [],
        "only sentences taller than a whole page can span pages",
      );
      assert(result.words > 19000);
      if (mode !== "parallel")
        assert(
          result.breaks > 0,
          "sentence breaks are inserted in inline paragraphs",
        );
      assert(result.top >= 16 && result.bottom <= 1194 - 40);
      assert.match(result.number, /^\d+$/);
    }
    await p.keyboard.press("Escape");
    await revealReader(p);
    assert.match(
      (await p.locator(".reader-page-count").textContent()).trim(),
      /^\d+ of \d+$/,
    );
    await p.locator(".reader-tools-button").click();
    await p
      .locator(".reading-menu")
      .getByRole("button", { name: "Themes", exact: true })
      .click();
    await choosePageTurn(p.locator(".themes-panel"), "Scroll");
    const scroll = await p.locator(".folio-viewport").boundingBox();
    assert.equal(scroll.y, 0);
    assert.equal(scroll.height, 1194);
    assert.equal(await p.locator("[data-page-start]").count(), 0);
    assert.deepEqual(errors, []);
    await p.close();
  }
  // A single sentence longer than a page cannot be kept whole. Verify that its
  // continuation starts on complete lines, without blank pages or missing words.
  const files = unzipSync(
    await readFile("books/die-bremer-stadtmusikanten-demo.fbook"),
  );
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  const content = JSON.parse(strFromU8(files["book.json"]));
  manifest.id = "abcdefab-1234-4567-8abc-123456789abc";
  manifest.title = "Oversized sentence";
  manifest.chapters = [["Long sentence", 1]];
  const source = Array.from({ length: 600 }, () => "Wörter").join(" ") + ".";
  content.c = [[[source]]];
  content.t = [[["Перевод"]]];
  content.f = { Wörter: ["ˈvœʁtɐ"] };
  content.l = [];
  content.g = [];
  delete content.x;
  manifest.stats = { fragments: 1, words: 600 };
  const fixture = zipSync({
    mimetype: [files.mimetype, { level: 0 }],
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "book.json": strToU8(JSON.stringify(content)),
  });
  const p = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await p.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "test.fbook",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture),
  });
  await p.getByRole("button", { name: "Add to Library" }).click();
  await p.getByText("Book added", { exact: true }).waitFor();
  await p.evaluate(
    (id) => (location.hash = `/read/${id}/1.1/clean`),
    manifest.id,
  );
  await p.locator(".books-reader[data-ready=true]").waitFor();
  const layout = await p.evaluate(() => {
    const v = document.querySelector(".folio-viewport").getBoundingClientRect(),
      canvas = document.querySelector(".folio-columns"),
      origin = canvas.getBoundingClientRect(),
      range = document.createRange();
    const stride =
        origin.width + parseFloat(getComputedStyle(canvas).columnGap),
      pages = new Map(),
      clipped = [];
    for (const word of canvas.querySelectorAll("[data-book-char]")) {
      range.selectNodeContents(word);
      const r = [...range.getClientRects()][0],
        leaf = Math.floor((r.left - origin.left + 1) / stride);
      pages.set(leaf, (pages.get(leaf) || 0) + 1);
      if (r.top < v.top - 1 || r.bottom > v.bottom + 1)
        clipped.push(word.textContent);
    }
    return {
      pages: [...pages.keys()],
      words: [...pages.values()].reduce((a, b) => a + b, 0),
      clipped,
    };
  });
  assert.equal(layout.words, 600);
  assert.deepEqual(layout.clipped, []);
  assert(layout.pages.length > 2);
  assert.deepEqual(
    layout.pages,
    Array.from({ length: layout.pages.length }, (_, i) => i),
    "no empty columns inside an oversized sentence",
  );
  console.log(
    "Oversized sentence: all 600 words fit on complete lines without blank continuation pages",
  );
  await p.close();
} finally {
  await browser.close();
  server.close();
}
