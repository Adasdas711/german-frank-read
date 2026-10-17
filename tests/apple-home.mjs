import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
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
await mkdir(".test-results/apple-home", { recursive: true });
try {
  for (const width of [1440, 834, 390, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        colorScheme: "dark",
        reducedMotion: "reduce",
      }),
      p = await context.newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}`);
    await p.getByRole("heading", { name: "Home", exact: true }).waitFor();
    assert.equal(
      await p.getByText("Recently Added", { exact: true }).count(),
      0,
    );
    const cards = p.locator(".continue-card");
    assert.equal(await cards.count(), 2);
    for (let i = 0; i < 2; i++) {
      assert.ok((await cards.nth(i).boundingBox()).height < 160);
      assert.equal(await cards.nth(i).locator("button").count(), 2);
      assert.match(
        await cards.nth(i).locator(".continue-meta").innerText(),
        /Book · [AB][12] · \d+%/,
      );
    }
    const title = p.getByRole("heading", { name: "New Words", exact: true }),
      r = await title.boundingBox();
    await p.mouse.move(r.x + 1, r.y + r.height / 2);
    await p.mouse.down();
    await p.mouse.move(r.x + r.width - 2, r.y + r.height / 2, { steps: 10 });
    await p.mouse.up();
    assert.equal(
      await p.evaluate(() => getSelection().toString()),
      "",
      "interface text cannot be dragged into native selection",
    );
    await p.screenshot({ path: `.test-results/apple-home/home-${width}.png` });
    const search = () =>
      (width > 1100
        ? p.locator(".library-sidebar")
        : p.locator(".bottom-nav")
      ).getByRole("button", { name: "Search", exact: true });
    await search().click();
    await p
      .getByRole("heading", { name: "Recently Viewed", exact: true })
      .waitFor();
    assert.equal(
      await p.locator(".recently-viewed .search-book-row").count(),
      0,
    );
    const field = await p.locator(".search-field").boundingBox(),
      main = await p.locator(".library-main").boundingBox();
    assert.ok(
      Math.abs(field.x + field.width / 2 - main.x - main.width / 2) < 2,
      "search field centered",
    );
    const input = p.getByLabel("Search your library");
    await input.fill("Kafka");
    await input.press("Control+a");
    assert.equal(
      await input.evaluate((n) => n.selectionEnd - n.selectionStart),
      5,
      "input selection still works",
    );
    assert.equal(await p.locator(".search-book-row").count(), 1);
    await p.locator(".search-book-cover").click();
    await p
      .getByRole("dialog", { name: "Die Verwandlung", exact: true })
      .waitFor();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await input.fill("");
    assert.equal(
      await p.locator(".recently-viewed .search-book-row").count(),
      1,
    );
    assert.ok(
      (await p.locator(".recently-viewed").innerText()).includes("Franz Kafka"),
    );
    await p.reload();
    await p
      .getByRole("heading", { name: "Recently Viewed", exact: true })
      .waitFor();
    assert.equal(
      await p.locator(".recently-viewed .search-book-row").count(),
      1,
      "recent books persist",
    );
    await p.screenshot({
      path: `.test-results/apple-home/search-${width}.png`,
    });
    await p.getByRole("button", { name: "Clear", exact: true }).click();
    await p
      .locator(".recently-viewed .search-book-row")
      .waitFor({ state: "detached" });
    assert.equal(
      await p.locator(".recently-viewed .search-book-row").count(),
      0,
    );
    await p.reload();
    await p
      .getByRole("heading", { name: "Recently Viewed", exact: true })
      .waitFor();
    assert.equal(
      await p.locator(".recently-viewed .search-book-row").count(),
      0,
      "cleared history stays clear",
    );
    await input.fill("Grimm");
    await p.locator(".search-book-read").first().click();
    await p.locator(".books-reader[data-ready=true]").waitFor();
    await p.evaluate(() => (location.hash = "/search"));
    await input.fill("");
    await p
      .getByRole("heading", { name: "Recently Viewed", exact: true })
      .waitFor();
    assert.equal(
      await p.locator(".recently-viewed .search-book-row").count(),
      1,
      "reading records a recently viewed book",
    );
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    console.log(
      `${width}px: compact Continue cards, removed shelf, native selection disabled, editable input, centered search and persistent recent/clear/read passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
