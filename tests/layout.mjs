import { selectReadingFlow } from "./select-reading-flow.mjs";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("index.html"),
  builder = await readFile("fbook-builder.html");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(req.url.includes("fbook-builder") ? builder : html);
});
await new Promise((r) => server.listen(4175, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/redesign", { recursive: true });
try {
  const page = await browser.newPage({ colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:4175/german-frank-read/";
  await page.goto(base);
  await selectReadingFlow(page);
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .click();
  await page.locator(".reader-layout").waitFor();
  const reader = await page.evaluate(() => location.hash);
  const routes = [
    ["home", "Читаю сейчас"],
    ["texts", "Тексты"],
    ["words", "Мои слова"],
    ["settings", "Настройки"],
    [reader.slice(2), null],
  ];
  let checks = 0;
  for (const theme of ["light", "dark"]) {
    await page.evaluate(() => (location.hash = "/settings"));
    await page.getByLabel("Тема", { exact: true }).selectOption(theme);
    await page.waitForFunction(
      (t) => document.documentElement.dataset.theme === t,
      theme,
    );
    for (const [width, height] of [
      [1876, 1312],
      [1440, 960],
      [1280, 800],
      [1024, 768],
      [834, 1194],
      [390, 844],
      [320, 720],
      [1440, 1800],
    ]) {
      await page.setViewportSize({ width, height });
      for (const [route, title] of routes) {
        await page.evaluate((route) => (location.hash = "/" + route), route);
        if (route === "home") await page.locator(".hero").waitFor();
        else if (title)
          await page
            .getByRole("heading", { name: title, exact: route !== "words" })
            .waitFor();
        else await page.locator(".reader-layout").waitFor();
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        if (route === "home") {
          assert.ok(
            (await page.locator(".book-cover").count()) >= 3,
            "Library displays real book covers",
          );
          if (width > 900) {
            const nav = await page.locator(".nav").boundingBox();
            assert.ok(nav.x < 260, "Desktop navigation is in the sidebar");
          }
        }
        if (route.startsWith("read/")) {
          for (const mode of ["Франк", "Оригинал", "Паралель"]) {
            await page.getByRole("tab", { name: mode, exact: true }).click();
            await page.waitForFunction(
              (mode) =>
                [...document.querySelectorAll("[role=tab]")].some(
                  (t) =>
                    t.textContent === mode &&
                    t.getAttribute("aria-selected") === "true",
                ),
              mode,
            );
            const toggle = page.locator(".toc-toggle");
            const initiallyOpen =
              (await toggle.getAttribute("aria-expanded")) === "true";
            if (!initiallyOpen) await toggle.click();
            await page
              .getByRole("navigation", { name: "Отрывки", exact: true })
              .waitFor();
            const expandedWidth = (
              await page.locator(".reader-layout > main").boundingBox()
            ).width;
            await toggle.click();
            await page
              .locator("#reader-fragments")
              .waitFor({ state: "hidden" });
            assert.equal(await toggle.getAttribute("aria-expanded"), "false");
            const collapsedWidth = (
              await page.locator(".reader-layout > main").boundingBox()
            ).width;
            assert.ok(
              width > 900
                ? collapsedWidth > expandedWidth
                : collapsedWidth >= expandedWidth,
              "Reader gains the collapsed panel space",
            );
            await toggle.press("Enter");
            await page
              .getByRole("navigation", { name: "Отрывки", exact: true })
              .waitFor();
            assert.equal(await toggle.getAttribute("aria-expanded"), "true");
            if (!initiallyOpen) await toggle.click();
            assert.equal(
              await page.locator(".word-panel").count(),
              0,
              "No word panel before interaction: " + mode,
            );
            assert.equal(
              await page
                .getByText("Нажмите на слово, чтобы увидеть подсказку", {
                  exact: true,
                })
                .count(),
              0,
              "No instruction text",
            );
            await page.locator(".reading-panel .word").first().click();
            await page
              .getByRole("complementary", {
                name: "Подсказка к слову",
                exact: true,
              })
              .waitFor();
            await page
              .getByRole("button", { name: "Закрыть подсказку", exact: true })
              .click();
            await page.locator(".word-panel").waitFor({ state: "detached" });
          }
        }
        const metrics = await page.evaluate(() => ({
          root: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
          bodyHeight: document.body.getBoundingClientRect().height,
          appHeight: document.getElementById("app").getBoundingClientRect()
            .height,
          scroll: document.documentElement.scrollWidth,
          viewport: innerWidth,
          viewHeight: innerHeight,
        }));
        const label = `${theme} ${width}×${height} ${route}`;
        assert.equal(
          metrics.root,
          metrics.body,
          "Different canvas/body background: " + label,
        );
        assert.ok(
          metrics.bodyHeight >= height && metrics.appHeight >= height,
          "Uncovered viewport bottom: " + label,
        );
        if (metrics.scroll > metrics.viewport)
          console.log(
            await page.locator("body *").evaluateAll((nodes) =>
              nodes
                .filter((e) => {
                  const r = e.getBoundingClientRect();
                  return r.width > 0 && (r.left < 0 || r.right > innerWidth);
                })
                .map((e) => ({
                  tag: e.tagName,
                  class: e.className,
                  text: e.textContent?.slice(0, 60),
                  left: e.getBoundingClientRect().left,
                  right: e.getBoundingClientRect().right,
                }))
                .slice(-20),
            ),
          );
        assert.ok(
          metrics.scroll <= metrics.viewport,
          "Horizontal overflow: " + label + " " + JSON.stringify(metrics),
        );
        if (theme === "dark")
          assert.notEqual(
            metrics.root,
            "rgb(244, 244, 240)",
            "Light canvas in dark mode: " + label,
          );
        const controls = await page
          .locator(
            "button:visible,select:visible,input:not([type=hidden]):visible",
          )
          .evaluateAll((nodes) =>
            nodes
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
              })
              .map((el) => el.getAttribute("aria-label") || el.textContent),
          );
        assert.deepEqual(controls, [], "Controls outside viewport: " + label);
        if (
          ((width === 1440 && height === 960) || width === 390) &&
          ["home", "texts", "settings"].includes(route)
        )
          await page.screenshot({
            path: `.test-results/redesign/${route}-${theme}-${width}.png`,
            fullPage: true,
          });
        checks++;
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.evaluate(() => (location.hash = "/settings"));
  await page.getByLabel("Тема", { exact: true }).selectOption("system");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "system",
  );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
    "rgb(22, 26, 28)",
  );
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
    "rgb(244, 244, 240)",
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(base + "fbook-builder.html");
    await page.getByRole("button", { name: "Пример", exact: true }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Builder horizontal overflow",
    );
    assert.ok(
      await page.evaluate(
        () => document.body.getBoundingClientRect().height >= innerHeight,
      ),
      "Builder canvas height",
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${checks} route/theme/viewport combinations, matching html/body backgrounds, full-height canvas, visible controls, system theme changes, builder layout`,
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
