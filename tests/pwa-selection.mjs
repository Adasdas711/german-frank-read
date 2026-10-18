import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const prefix = "/german-frank-read/";
let updatedWorker = false;
const server = createServer(async (q, s) => {
  try {
    const path = new URL(q.url, "http://localhost").pathname;
    if (!path.startsWith(prefix)) throw Error();
    const file = path.slice(prefix.length) || "index.html";
    let data = await readFile(file);
    if (file === "sw.js" && updatedWorker)
      data = Buffer.from(
        data
          .toString()
          .replace(/franka-offline-[a-f0-9]+/, "franka-offline-update-test"),
      );
    s.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".webmanifest")
          ? "application/manifest+json"
          : file.endsWith(".png")
            ? "image/png"
            : "text/html;charset=utf-8",
    );
    s.end(data);
  } catch {
    s.statusCode = 404;
    s.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const p = await context.newPage();
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  await p.goto(base);
  await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await p.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await p.waitForFunction(() => navigator.serviceWorker.controller);
  assert.equal(
    await p.locator("link[rel=manifest]").getAttribute("href"),
    "./manifest.webmanifest",
  );
  const manifest = await (
    await context.request.get(base + "manifest.webmanifest")
  ).json();
  assert.equal(manifest.display, "standalone");
  await p.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    const books = await new Promise((r) => {
      const q = db.transaction("books").objectStore("books").getAll();
      q.onsuccess = () => r(q.result);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("words", "readwrite");
      for (let i = 0; i < 4; i++)
        tx.objectStore("words").put(
          {
            key: "drag-" + i,
            book: books[0].manifest.id,
            at: "1.1",
            lemma: ["eins", "zwei", "drei", "vier"][i],
            form: "Wort",
            ru: "слово",
            ipa: "vɔrt",
            context: "Ein Wort.",
            savedAt: new Date(2026, 0, 4 - i).toISOString(),
            inAnki: false,
          },
          "drag-" + i,
        );
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
    location.hash = "/words";
  });
  await p.reload();
  await p.locator(".word-main").first().click();
  assert.equal(
    new URL(p.url()).hash,
    "#/words",
    "word click stays in dictionary",
  );
  assert.equal(
    await p.locator(".word-row.selected").count(),
    1,
    "word click enters selection mode",
  );
  await p.locator(".word-main").first().click();
  assert.equal(
    await p.locator(".word-row.selected").count(),
    0,
    "second word click deselects",
  );
  const checks = p.getByRole("checkbox");
  assert.equal(await checks.count(), 4);
  assert.equal(
    await checks.first().evaluate((n) => getComputedStyle(n).borderRadius),
    "50%",
  );
  const gap = await p
    .locator(".word-row")
    .first()
    .evaluate(
      (n) =>
        n.querySelector(".word-main").getBoundingClientRect().left -
        n.querySelector("input").getBoundingClientRect().right,
    );
  assert.ok(gap >= 20);
  const boxes = await Promise.all(
    [0, 1, 2, 3].map((i) => checks.nth(i).boundingBox()),
  );
  const point = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const a = point(boxes[0]),
    b = point(boxes[3]);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps: 12 });
  await p.mouse.up();
  assert.equal(
    await p.locator(".word-row.selected").count(),
    4,
    "drag selects crossed rows",
  );
  await p.mouse.move(b.x, b.y);
  await p.mouse.down();
  await p.mouse.move(a.x, a.y, { steps: 12 });
  await p.mouse.up();
  assert.equal(
    await p.locator(".word-row.selected").count(),
    0,
    "drag starting selected clears rows",
  );
  await checks.first().click();
  assert.equal(
    await p.locator(".word-row.selected").count(),
    1,
    "normal click toggles once",
  );
  assert.equal(
    await p.evaluate(() =>
      document.body.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    ),
    false,
    "context menu cancelled",
  );
  // An open tab must not leave an installed PWA on the old reader indefinitely.
  const other = await context.newPage();
  await other.goto(base);
  await other.getByRole("heading", { name: "Home", exact: true }).waitFor();
  updatedWorker = true;
  await p.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await p.waitForFunction(async () =>
    (await caches.keys()).includes("franka-offline-update-test"),
  );
  await p.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const versions = (await caches.keys()).filter((name) =>
      name.startsWith("franka-offline-"),
    );
    return (
      registration.active?.state === "activated" &&
      !registration.waiting &&
      versions.length === 1 &&
      versions[0] === "franka-offline-update-test"
    );
  });
  await p.reload();
  await p.locator(".word-selection-toggle").waitFor();
  assert.equal(
    await p.locator(".word-row").count(),
    4,
    "worker update preserves saved words",
  );
  await other.close();
  await context.setOffline(true);
  await p.reload();
  await p.locator(".word-selection-toggle").waitFor();
  assert.equal(
    await p.locator(".word-row").count(),
    4,
    "saved words survive offline reload",
  );
  await p.evaluate(
    () =>
      (location.hash = "/read/9b597927-66e7-4b7a-a540-ae3e0583fc22/1.1/clean"),
  );
  await p.locator(".books-reader[data-ready=true]").waitFor();
  const content = await p.locator(".folio-columns").innerText();
  assert.ok(content.includes("Reinhard"));
  await p.mouse.click(200, 200, { button: "right" });
  assert.equal(
    await p.getByLabel("Word details").count(),
    0,
    "right click cannot open lookup",
  );
  const builder = await context.newPage();
  await builder.goto(base + "fbook-builder.html");
  assert.ok((await builder.title()).length > 0);
  console.log(
    "Passed: round controls, drag selection, blocked context menu, subpath manifest, PWA update with another tab open, retained words, offline reader/words/builder.",
  );
  await context.close();
} finally {
  await browser.close();
  server.close();
}
