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
await new Promise((resolve) => server.listen(4177, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const base = "http://127.0.0.1:4177/german-frank-read/";
await mkdir(".test-results/i18n", { recursive: true });
try {
  const context = await browser.newContext({
    locale: "de-DE",
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await selectReadingFlow(page);
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .click();
  const route = await page.evaluate(() => location.hash);
  assert.equal(
    await page.locator("html").getAttribute("lang"),
    "ru",
    "Russian remains default even in a German browser",
  );
  assert.deepEqual(await page.getByRole("tab").allTextContents(), [
    "Франк",
    "Паралель",
    "Оригинал",
  ]);
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Текст без подсказок", exact: true })
      .isChecked(),
    false,
  );
  assert.equal(await page.locator(".reading-panel").count(), 1);
  const sourceText = await page.locator(".reading-panel p").innerText();
  assert.match(sourceText, /[А-Яа-я]/, "Russian hints are present");
  await page.getByRole("tab", { name: "Паралель", exact: true }).click();
  assert.ok(
    (await page.locator(".parallel-row").count()) > 0,
    "Parallel translation remains available",
  );
  await page.evaluate(() => (location.hash = "/settings"));
  await page.getByLabel("Язык интерфейса").selectOption("de");
  await page
    .getByRole("heading", { name: "Einstellungen", exact: true })
    .waitFor();
  assert.equal(await page.title(), "Deutsch nach Frank");
  await page.reload();
  await page
    .getByRole("heading", { name: "Einstellungen", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Sprache der Oberfläche").inputValue(),
    "de",
  );
  // Legacy saved default is migrated without changing unrelated preferences.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("franka-v2");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(
        {
          language: "de",
          readingFlow: "blocks",
          bookStyleVersion: 1,
          showClean: true,
          font: "sans",
          fontSize: 23,
          theme: "dark",
          rate: 1.2,
        },
        "app",
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "Einstellungen", exact: true })
    .waitFor();
  assert.equal(await page.locator("#size").inputValue(), "23");
  assert.equal(await page.locator("#font").inputValue(), "sans");
  assert.equal(
    await page.getByRole("checkbox", { name: /Text ohne Hilfen/ }).isChecked(),
    false,
  );
  await page.evaluate(
    (route) => (location.hash = route.replace("/parallel", "/frank")),
    route,
  );
  await page.getByRole("tab", { name: "Frank", exact: true }).waitFor();
  assert.deepEqual(await page.getByRole("tab").allTextContents(), [
    "Frank",
    "Parallel",
    "Original",
  ]);
  assert.equal(
    await page.locator(".reading-panel p").innerText(),
    sourceText,
    "Changing UI language leaves the book and hints unchanged",
  );
  await page
    .getByRole("checkbox", { name: "Text ohne Hilfen", exact: true })
    .check();
  assert.equal(await page.locator(".reading-panel").count(), 2);
  await page.reload();
  await page
    .getByRole("checkbox", { name: "Text ohne Hilfen", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Text ohne Hilfen", exact: true })
      .isChecked(),
    true,
    "Explicit opt-in survives reload",
  );
  await page
    .getByRole("checkbox", { name: "Text ohne Hilfen", exact: true })
    .uncheck();
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await page.getByRole("button", { name: "Esel", exact: true }).first().click();
  await page
    .getByRole("button", { name: "Wort speichern", exact: true })
    .click();
  await page.getByRole("button", { name: "Schriftgröße", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.getByRole("button", { name: "Lesemodus", exact: true }).click();
  await page.getByRole("main", { name: "Ungestört lesen" }).waitFor();
  await page.keyboard.press("Tab");
  await page
    .getByRole("button", { name: "Lesemodus verlassen", exact: true })
    .waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  for (const [route, heading] of [
    ["texts", "Texte"],
    ["words", "Meine Wörter"],
    ["settings", "Einstellungen"],
    ["home", null],
  ]) {
    await page.evaluate((route) => (location.hash = "/" + route), route);
    if (heading)
      await page
        .getByRole("heading", { name: heading, exact: false })
        .first()
        .waitFor();
    else await page.locator(".hero").waitFor();
    const ru = await page.locator("button,a,option,label").allTextContents();
    assert.deepEqual(
      ru.filter((s) => /[А-Яа-яЁё]/.test(s) && !s.includes("Русский")),
      [],
      `Translated controls on ${route}`,
    );
    for (const width of [1440, 834, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} fits ${width}px`,
      );
    }
  }
  await page.evaluate(
    (route) => (location.hash = route.replace("/frank", "/parallel")),
    route,
  );
  await page.getByRole("tab", { name: "Parallel", exact: true }).waitFor();
  for (const width of [1440, 834, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    for (const mode of ["Frank", "Parallel", "Original"]) {
      await page.getByRole("tab", { name: mode, exact: true }).click();
      if (mode === "Frank" || mode === "Original") {
        const widths = await page.evaluate(() => ({
          panel: document
            .querySelector(".reading-panel")
            .getBoundingClientRect().width,
          container: document
            .querySelector(".reading-columns")
            .getBoundingClientRect().width,
        }));
        assert.ok(
          Math.abs(widths.panel - widths.container) < 1,
          `One text column fills the available width at ${width}px`,
        );
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `German reader ${mode} fits ${width}px`,
      );
    }
  }
  await page.screenshot({
    path: ".test-results/i18n/reader-de-mobile.png",
    fullPage: true,
  });
  const build = await context.newPage();
  build.on("pageerror", (e) => errors.push(e.message));
  await build.goto(base + "fbook-builder.html");
  await build
    .getByRole("heading", { name: ".fbook-Editor", exact: true })
    .waitFor();
  assert.equal(
    await build.getByLabel("Sprache der Oberfläche").inputValue(),
    "de",
  );
  for (const width of [1440, 390, 320]) {
    await build.setViewportSize({ width, height: 960 });
    assert.ok(
      await build.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Builder fits ${width}px`,
    );
  }
  await build.getByLabel("Sprache der Oberfläche").selectOption("ru");
  await build
    .getByRole("heading", { name: "Сборщик .fbook", exact: true })
    .waitFor();
  await page.reload();
  await page.getByRole("tab", { name: "Оригинал", exact: true }).waitFor();
  assert.equal(
    await page.locator("html").getAttribute("lang"),
    "ru",
    "Language selected in builder is shared with reader",
  );
  assert.deepEqual(errors, []);
  // A storage failure after choosing German must also be understandable in German.
  const denied = await browser.newContext();
  await denied.addInitScript(() => {
    localStorage.setItem("franka-language", "de");
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw Error("Access denied");
      },
    });
  });
  const broken = await denied.newPage();
  await broken.goto(base);
  await broken
    .getByRole("button", { name: "Erneut versuchen", exact: true })
    .waitFor();
  assert.equal(await broken.locator("html").getAttribute("lang"), "de");
  await denied.close();
  await context.close();
  console.log(
    "Language defaults, migration, persistence, content integrity, German layouts and startup verified",
  );
} finally {
  await browser.close();
  server.close();
}
