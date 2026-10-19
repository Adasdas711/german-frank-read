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
    const settingsButton = page
      .getByRole("button", { name: "Settings", exact: true })
      .first();
    await settingsButton.waitFor();
    const backgroundScroll = await page.evaluate(() => {
      document.body.style.minHeight = "2500px";
      window.scrollTo(0, 120);
      return window.scrollY;
    });
    await settingsButton.evaluate((node) => node.click());
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
    for (const value of ["ru", "de", "en", "ru", "de", "en"]) {
      await language.focus();
      await language.selectOption(value);
      await page.waitForFunction(
        (value) => document.documentElement.lang === value,
        value,
      );
      assert.equal(await page.getByRole("dialog").count(), 1);
      assert(await settings.isVisible());
      assert.equal(
        await language.evaluate((node) => document.activeElement === node),
        false,
        "the native language picker releases focus immediately",
      );
    }
    assert.equal(
      await settings.locator(".interface-size .filled-control").count(),
      2,
    );
    const appScale = settings.getByRole("slider", {
      name: "App interface",
      exact: true,
    });
    await appScale.scrollIntoViewIfNeeded();
    const appScaleBox = await appScale.locator("..").boundingBox();
    await page.mouse.move(
      appScaleBox.x + appScaleBox.width * 0.25,
      appScaleBox.y + appScaleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      appScaleBox.x + appScaleBox.width * 0.75,
      appScaleBox.y + appScaleBox.height / 2,
      { steps: 4 },
    );
    assert.equal(
      await page
        .locator("html")
        .evaluate((node) => node.style.getPropertyValue("--ui-scale")),
      "1.25",
      "app size is committed only on release",
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.documentElement.style.getPropertyValue("--ui-scale") ===
        "1.75",
    );
    await appScale.evaluate((node) => {
      node.value = "100";
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        document.documentElement.style.getPropertyValue("--ui-scale") ===
        "1.25",
    );
    const lockedTop = await page.evaluate(() => document.body.style.top);
    assert.equal(
      await page.evaluate(() => document.body.style.position),
      "fixed",
    );
    const box = await settings.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await settings.evaluate((node) => (node.scrollTop = 0));
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
    assert(
      await settings.evaluate((node) => node.scrollTop > 0),
      "the dialog itself remains scrollable",
    );
    await settings.evaluate((node) => (node.scrollTop = node.scrollHeight));
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.body.style.top), lockedTop);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await settings.evaluate((node) => (node.scrollTop = 0));
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.body.style.top), lockedTop);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
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
    assert.equal(
      await themes.locator(".settings-group .filled-control").count(),
      5,
    );
    const lineSpacing = themes.getByRole("slider", {
      name: "Line spacing",
      exact: true,
    });
    assert(await lineSpacing.isDisabled());
    await themes
      .getByRole("checkbox", { name: "Customize", exact: true })
      .check();
    const drag = async (slider, fraction) => {
      await slider.focus();
      await slider.press("Home");
      await slider.scrollIntoViewIfNeeded();
      const row = slider.locator("..");
      const box = await row.boundingBox();
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width * (0.1 + fraction),
        box.y + box.height / 2,
        { steps: 4 },
      );
      await page.mouse.up();
    };
    const hintSize = themes.getByRole("slider", {
      name: "Hint size",
      exact: true,
    });
    await drag(hintSize, 0.51);
    assert.equal(Number(await hintSize.inputValue()), 0.93);
    await hintSize.focus();
    await hintSize.press("ArrowRight");
    assert.equal(Number(await hintSize.inputValue()), 0.94);
    await drag(lineSpacing, 0.51);
    assert.equal(Number(await lineSpacing.inputValue()), 1.75);
    for (const [name, expected] of [
      ["Character spacing", 0.06],
      ["Word spacing", 0.3],
      ["Margins", 9],
    ]) {
      const slider = themes.getByRole("slider", { name, exact: true });
      await drag(slider, 0.51);
      assert.equal(Number(await slider.inputValue()), expected);
    }
    for (let i = 1; i <= 5; i++) {
      await themes
        .getByRole("button", { name: `Hint colour ${i}`, exact: true })
        .click();
      const colors = await themes.evaluate((node) => ({
        hint: getComputedStyle(node.querySelector(".theme-preview .hint"))
          .color,
        reset: getComputedStyle(node.querySelector(".theme-reset"))
          .backgroundColor,
      }));
      assert.equal(
        colors.reset,
        colors.hint,
        "Reset Theme uses the effective hint color",
      );
    }
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
    await settings
      .getByRole("button", { name: "Erase All Data", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "Erase all local data?",
      exact: true,
    });
    await confirmation.waitFor();
    assert.equal(await page.getByRole("dialog").count(), 2);
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.body.style.position),
      "fixed",
      "closing a nested dialog keeps the settings scroll lock",
    );
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.evaluate(() => document.body.style.position), "");
    assert.equal(await page.evaluate(() => window.scrollY), backgroundScroll);
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
      `PASS ${width}px: joined sections, repeated language changes, fractional filled sliders, matching reset color, scroll lock and persistence`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
