import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { revealReader } from "./reader-helpers.mjs";

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
await mkdir(".test-results/light-themes", { recursive: true });
function contrast(a, b) {
  const light = (rgb) =>
    rgb.slice(0, 3).reduce((sum, value, i) => {
      const c = value / 255;
      return (
        sum +
        (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
          [0.2126, 0.7152, 0.0722][i]
      );
    }, 0);
  const x = light(a),
    y = light(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
async function settled(panel) {
  await panel.evaluate(async (n) => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await Promise.all(
      n.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
    );
  });
}
try {
  for (const width of [320, 390, 834, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 700 ? 844 : 1194 },
      hasTouch: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    const id = await page
      .locator(".continue-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Die Bremer Stadtmusikanten",
          exact: true,
        }),
      })
      .getAttribute("data-book");
    await page.evaluate((id) => (location.hash = `/read/${id}/1.1/frank`), id);
    const reader = page.locator(".books-reader[data-ready=true]");
    await reader.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await revealReader(page, true);
    await page.locator(".reader-tools-button").tap();
    await settled(page.locator(".reading-menu"));
    const menuWidth = (await page.locator(".reading-menu").boundingBox()).width;
    await page
      .locator(".reading-menu")
      .getByRole("button", { name: "Themes", exact: true })
      .tap();
    const panel = page.locator(".folio-popover.type");
    await panel.waitFor();
    await settled(panel);
    for (const theme of ["Sepia", "Sand", "Paper", "Mist", "Night"]) {
      await panel.getByRole("button", { name: theme, exact: true }).tap();
      assert.equal(
        await reader.getAttribute("data-reading-tone"),
        theme === "Night" ? "dark" : "light",
      );
      assert.equal(
        await panel
          .getByRole("heading", { name: "Interface size", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await panel
          .getByRole("slider", { name: "Reading controls", exact: true })
          .count(),
        1,
      );
      assert(Math.abs((await panel.boundingBox()).width - menuWidth) < 1);
      if (theme !== "Night") {
        const alpha = await panel.evaluate((n) => {
          const ctx = document.createElement("canvas").getContext("2d");
          ctx.fillStyle = getComputedStyle(n).backgroundColor;
          ctx.fillRect(0, 0, 1, 1);
          return ctx.getImageData(0, 0, 1, 1).data[3] / 255;
        });
        assert(
          alpha > 0.95,
          "light backing prevents book text competing with settings",
        );
      }
      await panel.getByRole("button", { name: "Customize", exact: true }).tap();
      await settled(panel);
      for (const title of ["Text", "Hints", "Accessibility & Layout"]) {
        const group = panel.getByRole("group", { name: title, exact: true });
        const shape = await group.evaluate((n) => {
          const heading = n.querySelector("h3"),
            body = n.querySelector(".group");
          const h = heading.getBoundingClientRect(),
            b = body.getBoundingClientRect();
          return {
            gap: b.top - h.bottom,
            left: b.left - h.left,
            heading: getComputedStyle(heading).backgroundColor,
            body: getComputedStyle(body).backgroundColor,
            shoulder: getComputedStyle(heading, "::after").backgroundImage,
            radius: getComputedStyle(body).borderTopLeftRadius,
            scroll: n.scrollWidth,
            width: n.clientWidth,
          };
        });
        assert(
          Math.abs(shape.gap) < 0.1 && Math.abs(shape.left) < 0.1,
          `${title} is joined to its fields`,
        );
        assert.equal(shape.heading, shape.body);
        assert.equal(shape.radius, "0px");
        assert(shape.shoulder.includes("radial-gradient"));
        assert(
          shape.scroll <= shape.width + 1,
          `${width}: ${title} must fit the panel`,
        );
      }
      const layout = panel.locator(".layout-controls");
      assert.equal(await layout.getAttribute("disabled"), "");
      assert.equal(
        await layout.evaluate((n) => getComputedStyle(n).opacity),
        "1",
      );
      assert(
        await panel
          .getByRole("slider", { name: "Line spacing", exact: true })
          .isDisabled(),
      );
      for (let i = 1; i <= 5; i++) {
        const swatch = panel.getByRole("button", {
          name: `Hint colour ${i}`,
          exact: true,
        });
        await swatch.tap();
        assert.equal(await swatch.getAttribute("aria-pressed"), "true");
        assert.equal(await swatch.locator("svg").count(), 1);
        const colors = await swatch.evaluate((n) => {
          const root = n.closest(".books-reader"),
            preview = root.querySelector(".theme-preview .hint");
          const style = getComputedStyle(root);
          const rgb = (color) => {
            const c = document.createElement("canvas").getContext("2d");
            c.fillStyle = color;
            c.fillRect(0, 0, 1, 1);
            return [...c.getImageData(0, 0, 1, 1).data];
          };
          return {
            paper: rgb(style.getPropertyValue("--folio-paper")),
            hint: rgb(style.getPropertyValue("--folio-hint")),
            swatch: rgb(getComputedStyle(n).backgroundColor),
            check: rgb(getComputedStyle(n).color),
            preview: rgb(getComputedStyle(preview).color),
            accent: style.getPropertyValue("--teal"),
          };
        });
        assert.deepEqual(
          colors.swatch,
          colors.hint,
          "the selected swatch keeps the actual hint color",
        );
        assert.deepEqual(
          colors.preview,
          colors.hint,
          "preview and book use the same hint color",
        );
        assert(contrast(colors.hint, colors.paper) >= 4.5);
        assert(contrast(colors.check, colors.swatch) >= 4.5);
        if (i === 1) page.lastAccent = colors.accent;
        else
          assert.equal(
            colors.accent,
            page.lastAccent,
            "changing hint color must not recolor switches and sliders",
          );
      }
      if (width === 834 || (width === 390 && theme === "Sand")) {
        await panel
          .getByRole("group", { name: "Text", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `.test-results/light-themes/${theme.toLowerCase()}-${width}.png`,
        });
      }
      await panel.getByRole("button", { name: "Done", exact: true }).tap();
      await settled(panel);
    }
    // Check real keyboard range input and immediate updates while controls are enabled.
    await panel.getByRole("button", { name: "Paper", exact: true }).tap();
    await panel.getByRole("button", { name: "Customize", exact: true }).tap();
    await panel
      .getByRole("checkbox", { name: "Customize", exact: true })
      .check();
    const spacing = panel.getByRole("slider", {
      name: "Line spacing",
      exact: true,
    });
    assert(await spacing.isEnabled());
    await spacing.focus();
    await spacing.press("ArrowRight");
    assert.equal(await spacing.inputValue(), "1.7");
    const hint = panel.getByRole("button", {
      name: "Hint colour 4",
      exact: true,
    });
    await hint.tap();
    const before = await reader.evaluate((n) =>
      getComputedStyle(n).getPropertyValue("--folio-hint"),
    );
    for (const value of [160, 80, 100]) {
      await panel
        .getByRole("slider", { name: "Reading controls", exact: true })
        .evaluate((n, value) => {
          n.value = String(value);
          n.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
      const sizes = await panel
        .locator(".theme-setting-group")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            width: n.clientWidth,
            scroll: n.scrollWidth,
            heading: n.querySelector("h3").getBoundingClientRect().right,
            body: n.querySelector(".group").getBoundingClientRect().right,
          })),
        );
      assert(
        sizes.every((s) => s.scroll <= s.width + 1 && s.heading <= s.body),
        `${width}/${value}%: all connected sections fit`,
      );
    }
    await page.reload();
    await reader.waitFor();
    assert.equal(
      await reader.evaluate((n) =>
        getComputedStyle(n).getPropertyValue("--folio-hint"),
      ),
      before,
      "hint choice survives reload",
    );
    assert.equal(await reader.getAttribute("data-reading-tone"), "light");
    assert.deepEqual(errors, []);
    console.log(
      `${width}: all light themes, connected sections, five colors, native controls and persistence passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
