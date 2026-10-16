import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
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
const order = async (p, selector, attr) =>
  p
    .locator(selector)
    .evaluateAll((rows, attr) => rows.map((r) => r.getAttribute(attr)), attr);
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    p = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await p.goto(url);
  await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await p.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("franka-v2");
      q.onsuccess = () => r(q.result);
    });
    const books = await new Promise((r) => {
      const q = db.transaction("books").objectStore("books").getAll();
      q.onsuccess = () => r(q.result);
    });
    await new Promise((r) => {
      const tx = db.transaction(["settings", "progress"], "readwrite");
      tx.objectStore("settings").put(
        ["a", "b", "c"].map((id, i) => ({
          id,
          name: "Folder " + id,
          bookIds: [books[i].manifest.id],
          updatedAt: new Date().toISOString(),
        })),
        "collections",
      );
      books.slice(0, 3).forEach((b, i) =>
        tx.objectStore("progress").put(
          {
            book: b.manifest.id,
            at: "1.1",
            percent: i === 2 ? 100 : 20,
            mode: "frank",
            updatedAt: new Date().toISOString(),
          },
          b.manifest.id,
        ),
      );
      tx.oncomplete = r;
    });
    db.close();
  });
  await p.reload();
  await p.getByRole("heading", { name: "Continue", exact: true }).waitFor();
  assert.equal(
    await p.locator(".continue-card").count(),
    2,
    "Home contains started, unfinished books",
  );
  const sidebar = p.locator(".library-sidebar");
  const headings = await sidebar.locator("h3").allTextContents();
  assert.deepEqual(headings, ["My Collections", "Levels", "Words"]);
  assert.equal(
    await sidebar.getByRole("button", { name: "Reading", exact: true }).count(),
    0,
  );
  assert.equal(
    await sidebar
      .locator(".collection-menu")
      .getByRole("button", { name: "All Books", exact: true })
      .count(),
    1,
  );
  const allRoot = await sidebar
    .getByRole("button", { name: "All Books", exact: true })
    .boundingBox();
  const finishedRoot = await sidebar
    .getByRole("button", { name: "Finished", exact: true })
    .boundingBox();
  assert.ok(
    finishedRoot.y >= allRoot.y + allRoot.height,
    "root collections occupy separate rows",
  );
  await p.screenshot({ path: ".test-results/sidebar.png" });
  await p
    .locator("[data-level=A2]")
    .dragTo(p.locator("[data-level=B2]"), { targetPosition: { x: 20, y: 30 } });
  assert.deepEqual(await order(p, "[data-level]", "data-level"), [
    "B1",
    "B2",
    "A2",
  ]);
  await p.reload();
  await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
  assert.deepEqual(
    await order(p, "[data-level]", "data-level"),
    ["B1", "B2", "A2"],
    "non-default level order survives reload",
  );
  await p
    .locator("[data-level=A2]")
    .dragTo(p.locator("[data-level=B1]"), { targetPosition: { x: 20, y: 2 } });
  assert.deepEqual(await order(p, "[data-level]", "data-level"), [
    "A2",
    "B1",
    "B2",
  ]);
  await p
    .locator("[data-collection=a]")
    .dragTo(p.locator("[data-collection=c]"), {
      targetPosition: { x: 20, y: 30 },
    });
  assert.deepEqual(await order(p, "[data-collection]", "data-collection"), [
    "b",
    "c",
    "a",
  ]);
  await p
    .locator("[data-collection=c]")
    .dragTo(p.locator("[data-collection=b]"), {
      targetPosition: { x: 20, y: 2 },
    });
  assert.deepEqual(await order(p, "[data-collection]", "data-collection"), [
    "c",
    "b",
    "a",
  ]);
  await p.reload();
  await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
  assert.deepEqual(await order(p, "[data-collection]", "data-collection"), [
    "c",
    "b",
    "a",
  ]);
  assert.deepEqual(await order(p, "[data-level]", "data-level"), [
    "A2",
    "B1",
    "B2",
  ]);
  await sidebar.getByRole("button", { name: "B1", exact: true }).click();
  await sidebar.getByRole("button", { name: "Search", exact: true }).click();
  await p.getByRole("heading", { name: "Search", exact: true }).waitFor();
  await sidebar.getByRole("button", { name: "Search", exact: true }).click();
  await p.getByRole("heading", { name: "B1", exact: true }).waitFor();
  await sidebar
    .getByRole("button", { name: "Hide sidebar", exact: true })
    .click();
  const search = p
    .locator(".collapsed-tools")
    .getByRole("button", { name: "Search", exact: true });
  await search.click();
  await p.getByRole("heading", { name: "Search", exact: true }).waitFor();
  await search.click();
  await p.getByRole("heading", { name: "B1", exact: true }).waitFor();
  await p.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await p.locator("[data-level=B2]").click({ button: "right" });
  const menu = p.getByRole("menu", { name: "Folder options" });
  await menu.waitFor();
  assert.ok(
    await menu
      .getByRole("menuitem", { name: "Delete Folder", exact: true })
      .evaluate((n) => n === document.activeElement),
  );
  await p.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  await p.locator("[data-level=B2]").click({ button: "right" });
  await menu.getByRole("menuitem").click();
  await p
    .getByRole("dialog", { name: "Delete folder B2?" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  assert.equal(await p.locator("[data-level=B2]").count(), 0);
  await p.locator("[data-collection=a]").click({ button: "right" });
  await menu.getByRole("menuitem").click();
  await p
    .getByRole("dialog", { name: "Delete collection Folder a?" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  assert.equal(await p.locator("[data-collection=a]").count(), 0);
  await sidebar.getByRole("button", { name: "All Books", exact: true }).click();
  await p.locator(".shelf-book").first().waitFor();
  assert.equal(
    await p.locator(".shelf-book").count(),
    4,
    "folder deletion retains books",
  );
  await p.reload();
  await p.getByRole("heading", { name: "All Books", exact: true }).waitFor();
  assert.equal(await p.locator("[data-level=B2]").count(), 0);
  assert.equal(await p.locator("[data-collection=a]").count(), 0);
  for (const width of [834, 390]) {
    await p.setViewportSize({ width, height: 1000 });
    const mobileSearch = p
      .locator(".bottom-nav")
      .getByRole("button", { name: "Search", exact: true });
    await mobileSearch.click();
    await p.getByRole("heading", { name: "Search", exact: true }).waitFor();
    await mobileSearch.click();
    await p.getByRole("heading", { name: "All Books", exact: true }).waitFor();
  }
  console.log(
    "Sidebar sections, All Books, Home Reading, native reorder both directions, persistence, custom context deletion and search toggling on desktop/tablet/phone passed.",
  );
  await context.close();
} finally {
  await browser.close();
  server.close();
}
