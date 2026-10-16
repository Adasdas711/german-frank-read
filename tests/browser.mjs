import { selectReadingFlow } from "./select-reading-flow.mjs";
import { chromium } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
const server = createServer(async (req, res) => {
  try {
    const name =
      new URL(req.url, "http://localhost").pathname
        .replace(/^\/german-frank-read\//, "")
        .replace(/^\//, "") || "index.html";
    if (!["index.html", "fbook-builder.html"].includes(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(await readFile(name));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((r) => server.listen(4173, "127.0.0.1", r));
await mkdir(".test-results", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
await context.addInitScript(() => {
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.buffer) {
      const samples = this.buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < samples.length; i++)
        peak = Math.max(peak, Math.abs(samples[i]));
      window.__audioPeak = peak;
      window.__audioDuration = this.buffer.duration;
    }
    return start.apply(this, args);
  };
});
const page = await context.newPage(),
  errors = [],
  requests = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log("PAGE ERROR", e.message);
});
page.on("request", (r) => {
  if (/^https?:/.test(r.url()) && !r.isNavigationRequest())
    requests.push(r.url());
});
page.on("dialog", (d) => d.accept());
const base =
  process.env.TEST_FILE_URL === "1"
    ? pathToFileURL(process.cwd() + "/index.html").href
    : "http://127.0.0.1:4173/german-frank-read/index.html";
const wait = () => page.waitForTimeout(200);
try {
  await page.goto(base);
  await selectReadingFlow(page);
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".test-results/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Тексты", exact: true }).click();
  await page.getByRole("heading", { name: "Тексты", exact: true }).waitFor();
  assert.equal(await page.locator(".book-card").count(), 3);
  await page.getByRole("link", { name: "Читаю сейчас", exact: true }).click();
  await page
    .getByRole("button", { name: "Читать дальше", exact: true })
    .click();
  await page.getByRole("tab", { name: "Оригинал", exact: true }).click();
  await page.getByRole("button", { name: "Esel", exact: true }).first().click();
  await page.getByRole("button", { name: "В мои слова", exact: true }).click();
  await page
    .getByRole("button", { name: "Слово сохранено", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Произнести слово", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="Произнести слово"]').disabled,
    {},
    { timeout: 60000 },
  );
  const audioErrors = await page.getByRole("alert").allTextContents();
  assert.deepEqual(audioErrors, [], "Audio failure: " + audioErrors.join(" "));
  assert.ok(
    await page.evaluate(
      () => window.__audioPeak > 0.01 && window.__audioDuration > 0.05,
    ),
    "eSpeak must generate non-silent audio",
  );
  await page
    .getByRole("button", { name: "Прослушать отрывок", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".listen").disabled,
    {},
    { timeout: 60000 },
  );
  const alert = await page.getByRole("alert").allTextContents();
  assert.equal(alert.length, 0, "voice error " + alert.join());
  await page.getByRole("tab", { name: "Паралель", exact: true }).click();
  assert.equal(await page.locator(".parallel-row").count(), 1);
  await page
    .getByRole("button", { name: "Следующий отрывок", exact: true })
    .click();
  await page.waitForURL(/2\/parallel$/);
  await page.reload();
  await page.getByRole("tab", { name: "Паралель", exact: true }).waitFor();
  assert.match(page.url(), /1\.2/);
  await page.getByRole("tab", { name: "Франк", exact: true }).click();
  await page
    .getByRole("button", { name: "merkte", exact: true })
    .first()
    .click();
  await page.screenshot({
    path: ".test-results/reader-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Назад", exact: true }).click();
  await page.getByRole("link", { name: "Слова", exact: true }).click();
  await page.locator(".word-entry").waitFor();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "В Anki", exact: true }).click();
  const d = await dl;
  await d.saveAs(".test-results/anki.txt");
  const anki = await readFile(".test-results/anki.txt", "utf8");
  assert.match(anki, /#deck column:4/);
  assert.match(anki, /der Esel/);
  assert.match(anki, /<b>Esel<\/b>/);
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема", { exact: true }).selectOption("dark");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.getByLabel("Тема", { exact: true }).selectOption("light");
  await page.getByText("Вместе с книгами", { exact: true }).click();
  const bdl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  const bd = await bdl;
  await bd.saveAs(".test-results/backup.zip");
  const context2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  const phone = await context2.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  phone.on("dialog", (d) => d.accept());
  await phone.goto(base);
  await phone
    .getByRole("button", { name: "Читать дальше", exact: true })
    .waitFor();
  await phone.getByRole("link", { name: "Настройки", exact: true }).click();
  await phone
    .locator('input[type=file][accept=".json,.zip"]')
    .setInputFiles(".test-results/backup.zip");
  await phone.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await phone
    .getByRole("status")
    .filter({ hasText: "Резервная копия импортирована" })
    .waitFor();
  await phone.getByRole("link", { name: "Слова", exact: true }).click();
  await phone.locator(".word-entry").waitFor();
  assert.equal(await phone.locator(".word-entry").count(), 1);
  await phone.getByRole("link", { name: "Читаю сейчас", exact: true }).click();
  await phone.screenshot({
    path: ".test-results/home-phone.png",
    fullPage: true,
  });
  await phone
    .getByRole("button", { name: "Читать дальше", exact: true })
    .click();
  await phone.screenshot({
    path: ".test-results/reader-phone.png",
    fullPage: true,
  });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "phone horizontal overflow",
  );
  await phone.setViewportSize({ width: 834, height: 1194 });
  await phone.screenshot({
    path: ".test-results/reader-tablet.png",
    fullPage: true,
  });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "tablet overflow",
  );
  await context2.close();
  await page.goto(base.replace("index.html", "fbook-builder.html"));
  await page.getByRole("button", { name: "Пример", exact: true }).click();
  await page
    .getByRole("button", { name: "2. Сверка с PDF", exact: true })
    .click();
  await page
    .locator('input[type=file][accept=".pdf"]')
    .setInputFiles("tests/original.pdf");
  await page.getByRole("status").filter({ hasText: "PDF прочитан." }).waitFor();
  await page
    .getByRole("button", { name: "Сверить текст", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "✓ Слова совпадают", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "3. Произношение", exact: true })
    .click();
  await page.getByRole("button", { name: /Создать IPA/ }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "IPA готова:" })
    .waitFor({ timeout: 180000 });
  await page
    .getByRole("button", { name: "5. Скачать .fbook", exact: true })
    .click();
  const fdl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Собрать и скачать .fbook", exact: true })
    .click();
  const fd = await fdl;
  await fd.saveAs(".test-results/built.fbook");
  await page.screenshot({ path: ".test-results/builder.png", fullPage: true });
  await page.goto(base + "#/texts");
  await page.getByRole("button", { name: "Загрузить", exact: true }).waitFor();
  await page
    .locator('input[type=file][accept=".fbook"]')
    .setInputFiles(".test-results/built.fbook");
  await page
    .getByRole("status")
    .filter({ hasText: "Книга добавлена:" })
    .waitFor();
  assert.equal(await page.locator(".book-card").count(), 4);
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "bad.fbook",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a zip"),
  });
  await page.getByRole("alert").waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], "App must make no HTTP requests");
  console.log(
    "PASS: reading modes, real eSpeak audio, progress reload, word saving, Anki, theme, ZIP backup to fresh context, responsive phone, builder IPA and fbook import, invalid file rejection; no network requests or page errors.",
  );
} finally {
  await browser.close();
  server.close();
}
