import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import assert from "node:assert/strict";
import { revealReader, choosePageTurn } from "./reader-helpers.mjs";

const books = await Promise.all(
  [
    "die-bremer-stadtmusikanten-demo.fbook",
    "rotkappchen-demo.fbook",
    "die-verwandlung-demo.fbook",
    "immensee.fbook",
  ].map(async (file) =>
    JSON.parse(
      strFromU8(unzipSync(await readFile(`books/${file}`))["manifest.json"]),
    ),
  ),
);
const html = await readFile("index.html");
const server = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const failures = [];
try {
  for (const width of [390, 834, 1440]) {
    if (
      process.env.TEST_SEEK_WIDTH &&
      width !== Number(process.env.TEST_SEEK_WIDTH)
    )
      continue;
    const touch = width < 1000;
    const context = await browser.newContext({
      viewport: { width, height: 1024 },
      hasTouch: touch,
      reducedMotion: "reduce",
    });
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const cdp = await context.newCDPSession(p);
    const activate = (n) => (touch ? n.tap() : n.click());
    const frame = () =>
      p.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
    const menu = p.locator(".reading-menu");
    const open = async () => {
      await p.keyboard.press("Escape");
      await revealReader(p, touch);
      await activate(p.locator(".reader-tools-button"));
      await menu.waitFor();
      await menu.evaluate((n) =>
        Promise.all(n.getAnimations().map((a) => a.finished.catch(() => {}))),
      );
    };
    for (const book of books) {
      await p.evaluate(
        (id) => (location.hash = `/read/${id}/1.1/frank`),
        book.id,
      );
      await p.locator(".books-reader[data-ready=true]").waitFor();
      await p.evaluate(() => document.fonts.ready);
      for (const [kind, label, textMode] of [
        ["slide", "Slide", "frank"],
        ["curl", "Curl", "frank"],
        ["fade", "Fast Fade", "frank"],
        ["scroll", "Scroll", "frank"],
        ["scroll", "Scroll", "clean"],
        ["scroll", "Scroll", "parallel"],
      ]) {
        if (textMode !== "frank") {
          await p.evaluate(
            ({ id, textMode }) =>
              (location.hash = `/read/${id}/1.1/${textMode}`),
            { id: book.id, textMode },
          );
          await frame();
        }
        await open();
        await activate(
          menu.getByRole("button", { name: "Themes", exact: true }),
        );
        await choosePageTurn(p.locator(".folio-popover.type"), label, activate);
        await p.waitForFunction(
          (kind) =>
            document
              .querySelector(".books-reader")
              .classList.contains(`turn-${kind}`),
          kind,
        );
        await frame();
        await open();
        const row = p.locator(".contents-progress");
        await row.evaluate((node) => {
          node.addEventListener(
            "pointerdown",
            (event) => {
              node.seekX = event.clientX;
              node.seekStart = {
                x: event.clientX,
                width: node.getBoundingClientRect().width,
                value: Number(node.querySelector("input").value),
              };
            },
            true,
          );
          node.addEventListener(
            "pointermove",
            (event) => {
              node.seekX = event.clientX;
            },
            true,
          );
        });
        const box = await row.boundingBox(),
          y = box.y + box.height / 2;
        const pointer = async (type, fraction) => {
          const x = box.x + box.width * fraction;
          if (touch)
            await cdp.send("Input.dispatchTouchEvent", {
              type,
              touchPoints:
                type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
            });
          else if (type === "touchStart") {
            await p.mouse.move(x, y);
            await p.mouse.down();
          } else if (type === "touchEnd") await p.mouse.up();
          else await p.mouse.move(x, y);
        };
        let checks = 0;
        for (let repeat = 0; repeat < 2; repeat++) {
          await row.locator("input").focus();
          await row.locator("input").press("Home");
          await frame();
          await pointer("touchStart", 0.2);
          for (const fraction of [
            0, 0.25, 0.5, 0.51, 0.52, 0.75, 1, 0.6, 0.1, 1, 0,
          ]) {
            await pointer("touchMove", 0.2 + fraction);
            await frame();
            const result = await row.evaluate((n) => {
              const input = n.querySelector("input"),
                vp = document.querySelector(".folio-viewport");
              return {
                value: +input.value,
                dragValue: n.seekStart.value,
                dragFraction: (n.seekX - n.seekStart.x) / n.seekStart.width,
                max: +input.max,
                fill:
                  parseFloat(getComputedStyle(n, "::before").width) /
                  n.clientWidth,
                label: n.textContent,
                scroll: vp.scrollTop,
                extent: vp.scrollHeight - vp.clientHeight,
                counter:
                  document.querySelector(".reader-page-count").textContent,
              };
            });
            const expected = Math.max(
              0,
              Math.min(
                result.max,
                Math.round(
                  result.dragValue + result.dragFraction * result.max + 1e-9,
                ),
              ),
            );
            if (kind === "scroll") {
              assert(
                Math.abs(result.scroll / result.extent - fraction) < 0.002,
                `${book.title}: Scroll must follow the actual distance`,
              );
              if (fraction === 1) {
                const [current, total] = result.counter
                  .match(/\d+/g)
                  .map(Number);
                assert.equal(
                  current,
                  total,
                  "the bottom of a book is its final page",
                );
              }
            }

            const percent = result.max
              ? Math.round((expected / result.max) * 100)
              : 0;
            if (
              !result.label.trim().endsWith(`${percent}%`) ||
              result.value !== expected ||
              Math.abs(result.fill - (result.max ? expected / result.max : 0)) >
                0.015
            ) {
              failures.push({
                width,
                book: book.title,
                kind,
                repeat,
                fraction,
                expected,
                ...result,
              });
            }
            checks++;
          }
          await pointer("touchEnd", 0);
          await frame();
          assert(await menu.isVisible(), "seeking must keep the menu open");
        }
        if (touch) {
          await pointer("touchStart", 0.2);
          await pointer("touchMove", 0.8);
          await pointer("touchCancel", 0.8);
          const resumeStart = Number(await row.locator("input").inputValue());
          await pointer("touchStart", 0.2);
          await pointer("touchMove", 0.6);
          await pointer("touchEnd", 0.6);
          await frame();
          const resumed = menu.getByRole("slider", {
            name: "Reading position",
            exact: true,
          });
          assert.equal(
            Number(await resumed.inputValue()),
            Math.round(
              Math.min(
                Number(await resumed.getAttribute("max")),
                resumeStart + 0.4 * Number(await resumed.getAttribute("max")),
              ),
            ),
            "a cancelled gesture must not disable later drags",
          );
        }
        if (kind === "scroll") {
          const viewport = p.locator(".folio-viewport");
          await viewport.evaluate((n) => n.scrollTo(0, n.scrollHeight));
          await frame();
          assert.equal(
            Number(await row.locator("input").inputValue()),
            1000,
            "native scrolling to the bottom updates Contents",
          );
          for (const edge of ["top", "bottom"]) {
            await viewport.evaluate((n, edge) => {
              const value =
                edge === "top" ? -40 : n.scrollHeight - n.clientHeight + 40;
              Object.defineProperty(n, "scrollTop", {
                configurable: true,
                get: () => value,
              });
              n.dispatchEvent(new Event("scroll"));
            }, edge);
            await frame();
            assert.equal(
              Number(await row.locator("input").inputValue()),
              edge === "top" ? 0 : 1000,
              "elastic overscroll stays inside the range",
            );
          }
          await viewport.evaluate((n) => {
            delete n.scrollTop;
            n.dispatchEvent(new Event("scroll"));
          });
          await frame();
        }
        await activate(
          menu.getByRole("button", { name: "Contents", exact: true }),
        );
        await p.locator(".folio-popover.contents").waitFor();
        console.log(
          `${width}px ${book.title} ${kind}/${textMode}: ${checks} held positions, repeated drags and chapter tap checked`,
        );
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  if (failures.length) console.log(JSON.stringify(failures, null, 2));
  assert.deepEqual(
    failures,
    [],
    "Contents must reach every requested position and stay responsive",
  );
} finally {
  await browser.close();
  server.close();
}
