import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const html = await readFile("index.html");
const server = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(".test-results/general-settings", { recursive: true });
try {
  for (const width of [390, 834, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1024 },
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click();
    const settings = page.locator(".general-settings");
    await settings.waitFor();
    assert.equal(await settings.locator(".settings-group").count(), 5);
    const groups = await settings
      .locator(".settings-group")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const title = node.querySelector("h3"),
            body = node.querySelector(".group");
          return {
            title: getComputedStyle(title).backgroundColor,
            body: getComputedStyle(body).backgroundColor,
            gap:
              body.getBoundingClientRect().top -
              title.getBoundingClientRect().bottom,
            corner: getComputedStyle(body).borderTopLeftRadius,
            shoulder: getComputedStyle(title, "::after").backgroundImage,
          };
        }),
      );
    for (const group of groups) {
      assert.equal(group.title, group.body);
      assert(Math.abs(group.gap) < 0.1);
      assert.equal(group.corner, "0px");
      assert(group.shoulder.includes("radial-gradient"));
    }
    assert.equal(
      await settings
        .getByRole("button", { name: "Reset interface size", exact: true })
        .count(),
      0,
    );
    const language = settings.locator("select").first();
    for (const value of ["ru", "de", "en"]) {
      await language.selectOption(value);
      await page.waitForFunction(
        (value) => document.documentElement.lang === value,
        value,
      );
      assert.equal(await page.getByRole("dialog").count(), 1);
      assert(await settings.isVisible());
    }
    await page.screenshot({
      path: `.test-results/general-settings/settings-${width}.png`,
    });
    await settings.getByRole("button", { name: "Themes", exact: true }).click();
    const themes = page.getByRole("dialog", { name: "Themes", exact: true });
    assert.equal(
      await themes.getByRole("button", { name: "Close", exact: true }).count(),
      1,
    );
    assert.equal(await themes.locator(".row > h2").count(), 0);
    const colors = {
      Night: ["dark", "#080909"],
      Dusk: ["dark", "#28272d"],
      Ink: ["dark", "#000000"],
      Forest: ["dark", "#122820"],
      Sepia: ["light", "#ead9b9"],
      Sand: ["light", "#f1e8d5"],
      Paper: ["light", "#fffef9"],
      Mist: ["light", "#e2e8ec"],
    };
    for (const [name, [tone, paper]] of Object.entries(colors)) {
      await themes.getByRole("button", { name, exact: true }).click();
      await page.waitForFunction(
        ({ tone, paper }) =>
          document.documentElement.dataset.theme === tone &&
          document.documentElement.style.getPropertyValue("--bg") === paper,
        { tone, paper },
      );
    }
    await themes.getByRole("button", { name: "Sepia", exact: true }).click();
    await themes
      .getByRole("button", { name: "Customize", exact: true })
      .click();
    await themes
      .getByRole("checkbox", { name: "Bold Text", exact: true })
      .check();
    const reset = themes.getByRole("button", {
      name: "Reset Theme",
      exact: true,
    });
    const style = await reset.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      text: getComputedStyle(node).color,
    }));
    assert.notEqual(style.background, "rgba(0, 0, 0, 0)");
    assert.notEqual(style.background, style.text);
    await reset.click();
    assert.equal(
      await themes
        .getByRole("checkbox", { name: "Bold Text", exact: true })
        .isChecked(),
      false,
    );
    assert.equal(
      await themes
        .getByRole("button", { name: "Reset interface size", exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: `.test-results/general-settings/customize-${width}.png`,
    });
    await themes.getByRole("button", { name: "Back", exact: true }).click();
    await themes.getByRole("button", { name: "Close", exact: true }).click();
    await settings.waitFor();
    assert.equal(await language.inputValue(), "en");
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "light",
    );
    assert.equal(
      await page
        .locator("html")
        .evaluate((node) => node.style.getPropertyValue("--bg")),
      "#ead9b9",
    );
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click();
    await settings.getByRole("button", { name: "Themes", exact: true }).click();
    assert.equal(
      await themes
        .getByRole("button", { name: "Sepia", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px: joined sections, inline languages, single Themes header, all app palettes, reset and persistence`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
