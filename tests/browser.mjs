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
  await page.locator(".continue-open").first().click();
  await page.locator(".books-reader[data-ready=true]").waitFor();
  await page.mouse.click(720, 60);
  await page.locator(".reader-tools-button").click();
  await page.getByRole("tab", { name: "Clean", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Esel", exact: true }).first().click();
  await page
    .getByRole("button", { name: "Pronounce word", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__audioPeak > 0.01 && window.__audioDuration > 0.05,
    {},
    { timeout: 60000 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.click(720, 60);
  await page.locator(".reader-tools-button").click();
  await page
    .getByRole("button", { name: "Listen to page", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__audioDuration > 1,
    {},
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: "Stop audio", exact: true }).click();
  await page
    .getByRole("button", { name: "Listen to page", exact: true })
    .waitFor();
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
  await page.goto(base + "#/library");
  await page.getByRole("heading", { name: "All Books", exact: true }).waitFor();
  await page
    .locator('input[type=file][accept=".fbook"]')
    .setInputFiles(".test-results/built.fbook");
  await page.getByRole("button", { name: "Add to Library" }).click();
  await page.getByText("Book added", { exact: true }).waitFor();
  assert.equal(await page.locator(".shelf-book").count(), 5);
  await page.locator('input[type=file][accept=".fbook"]').setInputFiles({
    name: "bad.fbook",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a zip"),
  });
  await page.getByRole("alert").waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], "App must make no HTTP requests");
  console.log(
    "PASS: real eSpeak word and page audio, PDF text extraction and comparison, builder IPA, fbook build, staged import, invalid archive rejection; no network requests or page errors.",
  );
} finally {
  await browser.close();
  server.close();
}
